import type { WalletAdapter, WalletConnection, WalletType } from './types';
import { isWalletRejection } from './types';
import { TrustFlowError } from '../errors';

export interface FreighterWallet {
  isAvailable(): boolean;
  getPublicKey(): Promise<string>;
  signTransaction(xdr: string, opts: { network: string }): Promise<{ signedXDR: string }>;
  getNetwork(): Promise<string>;
  /**
   * Signs an arbitrary message (not a transaction) with the wallet's keypair.
   *
   * @param message - The message to sign as a UTF-8 string
   * @returns Base64-encoded ed25519 signature of the UTF-8 message bytes
   */
  signMessage(message: string): Promise<string>;
}

interface FreighterWindow {
  freighter?: {
    getPublicKey(): Promise<string>;
    signTransaction(xdr: string, opts: { network: string }): Promise<{ signedXDR: string }>;
    getNetwork(): Promise<string>;
    signMessage(message: string): Promise<string>;
  };
}

declare const window: FreighterWindow | undefined;

export function getFreighter(): FreighterWallet | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window?.freighter;
  if (!w) {
    return null;
  }
  return {
    isAvailable: () => true,
    getPublicKey: () => w.getPublicKey(),
    signTransaction: (xdr, opts) => w.signTransaction(xdr, opts),
    getNetwork: () => w.getNetwork(),
    signMessage: (message) => w.signMessage(message),
  };
}

export async function isFreighterInstalled(): Promise<boolean> {
  if (typeof window === 'undefined') {
    return false;
  }
  await new Promise((r) => setTimeout(r, 100));
  return !!window?.freighter;
}

/**
 * Concrete {@link WalletAdapter} implementation backed by the browser Freighter extension.
 */
export class FreighterWalletAdapter implements WalletAdapter {
  readonly type: WalletType = 'freighter';

  async isAvailable(): Promise<boolean> {
    return Boolean(getFreighter()?.isAvailable());
  }

  async connect(): Promise<WalletConnection> {
    const freighter = getFreighter();
    if (!freighter) {
      throw new TrustFlowError('Freighter not installed', 'UNAUTHORIZED');
    }
    try {
      const publicKey = await freighter.getPublicKey();
      if (!publicKey) {
        throw TrustFlowError.userRejected('User rejected Freighter connection');
      }
      const network = await freighter.getNetwork();
      return { type: 'freighter', publicKey, network: network || 'TESTNET' };
    } catch (e: unknown) {
      if (isWalletRejection(e)) {
        throw TrustFlowError.userRejected(
          e instanceof Error ? e.message : 'User rejected Freighter connection',
          e,
        );
      }
      if (e instanceof TrustFlowError) throw e;
      throw TrustFlowError.wrap(e, 'UNAUTHORIZED');
    }
  }

  async sign(xdr: string, network: string = 'TESTNET'): Promise<string> {
    const freighter = getFreighter();
    if (!freighter) {
      throw new TrustFlowError('Freighter not installed', 'UNAUTHORIZED');
    }
    try {
      const res = await freighter.signTransaction(xdr, { network });
      if (!res?.signedXDR) {
        throw new TrustFlowError('Freighter returned an empty signed transaction', 'SIGNING_ERROR');
      }
      return res.signedXDR;
    } catch (e: unknown) {
      if (isWalletRejection(e)) {
        throw TrustFlowError.userRejected(
          e instanceof Error ? e.message : 'User rejected Freighter transaction signing',
          e,
        );
      }
      if (e instanceof TrustFlowError) throw e;
      throw TrustFlowError.wrap(e, 'SIGNING_ERROR');
    }
  }

  async signMessage(message: string): Promise<string> {
    const freighter = getFreighter();
    if (!freighter) {
      throw new TrustFlowError('Freighter not installed', 'UNAUTHORIZED');
    }
    try {
      return await freighter.signMessage(message);
    } catch (e: unknown) {
      if (isWalletRejection(e)) {
        throw TrustFlowError.userRejected(
          e instanceof Error ? e.message : 'User rejected Freighter message signing',
          e,
        );
      }
      if (e instanceof TrustFlowError) throw e;
      throw TrustFlowError.wrap(e, 'SIGNING_ERROR');
    }
  }

  async disconnect(): Promise<void> {
    // Browser wallet extensions do not expose an explicit disconnect endpoint.
  }
}
