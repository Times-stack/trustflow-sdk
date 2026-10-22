/**
 * #107, #473 — `useEscrow`'s create, release, cancel, dispute, refresh paths,
 * and overlapping call guards, rendered with a real React renderer.
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';

jest.mock('../src/escrow', () => ({
  createEscrow: jest.fn(),
  releaseEscrow: jest.fn(),
  cancelEscrow: jest.fn(),
  getEscrow: jest.fn(),
  disputeEscrow: jest.fn(),
}));

import * as escrow from '../src/escrow';
import { useEscrow } from '../src/hooks/useEscrow';

const mockCreate = escrow.createEscrow as jest.Mock;
const mockRelease = escrow.releaseEscrow as jest.Mock;
const mockCancel = escrow.cancelEscrow as jest.Mock;
const mockGet = escrow.getEscrow as jest.Mock;
const mockDispute = escrow.disputeEscrow as jest.Mock;

const client = {} as never;

describe('useEscrow — create (#107)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the escrow, stores it, and clears error/loading on success', async () => {
    const created = { id: 'escrow-1', status: 'PENDING' };
    mockCreate.mockResolvedValueOnce(created);
    const { result } = renderHook(() => useEscrow(client));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.create({
        sender: 'GA',
        recipient: 'GB',
        amountStroops: 100n,
      } as never);
    });

    expect(returned).toBe(created);
    expect(mockCreate).toHaveBeenCalledWith(client, expect.objectContaining({ sender: 'GA' }));
    expect(result.current.escrow).toBe(created);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('surfaces the error message and rethrows on failure', async () => {
    mockCreate.mockRejectedValueOnce(new Error('minimum amount not met'));
    const { result } = renderHook(() => useEscrow(client));

    await act(async () => {
      await expect(result.current.create({} as never)).rejects.toThrow('minimum amount not met');
    });

    expect(result.current.error).toBe('minimum amount not met');
    expect(result.current.escrow).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});

describe('useEscrow — release (#107)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the release result on success', async () => {
    mockRelease.mockResolvedValueOnce('tx_release_abc');
    const { result } = renderHook(() => useEscrow(client));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.release('escrow-1', 'GA');
    });

    expect(returned).toBe('tx_release_abc');
    expect(mockRelease).toHaveBeenCalledWith(client, { escrowId: 'escrow-1', caller: 'GA' });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('surfaces the error message and rethrows on failure', async () => {
    mockRelease.mockRejectedValueOnce(new Error('unauthorized'));
    const { result } = renderHook(() => useEscrow(client));

    await act(async () => {
      await expect(result.current.release('escrow-1', 'GA')).rejects.toThrow('unauthorized');
    });

    expect(result.current.error).toBe('unauthorized');
    expect(result.current.loading).toBe(false);
  });

  it('stringifies a non-Error rejection', async () => {
    mockRelease.mockRejectedValueOnce('denied');
    const { result } = renderHook(() => useEscrow(client));

    await act(async () => {
      await expect(result.current.release('escrow-1', 'GA')).rejects.toBe('denied');
    });

    expect(result.current.error).toBe('denied');
  });

  it('clears a previous error on the next call', async () => {
    mockRelease.mockRejectedValueOnce(new Error('first'));
    mockRelease.mockResolvedValueOnce('tx_release_abc');
    const { result } = renderHook(() => useEscrow(client));

    await act(async () => {
      await expect(result.current.release('escrow-1', 'GA')).rejects.toThrow('first');
    });
    await act(async () => {
      await result.current.release('escrow-1', 'GA');
    });

    expect(result.current.error).toBeNull();
  });
});

describe('useEscrow — optimistic updates (#367)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows a temporary pending escrow immediately when optimistic is enabled', async () => {
    let resolveCreate: (v: unknown) => void = () => {};
    mockCreate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve as (v: unknown) => void;
        }),
    );
    const { result } = renderHook(() => useEscrow(client));

    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.create(
        { sender: 'GA', recipient: 'GB', amountStroops: 100n } as never,
        { optimistic: true },
      );
    });

    expect(result.current.escrow).toMatchObject({ status: 'PENDING', pending: true });
    expect(result.current.loading).toBe(true);

    const confirmed = { id: 'escrow-1', status: 'PENDING' };
    await act(async () => {
      resolveCreate(confirmed);
      await pending;
    });

    expect(result.current.escrow).toBe(confirmed);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('rolls back the optimistic escrow and notifies the caller on create failure', async () => {
    const onOptimisticRollback = jest.fn();
    mockCreate.mockRejectedValueOnce(new Error('minimum amount not met'));
    const { result } = renderHook(() => useEscrow(client));

    await act(async () => {
      await expect(
        result.current.create(
          { sender: 'GA', recipient: 'GB', amountStroops: 100n } as never,
          { optimistic: true, onOptimisticRollback },
        ),
      ).rejects.toThrow('minimum amount not met');
    });

    expect(result.current.escrow).toBeNull();
    expect(result.current.error).toBe('minimum amount not met');
    expect(result.current.loading).toBe(false);
    expect(onOptimisticRollback).toHaveBeenCalledWith(expect.any(Error), null);
  });

  it('marks the escrow released optimistically and clears the pending flag on success', async () => {
    mockCreate.mockResolvedValueOnce({ id: 'escrow-1', status: 'FUNDED' });
    const { result } = renderHook(() => useEscrow(client));

    await act(async () => {
      await result.current.create({} as never);
    });

    let resolveRelease: (v: unknown) => void = () => {};
    mockRelease.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRelease = resolve as (v: unknown) => void;
        }),
    );

    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.release('escrow-1', 'GA', { optimistic: true });
    });

    expect(result.current.escrow).toMatchObject({ status: 'RELEASED', pending: true });

    await act(async () => {
      resolveRelease('tx_release_abc');
      await pending;
    });

    expect(result.current.escrow).toMatchObject({ id: 'escrow-1', status: 'RELEASED', pending: false });
    expect(result.current.error).toBeNull();
  });

  it('restores the previous escrow and notifies the caller when an optimistic release fails', async () => {
    const onOptimisticRollback = jest.fn();
    const funded = { id: 'escrow-1', status: 'FUNDED' };
    mockCreate.mockResolvedValueOnce(funded);
    const { result } = renderHook(() => useEscrow(client));

    await act(async () => {
      await result.current.create({} as never);
    });

    mockRelease.mockRejectedValueOnce(new Error('unauthorized'));
    await act(async () => {
      await expect(
        result.current.release('escrow-1', 'GA', { optimistic: true, onOptimisticRollback }),
      ).rejects.toThrow('unauthorized');
    });

    expect(result.current.escrow).toBe(funded);
    expect(result.current.error).toBe('unauthorized');
    expect(onOptimisticRollback).toHaveBeenCalledWith(expect.any(Error), funded);
  });
});

describe('useEscrow — cancel (#473)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the cancellation result on success and manages loading/error state', async () => {
    mockCancel.mockResolvedValueOnce('tx_cancel_abc');
    const { result } = renderHook(() => useEscrow(client));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.cancel('escrow-1', 'GA');
    });

    expect(returned).toBe('tx_cancel_abc');
    expect(mockCancel).toHaveBeenCalledWith(client, 'escrow-1', 'GA');
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('surfaces error message and rethrows on cancel failure', async () => {
    mockCancel.mockRejectedValueOnce(new Error('only sender may cancel'));
    const { result } = renderHook(() => useEscrow(client));

    await act(async () => {
      await expect(result.current.cancel('escrow-1', 'GA')).rejects.toThrow('only sender may cancel');
    });

    expect(result.current.error).toBe('only sender may cancel');
    expect(result.current.loading).toBe(false);
  });
});

describe('useEscrow — dispute (#473)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the dispute result on success and manages loading/error state', async () => {
    mockDispute.mockResolvedValueOnce('tx_dispute_123');
    const { result } = renderHook(() => useEscrow(client));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.dispute('escrow-1', 'GA', 'goods never arrived at delivery address');
    });

    expect(returned).toBe('tx_dispute_123');
    expect(mockDispute).toHaveBeenCalledWith(client, {
      escrowId: 'escrow-1',
      caller: 'GA',
      reason: 'goods never arrived at delivery address',
    });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('surfaces error message and rethrows on dispute failure', async () => {
    mockDispute.mockRejectedValueOnce(new Error('dispute period expired'));
    const { result } = renderHook(() => useEscrow(client));

    await act(async () => {
      await expect(
        result.current.dispute('escrow-1', 'GA', 'reason'),
      ).rejects.toThrow('dispute period expired');
    });

    expect(result.current.error).toBe('dispute period expired');
    expect(result.current.loading).toBe(false);
  });
});

describe('useEscrow — refresh (#473)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetches on-chain state, updates escrow state, and clears error on success', async () => {
    const refreshed = { id: 'escrow-1', status: 'RELEASED', amount: 500n };
    mockGet.mockResolvedValueOnce(refreshed);
    const { result } = renderHook(() => useEscrow(client));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.refresh('escrow-1');
    });

    expect(returned).toBe(refreshed);
    expect(mockGet).toHaveBeenCalledWith(client, 'escrow-1');
    expect(result.current.escrow).toBe(refreshed);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('surfaces error message and rethrows on refresh failure', async () => {
    mockGet.mockRejectedValueOnce(new Error('escrow not found'));
    const { result } = renderHook(() => useEscrow(client));

    await act(async () => {
      await expect(result.current.refresh('escrow-unknown')).rejects.toThrow('escrow not found');
    });

    expect(result.current.error).toBe('escrow not found');
    expect(result.current.loading).toBe(false);
  });
});

describe('useEscrow — overlapping calls guard (#473)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('preserves state from the latest call when an earlier call resolves afterwards', async () => {
    let resolveFirst!: (val: unknown) => void;
    let resolveSecond!: (val: unknown) => void;

    mockRelease.mockReturnValueOnce(new Promise((res) => { resolveFirst = res; }));
    mockCancel.mockReturnValueOnce(new Promise((res) => { resolveSecond = res; }));

    const { result } = renderHook(() => useEscrow(client));

    let promise1: Promise<unknown>;
    let promise2: Promise<unknown>;

    // Start call 1 (release)
    act(() => {
      promise1 = result.current.release('escrow-1', 'GA');
    });

    expect(result.current.loading).toBe(true);

    // Start call 2 (cancel)
    act(() => {
      promise2 = result.current.cancel('escrow-1', 'GA');
    });

    expect(result.current.loading).toBe(true);

    // Call 2 finishes first
    await act(async () => {
      resolveSecond('tx_cancel_latest');
      await promise2;
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();

    // Call 1 finishes later
    await act(async () => {
      resolveFirst('tx_release_stale');
      await promise1;
    });

    // Loading must stay false and not be overwritten
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not overwrite error state if an earlier call rejects after a later call succeeds', async () => {
    let rejectFirst!: (err: unknown) => void;
    let resolveSecond!: (val: unknown) => void;

    mockRelease.mockReturnValueOnce(new Promise((_, rej) => { rejectFirst = rej; }));
    mockCancel.mockReturnValueOnce(new Promise((res) => { resolveSecond = res; }));

    const { result } = renderHook(() => useEscrow(client));

    let promise1: Promise<unknown>;
    let promise2: Promise<unknown>;

    act(() => {
      promise1 = result.current.release('escrow-1', 'GA');
    });

    act(() => {
      promise2 = result.current.cancel('escrow-1', 'GA');
    });

    // Call 2 succeeds
    await act(async () => {
      resolveSecond('tx_cancel_success');
      await promise2;
    });

    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);

    // Call 1 fails later
    await act(async () => {
      rejectFirst(new Error('stale error'));
      await promise1.catch(() => {});
    });

    // Stale error must be discarded
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
