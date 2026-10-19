import type { WalletAdapter, WalletConnection, WalletType } from './types';
import { FreighterWalletAdapter } from './freighter';
import { AlbedoWalletAdapter } from './albedo';
import { TrustFlowError } from '../errors';

/**
 * Creates a {@link WalletAdapter} instance for the specified Stellar wallet provider.
 */
export function createWalletAdapter(type: WalletType = 'freighter'): WalletAdapter {
  if (type === 'freighter') {
    return new FreighterWalletAdapter();
  }
  if (type === 'albedo') {
    return new AlbedoWalletAdapter();
  }
  throw new TrustFlowError(`Wallet type ${type} not supported`, 'UNAUTHORIZED');
}

/**
 * Attempts to establish a connection with the specified Stellar wallet.
 * If the user rejects the connection dialog, a retryable TrustFlowError with
 * code 'USER_REJECTED' is thrown, leaving the connection state clean for subsequent attempts.
 */
export async function connectWallet(type: WalletType = 'freighter'): Promise<WalletConnection> {
  const adapter = createWalletAdapter(type);
  return adapter.connect();
}

export async function disconnectWallet(): Promise<void> {
  // Most Stellar wallets don't have a disconnect API — clear local state only
}
