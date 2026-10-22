import { useState, useEffect } from 'react';
import type { TrustFlowClient } from '../client';

/** The outcome of one balance lookup, tagged with the address it was made for. */
interface SettledBalance {
  address: string;
  balance: string | null;
  error: string | null;
}

export function useBalance(client: TrustFlowClient, address: string | null) {
  const [settled, setSettled] = useState<SettledBalance | null>(null);

  useEffect(() => {
    // Drop the previous account's result so it cannot show while the new one loads (#346).
    setSettled(null);
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

  // Only trust a result that belongs to the address being rendered; until it settles,
  // the hook reports loading rather than a balance from a different account.
  const current = settled && settled.address === address ? settled : null;
  return {
    balance: current?.balance ?? null,
    loading: address !== null && current === null,
    error: current?.error ?? null,
  };
}
