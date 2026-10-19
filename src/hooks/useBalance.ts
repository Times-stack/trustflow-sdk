import { useState, useEffect } from 'react';
import type { TrustFlowClient } from '../client';

export function useBalance(client: TrustFlowClient, address: string | null) {
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setBalance(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setBalance(null);
    setError(null);
    setLoading(true);
    client
      .getBalance(address)
      .then((b) => {
        if (!cancelled && !controller.signal.aborted) {
          setBalance(b);
        }
      })
      .catch((e) => {
        if (!cancelled && !controller.signal.aborted) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled && !controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, address]);

  return { balance, loading, error };
}
