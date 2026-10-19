import { BASE_FEE } from '@stellar/stellar-sdk';
import type { TrustFlowClient } from '../client';
import { TrustFlowError } from '../errors';
import { stroopsToXLM } from '../utils/format';
import { logger } from '../utils/logger';
import type { ReadContractStateOptions } from './read';
import { simulateTransaction, type SimulationOutcome } from './simulation';

export interface SimulationResult {
  success: boolean;
  cost: { cpuInsns: string; memBytes: string };
  returnValue?: unknown;
  error?: string;
  /** True when the simulation needs expired ledger entries restored before it can succeed. */
  needsRestore?: boolean;
  /** The restore preamble the RPC returned, when `needsRestore` is true. */
  restorePreamble?: {
    minResourceFee: string;
    transactionData: any;
  };
  /** Minimum resource fee in stroops reported by the simulation, when available. */
  minResourceFee?: string;
}

/**
 * Human-readable and structured CPU instruction, RAM byte, and fee estimate
 * parsed from a Soroban transaction simulation response.
 */
export interface ResourceFootprintEstimate {
  /** Raw CPU instruction count string reported by Soroban RPC */
  cpuInsns: string;
  /** Parsed CPU instruction count as a number */
  cpuInstructions: number;
  /** Human-readable CPU instruction count (e.g. "1,250,000 instructions") */
  cpuFormatted: string;
  /** Raw RAM bytes string reported by Soroban RPC */
  memBytes: string;
  /** Parsed RAM usage in bytes */
  ramBytes: number;
  /** Human-readable RAM footprint (e.g. "512 B", "20.00 KB", "1.50 MB") */
  ramFormatted: string;
  /** Resource fee in stroops reported by simulation */
  resourceFeeStroops: string;
  /** Base inclusion fee in stroops (defaults to BASE_FEE = "100") */
  baseFeeStroops: string;
  /** Total estimated fee (baseFeeStroops + resourceFeeStroops) in stroops */
  feeStroops: string;
  /** Total estimated fee in XLM */
  feeXLM: string;
}

/** Per-call account and retry overrides for {@link simulateContractCall}. */
export type SimulateContractCallOptions = ReadContractStateOptions;

function parseNonNegativeBigInt(value: string | number | bigint | undefined): bigint {
  if (value === undefined || value === null || value === '') return 0n;
  if (typeof value === 'bigint') return value >= 0n ? value : 0n;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return 0n;
    return BigInt(Math.trunc(value));
  }
  const trimmed = String(value).trim();
  if (!/^\d+$/.test(trimmed)) return 0n;
  return BigInt(trimmed);
}

function formatThousands(val: bigint): string {
  return val.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatRamBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Parses a Soroban simulation response (or {@link SimulationResult}) into
 * human-readable CPU instructions, RAM bytes, and fee metrics in stroops and XLM.
 *
 * @param simulation - Raw RPC simulation response or SDK SimulationResult
 * @param baseFeeStroops - Optional base inclusion fee in stroops (defaults to BASE_FEE = "100")
 * @returns Structured and human-readable resource footprint metrics
 */
export function parseResourceFootprint(
  simulation: {
    cost?: { cpuInsns?: string | number; memBytes?: string | number };
    minResourceFee?: string | number;
    restorePreamble?: { minResourceFee?: string | number };
  },
  baseFeeStroops: string | number | bigint = BASE_FEE,
): ResourceFootprintEstimate {
  const cpuBig = parseNonNegativeBigInt(simulation?.cost?.cpuInsns);
  const memBig = parseNonNegativeBigInt(simulation?.cost?.memBytes);
  const rawResourceFee =
    simulation?.minResourceFee ?? simulation?.restorePreamble?.minResourceFee ?? '0';
  const resourceFeeBig = parseNonNegativeBigInt(rawResourceFee);
  const baseFeeBig = parseNonNegativeBigInt(baseFeeStroops);
  const totalFeeBig = baseFeeBig + resourceFeeBig;

  const maxSafeBig = BigInt(Number.MAX_SAFE_INTEGER);
  const cpuInsns = cpuBig.toString();
  const cpuInstructions = cpuBig > maxSafeBig ? Number.MAX_SAFE_INTEGER : Number(cpuBig);
  const memBytes = memBig.toString();
  const ramBytes = memBig > maxSafeBig ? Number.MAX_SAFE_INTEGER : Number(memBig);

  return {
    cpuInsns,
    cpuInstructions,
    cpuFormatted: `${formatThousands(cpuBig)} instructions`,
    memBytes,
    ramBytes,
    ramFormatted: formatRamBytes(ramBytes),
    resourceFeeStroops: resourceFeeBig.toString(),
    baseFeeStroops: baseFeeBig.toString(),
    feeStroops: totalFeeBig.toString(),
    feeXLM: stroopsToXLM(totalFeeBig),
  };
}

/**
 * Simulates an already-assembled transaction envelope without submitting it.
 *
 * ### Retry behaviour
 *
 * A failing `simulateTransaction` transport is retried on transient failures
 * only (connection reset, timeout, `429`, `5xx`) with capped, jittered backoff.
 * A simulation *error* response is the node's verdict on the envelope, so it is
 * returned as `{ success: false, error }` on the first attempt and never
 * retried — replaying it would produce the same contract error.
 *
 * Each attempt is bounded by `options.timeoutMs`, falling back to the
 * client-wide {@link ClientConfig.timeoutMs}; once every attempt has timed out
 * and the retry budget is spent, the call throws `TIMEOUT`.
 *
 * ### Restore footprint
 *
 * When the simulation response indicates that expired ledger entries must be
 * restored before the transaction can succeed (`rpc.Api.isSimulationRestore`),
 * the result includes `needsRestore: true` and the `restorePreamble` so the
 * caller can build a restore transaction before re-submitting.
 *
 * @param client - Configured client, for the RPC URL and retry budget
 * @param xdr - Base64 transaction envelope to simulate
 * @param options - Per-call account, retry and timeout overrides
 * @returns `{ success: true, cost, returnValue }` or `{ success: false, error }`
 * @throws {TrustFlowError} `SIMULATION_ERROR` only when the RPC request itself
 *   fails after the retry budget is spent, `TIMEOUT` when every attempt
 *   exceeded the timeout budget
 *
 * @example
 * ```typescript
 * const dry = await simulateContractCall(client, envelopeXdr);
 * if (!dry.success) console.warn(dry.error);
 * ```
 */
export async function simulateContractCall(
  client: TrustFlowClient,
  xdr: string,
  options: SimulateContractCallOptions = {},
): Promise<SimulationResult> {
  client.resolveAccount(options.account);
  const server = client.getSorobanServer();
  try {
    const outcome: SimulationOutcome = await simulateTransaction(
      server,
      { toEnvelope: () => ({ toXDR: () => xdr }) } as any,
      options,
      client.retryConfig,
    );
    return {
      success: outcome.success,
      cost: outcome.cost,
      returnValue: outcome.returnValue,
      error: outcome.error,
      needsRestore: outcome.needsRestore,
      restorePreamble: outcome.restorePreamble,
      ...(outcome.minResourceFee !== undefined ? { minResourceFee: outcome.minResourceFee } : {}),
    };
  } catch (e) {
    // A `TIMEOUT` (or any typed SDK error) keeps its code rather than being
    // re-wrapped as a generic simulation failure.
    if (e instanceof TrustFlowError) throw e;
    logger.error('Contract simulation failed', { error: e });
    throw new TrustFlowError('Simulation failed', 'SIMULATION_ERROR', e);
  }
}

/**
 * Simulates a transaction envelope and returns human-readable CPU instructions,
 * RAM bytes, and fee estimates in stroops and XLM.
 *
 * @param client - Configured TrustFlowClient instance
 * @param xdr - Base64 transaction envelope to simulate
 * @param options - Per-call account, retry, timeout, and baseFeeStroops overrides
 * @returns Parsed resource footprint estimate
 * @throws {TrustFlowError} `SIMULATION_ERROR` when simulation returns an error or RPC fails
 */
export async function estimateResourceFootprint(
  client: TrustFlowClient,
  xdr: string,
  options: SimulateContractCallOptions & { baseFeeStroops?: string | number | bigint } = {},
): Promise<ResourceFootprintEstimate> {
  const sim = await simulateContractCall(client, xdr, options);
  if (!sim.success && !sim.needsRestore) {
    throw new TrustFlowError(sim.error ?? 'Contract simulation failed', 'SIMULATION_ERROR');
  }
  return parseResourceFootprint(sim, options.baseFeeStroops ?? BASE_FEE);
}
