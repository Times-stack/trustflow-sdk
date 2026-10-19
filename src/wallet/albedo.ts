import type { WalletAdapter, WalletConnection, WalletType } from './types';
import { isWalletRejection } from './types';
import { TrustFlowError } from '../errors';

export interface AlbedoWallet {
  publicKey(params?: { token?: string }): Promise<{ pubkey: string; token: string }>;
  tx(params: {
    xdr: string;
    network?: string;
  }): Promise<{ signed_envelope_xdr: string; tx_hash: string }>;
  signMessage?(message: string): Promise<string>;
}

interface AlbedoWindow {
  albedo?: AlbedoWallet;
}

declare const window: AlbedoWindow | undefined;

export function getAlbedo(): AlbedoWallet | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window?.albedo ?? null;
}

/**
 * Concrete {@link WalletAdapter} implementation backed by the Albedo web wallet provider.
 */
export class AlbedoWalletAdapter implements WalletAdapter {
  readonly type: WalletType = 'albedo';

  async isAvailable(): Promise<boolean> {
    return Boolean(getAlbedo());
  }

  async connect(): Promise<WalletConnection> {
    const albedo = getAlbedo();
    if (!albedo) {
      throw new TrustFlowError('Albedo not available', 'UNAUTHORIZED');
    }
    try {
      const res = await albedo.publicKey();
      if (!res?.pubkey) {
        throw TrustFlowError.userRejected('User rejected Albedo connection');
      }
      return { type: 'albedo', publicKey: res.pubkey, network: 'TESTNET' };
    } catch (e: unknown) {
      if (isWalletRejection(e)) {
        throw TrustFlowError.userRejected(
          e instanceof Error ? e.message : 'User rejected Albedo connection',
          e,
        );
      }
      if (e instanceof TrustFlowError) throw e;
      throw TrustFlowError.wrap(e, 'UNAUTHORIZED');
    }
  }

  async sign(xdr: string, network: string = 'TESTNET'): Promise<string> {
    const albedo = getAlbedo();
    if (!albedo) {
      throw new TrustFlowError('Albedo not available', 'UNAUTHORIZED');
    }
    try {
      const res = await albedo.tx({ xdr, network });
      if (!res?.signed_envelope_xdr) {
        throw new TrustFlowError('Albedo returned an empty signed transaction', 'SIGNING_ERROR');
      }
      return res.signed_envelope_xdr;
    } catch (e: unknown) {
      if (isWalletRejection(e)) {
        throw TrustFlowError.userRejected(
          e instanceof Error ? e.message : 'User rejected Albedo transaction signing',
          e,
        );
      }
      if (e instanceof TrustFlowError) throw e;
      throw TrustFlowError.wrap(e, 'SIGNING_ERROR');
    }
  }

  async signMessage(message: string): Promise<string> {
    const albedo = getAlbedo();
    if (!albedo) {
      throw new TrustFlowError('Albedo not available', 'UNAUTHORIZED');
    }
    if (typeof albedo.signMessage === 'function') {
      try {
        return await albedo.signMessage(message);
      } catch (e: unknown) {
        if (isWalletRejection(e)) {
          throw TrustFlowError.userRejected(
            e instanceof Error ? e.message : 'User rejected Albedo message signing',
            e,
          );
        }
        if (e instanceof TrustFlowError) throw e;
        throw TrustFlowError.wrap(e, 'SIGNING_ERROR');
      }
    }
    throw new TrustFlowError('Albedo does not support arbitrary message signing', 'SIGNING_ERROR');
  }

  async disconnect(): Promise<void> {
    // Albedo sessions are stateless per prompt.
  }
}
