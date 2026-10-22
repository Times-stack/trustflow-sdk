import { useState, useCallback, useRef } from 'react';
import type { TrustFlowClient } from '../client';
import type { Escrow, CreateEscrowParams } from '../types';
import { createEscrow, releaseEscrow, cancelEscrow, getEscrow, disputeEscrow } from '../escrow';

/** Opt-in optimistic behaviour shared by the mutating hook actions (#367). */
export interface OptimisticOptions {
  /** When true, the hook updates local state immediately and rolls back on failure. */
  optimistic?: boolean;
  /** Optional callback invoked when an optimistic update is rolled back. */
  onOptimisticRollback?: (error: Error, previous: Escrow | null) => void;
}

export interface CreateEscrowOptions extends OptimisticOptions {
  /** Optional id override for the optimistic placeholder. */
  optimisticId?: string;
}

export type ReleaseEscrowOptions = OptimisticOptions;

const generateOptimisticId = () =>
  `escrow-pending-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function useEscrow(client: TrustFlowClient) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [escrow, setEscrow] = useState<Escrow | null>(null);
  const callIdRef = useRef(0);
  // Mirrors `escrow` so optimistic snapshots never read a stale closure value.
  const escrowRef = useRef<Escrow | null>(null);

  const commitEscrow = useCallback((next: Escrow | null) => {
    escrowRef.current = next;
    setEscrow(next);
  }, []);

  const create = useCallback(
    async (params: CreateEscrowParams, options: CreateEscrowOptions = {}) => {
      const { optimistic = false, onOptimisticRollback, optimisticId } = options;
      const callId = ++callIdRef.current;
      const previous = escrowRef.current;
      setLoading(true);
      setError(null);
      if (optimistic) {
        commitEscrow({
          ...(previous ?? {}),
          id: optimisticId ?? generateOptimisticId(),
          status: 'PENDING',
          pending: true,
        } as Escrow);
      }
      try {
        const e = await createEscrow(client, params);
        if (callId === callIdRef.current) {
          commitEscrow(e);
        }
        return e;
      } catch (e: unknown) {
        const err = toError(e);
        if (callId === callIdRef.current) {
          if (optimistic) {
            commitEscrow(previous);
            onOptimisticRollback?.(err, previous);
          }
          setError(err.message);
        }
        throw e;
      } finally {
        if (callId === callIdRef.current) {
          setLoading(false);
        }
      }
    },
    [client, commitEscrow],
  );

  const release = useCallback(
    async (escrowId: string, caller: string, options: ReleaseEscrowOptions = {}) => {
      const { optimistic = false, onOptimisticRollback } = options;
      const callId = ++callIdRef.current;
      const previous = escrowRef.current;
      setLoading(true);
      setError(null);
      if (optimistic && previous) {
        commitEscrow({ ...previous, status: 'RELEASED', pending: true } as Escrow);
      }
      try {
        const result = await releaseEscrow(client, { escrowId, caller });
        const current = escrowRef.current;
        if (optimistic && current && callId === callIdRef.current) {
          commitEscrow({ ...current, pending: false } as Escrow);
        }
        return result;
      } catch (e: unknown) {
        const err = toError(e);
        if (callId === callIdRef.current) {
          if (optimistic) {
            commitEscrow(previous);
            onOptimisticRollback?.(err, previous);
          }
          setError(err.message);
        }
        throw e;
      } finally {
        if (callId === callIdRef.current) {
          setLoading(false);
        }
      }
    },
    [client, commitEscrow],
  );

  const cancel = useCallback(
    async (escrowId: string, caller: string) => {
      const callId = ++callIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const result = await cancelEscrow(client, escrowId, caller);
        return result;
      } catch (e: unknown) {
        if (callId === callIdRef.current) {
          setError(e instanceof Error ? e.message : String(e));
        }
        throw e;
      } finally {
        if (callId === callIdRef.current) {
          setLoading(false);
        }
      }
    },
    [client],
  );

  const dispute = useCallback(
    async (escrowId: string, caller: string, reason: string) => {
      const callId = ++callIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const result = await disputeEscrow(client, { escrowId, caller, reason });
        return result;
      } catch (e: unknown) {
        if (callId === callIdRef.current) {
          setError(e instanceof Error ? e.message : String(e));
        }
        throw e;
      } finally {
        if (callId === callIdRef.current) {
          setLoading(false);
        }
      }
    },
    [client],
  );

  const refresh = useCallback(
    async (escrowId: string) => {
      const callId = ++callIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const e = (await getEscrow(client, escrowId)) as Escrow | null;
        if (callId === callIdRef.current) {
          commitEscrow(e);
        }
        return e;
      } catch (e: unknown) {
        if (callId === callIdRef.current) {
          setError(e instanceof Error ? e.message : String(e));
        }
        throw e;
      } finally {
        if (callId === callIdRef.current) {
          setLoading(false);
        }
      }
    },
    [client, commitEscrow],
  );

  return { escrow, loading, error, create, release, cancel, dispute, refresh };
}
