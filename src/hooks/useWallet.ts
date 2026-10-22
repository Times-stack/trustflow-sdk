import { useState, useCallback, useRef } from 'react';
import type { WalletConnection, WalletType } from '../wallet/types';
import { isWalletRejection } from '../wallet/types';
import { connectWallet, disconnectWallet } from '../wallet/connect';
import { SessionManager } from '../auth/session';

/**
 * React hook for managing wallet connection lifecycle, handling rejections gracefully,
 * and enabling instant retries without requiring a page reload.
 */
export function useWallet() {
  const [wallet, setWallet] = useState<WalletConnection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRejected, setIsRejected] = useState(false);
  const lastTypeRef = useRef<WalletType>('freighter');
  const walletRef = useRef<WalletConnection | null>(null);

  const reset = useCallback(() => {
    setError(null);
    setIsRejected(false);
  }, []);

  const connect = useCallback(async (type: WalletType = 'freighter') => {
    lastTypeRef.current = type;
    setLoading(true);
    setError(null);
    setIsRejected(false);
    try {
      const w = await connectWallet(type);
      walletRef.current = w;
      setWallet(w);
      setIsRejected(false);
      return w;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      if (isWalletRejection(e)) {
        setIsRejected(true);
      }
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const retry = useCallback(async () => {
    return connect(lastTypeRef.current);
  }, [connect]);

  const disconnect = useCallback(async () => {
    const activeAddress = walletRef.current?.publicKey;
    try {
      await disconnectWallet();
    } finally {
      SessionManager.clear(activeAddress);
      walletRef.current = null;
      setWallet(null);
      setError(null);
      setIsRejected(false);
    }
  }, []);

  return {
    wallet,
    loading,
    error,
    isRejected,
    connect,
    retry,
    reset,
    disconnect,
    isConnected: !!wallet,
  };
}
