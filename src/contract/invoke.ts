import { rpc, Contract, TransactionBuilder, BASE_FEE } from '@stellar/stellar-sdk';
import type { TrustFlowClient } from '../client';
import type { ContractCallResult } from '../types/contract';
import { TrustFlowError } from '../errors';
import type { AccountOptions } from '../accounts/types';
import { TrustFlowError } from '../errors';
import { withTransientRetry } from '../utils/node-retry';
import { padResourceFee } from '../utils/resource-fee';
import { describeError, logger } from '../utils/logger';
import type { ReadContractStateOptions } from './read';
import { simulateTransaction } from './simulation';
import { DEFAULT_RESOURCE_FEE_MULTIPLIER, padResourceFee } from '../tx-pipeline/pipeline';

export type SignAndSubmitFn = (xdr: string) => Promise<string>;

/** Per-call account and retry overrides for {@link invokeContract}. */
export interface InvokeContractOptions extends AccountOptions {
  /**
   * Overrides the client's retry budget for this call — `attempts` counts the
   * total tries (so `attempts: 1` disables retries), and `maxDelayMs` caps each
   * delay. See {@link import('../utils/retry').cappedExponentialBackoff}.
   */
  retry?: ReadContractStateOptions['retry'];
  /**
   * Per-attempt timeout in milliseconds for the `getAccount` and
   * `simulateTransaction` calls, overriding the client-wide
   * {@link ClientConfig.timeoutMs}.
   */
  timeoutMs?: number;
  /**
   * Safety headroom multiplier applied on top of the RPC-reported
   * `minResourceFee` before `assembleTransaction`, matching
   * {@link import('../tx-pipeline/types').PrepareOptions.resourceFeeMultiplier}.
   * Defaults to {@link DEFAULT_RESOURCE_FEE_MULTIPLIER} (`1.1`, i.e. 10% headroom).
   */
  resourceFeeMultiplier?: number;
}

/**
 * Assembles, simulates and optionally signs+submits a contract call.
 *
 * ### Retry behaviour
 *
 * `getAccount` and `simulateTransaction` are both retried on transient
 * failures only (connection reset, timeout, `429`, `5xx`), with capped,
 * jittered backoff. A simulation *error* response is the node's verdict and is
 * never retried — the same envelope would fail identically. A thrown
 * `getAccount` failure for a genuinely missing account is likewise retried once
 * by the classifier's default (an unrecognised error from a transport is
 * treated as a transport failure), then reported as
 * `{ success: false, error }`, matching this function's existing contract of
 * never throwing.
 *
 * Each RPC attempt is bounded by `options.timeoutMs`, falling back to the
 * client-wide {@link ClientConfig.timeoutMs}.
 *
 * ### Error reporting
 *
 * When the simulation fails or an exception is caught, the result includes the
 * RPC's error message in the `error` field so callers can diagnose the failure
 * without parsing logs. When the caught error is a {@link TrustFlowError}
 * (such as `TIMEOUT` or `ACCOUNT_NOT_FOUND`), its typed `code` is also
 * preserved on `result.code`.
 *
 * @param client - Configured client, for the contract ID, network and retry budget
 * @param method - Contract method name
 * @param args - Positional arguments, already encoded to `ScVal`s
 * @param caller - `G...` address whose sequence number and sequence-locked
 *   footprint back the transaction
 * @param signAndSubmit - Optional callback to sign and broadcast the envelope
 * @param options - Per-call account, retry and timeout overrides
 * @returns The call outcome; never throws for expected failure modes
 */
export async function invokeContract(
  client: TrustFlowClient,
  method: string,
  args: unknown[],
  caller: string,
  signAndSubmit?: SignAndSubmitFn,
  options: InvokeContractOptions = {},
): Promise<ContractCallResult> {
  try {
    client.resolveAccount(options.account);
    const server = client.getSorobanServer();
    const contract = new Contract(client.contractId);

    logger.debug('Invoking contract method', {
      method,
      caller,
      contractId: client.contractId,
      argsCount: args.length,
    });

    const account = await withTransientRetry(
      () => server.getAccount(caller),
      { ...options.retry, timeoutMs: options.timeoutMs ?? client.timeoutMs },
      client.retryConfig,
      'rpc.getAccount',
    );
    const operation = contract.call(method, ...(args as any[]));

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: client.getNetworkPassphrase(),
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simulation = await simulateTransaction(
      server,
      tx,
      { ...options.retry, timeoutMs: options.timeoutMs ?? client.timeoutMs },
      client.retryConfig,
    );

    if (!simulation.success) {
      logger.warn('Contract simulation failed', { method, error: simulation.error });
      return {
        success: false,
        error: simulation.error,
      };
    }

    logger.debug('Contract simulation successful', { method, gasUsed: simulation.cost });

    if (!signAndSubmit) {
      const gasUsed = Number(simulation.cost?.cpuInsns || simulation.minResourceFee || 0);
      return {
        success: true,
        returnValue: simulation.returnValue,
        gasUsed,
      };
    }

    const multiplier = options.resourceFeeMultiplier ?? DEFAULT_RESOURCE_FEE_MULTIPLIER;
    const paddedFee = padResourceFee(simulation.minResourceFee ?? '0', multiplier);
    if (
      simulation.transactionData &&
      typeof simulation.transactionData.setResourceFee === 'function'
    ) {
      simulation.transactionData.setResourceFee(paddedFee);
    }

    const prepared = rpc
      .assembleTransaction(tx, {
        transactionData: simulation.transactionData ?? '',
        events: [],
        minResourceFee: paddedFee,
        result: { retval: simulation.returnValue as any },
      } as any)
      .build();
    const xdr = prepared.toXDR();
    logger.debug('Signing and submitting transaction', { method, xdrLength: xdr.length });
    const txHash = await signAndSubmit(xdr);

    logger.info('Contract call submitted', { method, txHash });
    const gasUsed = Number(simulation.cost?.cpuInsns || simulation.minResourceFee || 0);
    return {
      success: true,
      txHash,
      returnValue: simulation.returnValue,
      gasUsed,
    };
  } catch (e) {
    logger.error('Contract invocation failed', { method, caller, error: e });
    if (e instanceof TrustFlowError) {
      return {
        success: false,
        error: e.message,
        code: e.code,
      };
    }
    const message = e instanceof Error ? e.message : String(e);
    const code = e instanceof TrustFlowError ? e.code : undefined;
    return { success: false, error: message, code };
  }
}
