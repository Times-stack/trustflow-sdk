import { AccountBalanceMonitor, LowBalanceAlert, BalanceUpdate } from '../src/stellar/monitor';
import type { AccountInfo } from '../src/stellar/account';

describe('AccountBalanceMonitor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('throws an error if no address is provided', () => {
    expect(() => new AccountBalanceMonitor({ address: '' })).toThrow(
      'Account address is required for monitoring',
    );
  });

  it('validates minBalanceXLM threshold and throws on invalid or non-finite values (#556)', () => {
    expect(() => new AccountBalanceMonitor({ address: 'GBM123', minBalanceXLM: 'not-a-number' })).toThrow(
      /Invalid minBalanceXLM threshold/i,
    );
    expect(() => new AccountBalanceMonitor({ address: 'GBM123', minBalanceXLM: NaN })).toThrow(
      /Invalid minBalanceXLM threshold/i,
    );
    expect(() => new AccountBalanceMonitor({ address: 'GBM123', minBalanceXLM: Infinity })).toThrow(
      /Invalid minBalanceXLM threshold/i,
    );
    expect(() => new AccountBalanceMonitor({ address: 'GBM123', minBalanceXLM: -Infinity })).toThrow(
      /Invalid minBalanceXLM threshold/i,
    );
  });

  it('accepts valid numeric and numeric-string minBalanceXLM thresholds (#556)', () => {
    expect(() => new AccountBalanceMonitor({ address: 'GBM123', minBalanceXLM: 10 })).not.toThrow();
    expect(() => new AccountBalanceMonitor({ address: 'GBM123', minBalanceXLM: '10' })).not.toThrow();
    expect(() => new AccountBalanceMonitor({ address: 'GBM123', minBalanceXLM: '0.5' })).not.toThrow();
    expect(() => new AccountBalanceMonitor({ address: 'GBM123', minBalanceXLM: 0 })).not.toThrow();
  });

  it('polls balance and triggers balance_update event', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      address: 'GBM123',
      balanceXLM: '100.5',
      sequenceNumber: '12345',
      isActive: true,
    } as AccountInfo);

    const monitor = new AccountBalanceMonitor({
      address: 'GBM123',
      minBalanceXLM: 20,
      fetchFn: mockFetch,
    });

    let update: BalanceUpdate | null = null;
    monitor.on('balance_update', (data) => {
      update = data;
    });

    await monitor.checkNow();

    expect(mockFetch).toHaveBeenCalledWith('GBM123', 'TESTNET');
    expect(update).not.toBeNull();
    expect(update?.balanceXLM).toBe('100.5');
    expect(update?.address).toBe('GBM123');
  });

  it('triggers low_balance event when balance falls below threshold', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      address: 'GBM123',
      balanceXLM: '5.0',
      sequenceNumber: '12345',
      isActive: true,
    } as AccountInfo);

    const monitor = new AccountBalanceMonitor({
      address: 'GBM123',
      minBalanceXLM: 10,
      fetchFn: mockFetch,
    });

    let alert: LowBalanceAlert | null = null;
    monitor.on('low_balance', (data) => {
      alert = data;
    });

    await monitor.checkNow();

    expect(alert).not.toBeNull();
    expect(alert?.currentBalanceXLM).toBe('5.0');
    expect(alert?.thresholdXLM).toBe('10');
  });

  it('sends webhook notification on low balance', async () => {
    const originalFetch = global.fetch;
    const mockGlobalFetch = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = mockGlobalFetch as any;

    const mockFetch = jest.fn().mockResolvedValue({
      address: 'GBM123',
      balanceXLM: '2.5',
      sequenceNumber: '12345',
      isActive: true,
    } as AccountInfo);

    const monitor = new AccountBalanceMonitor({
      address: 'GBM123',
      minBalanceXLM: 10,
      webhookUrl: 'https://alerts.example.com/webhook',
      fetchFn: mockFetch,
    });

    await monitor.checkNow();

    expect(mockGlobalFetch).toHaveBeenCalledWith(
      'https://alerts.example.com/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );

    global.fetch = originalFetch;
  });

  it('manages polling lifecycle with start and stop', () => {
    const mockFetch = jest.fn().mockResolvedValue({
      address: 'GBM123',
      balanceXLM: '50',
      sequenceNumber: '1',
      isActive: true,
    });

    const monitor = new AccountBalanceMonitor({
      address: 'GBM123',
      pollIntervalMs: 5000,
      fetchFn: mockFetch,
    });

    expect(monitor.isRunning()).toBe(false);
    monitor.start();
    expect(monitor.isRunning()).toBe(true);

    jest.advanceTimersByTime(5000);
    expect(mockFetch).toHaveBeenCalled();

    monitor.stop();
    expect(monitor.isRunning()).toBe(false);
  });

  it('does not overlap fetchFn calls when a poll tick fires before the previous check resolves', async () => {
    let resolveFirstFetch!: (info: AccountInfo) => void;
    let inFlightCount = 0;
    let maxInFlightCount = 0;

    const mockFetch = jest
      .fn<Promise<AccountInfo>, [string, string]>()
      .mockImplementationOnce(() => {
        inFlightCount += 1;
        maxInFlightCount = Math.max(maxInFlightCount, inFlightCount);
        return new Promise<AccountInfo>((resolve) => {
          resolveFirstFetch = (info) => {
            inFlightCount -= 1;
            resolve(info);
          };
        });
      })
      .mockImplementation(async () => {
        inFlightCount += 1;
        maxInFlightCount = Math.max(maxInFlightCount, inFlightCount);
        inFlightCount -= 1;
        return {
          address: 'GBM123',
          balanceXLM: '40',
          sequenceNumber: '2',
          isActive: true,
        };
      });

    const updates: BalanceUpdate[] = [];
    const monitor = new AccountBalanceMonitor({
      address: 'GBM123',
      pollIntervalMs: 1000,
      fetchFn: mockFetch,
    });
    monitor.on('balance_update', (u) => {
      updates.push(u);
    });

    monitor.start();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Advance past two poll ticks while the first fetchFn is still pending
    jest.advanceTimersByTime(2500);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(maxInFlightCount).toBe(1);

    // Direct checkNow() call also coalesces onto the in-flight check
    const inFlight = monitor.checkNow();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Resolve the first fetchFn and wait for the coalesced check to complete
    resolveFirstFetch({
      address: 'GBM123',
      balanceXLM: '50',
      sequenceNumber: '1',
      isActive: true,
    });
    await inFlight;

    expect(updates).toHaveLength(1);
    expect(updates[0].balanceXLM).toBe('50');

    // Subsequent poll tick after completion should trigger a new fetchFn call
    jest.advanceTimersByTime(1000);
    await monitor.checkNow();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(maxInFlightCount).toBe(1);
    expect(updates).toHaveLength(2);
    expect(updates[1].balanceXLM).toBe('40');
    expect(updates[1].previousBalanceXLM).toBe('50');

    monitor.stop();
  });

  it('aborts a hung webhook POST after webhookTimeoutMs and does not block the monitor', async () => {
    const originalFetch = global.fetch;
    let aborted = false;

    const mockGlobalFetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('Aborted'));
          });
        }
      });
    });
    global.fetch = mockGlobalFetch as any;

    const mockFetch = jest.fn().mockResolvedValue({
      address: 'GBM123',
      balanceXLM: '2.0',
      sequenceNumber: '12345',
      isActive: true,
    } as AccountInfo);

    const monitor = new AccountBalanceMonitor({
      address: 'GBM123',
      minBalanceXLM: 10,
      webhookUrl: 'https://alerts.example.com/hung-webhook',
      webhookTimeoutMs: 500,
      fetchFn: mockFetch,
    });

    const checkPromise = monitor.checkNow();
    await Promise.resolve();

    expect(mockGlobalFetch).toHaveBeenCalledTimes(1);
    expect(aborted).toBe(false);

    // Advance past webhookTimeoutMs so fetchWithTimeout aborts the hung webhook
    jest.advanceTimersByTime(500);

    const result = await checkPromise;
    expect(aborted).toBe(true);
    expect(result).not.toBeNull();
    expect(result?.balanceXLM).toBe('2.0');

    // Verify the monitor is no longer blocked and can execute another checkNow()
    mockGlobalFetch.mockResolvedValueOnce({ ok: true });
    const secondResult = await monitor.checkNow();
    expect(secondResult?.balanceXLM).toBe('2.0');
    expect(mockFetch).toHaveBeenCalledTimes(2);

    global.fetch = originalFetch;
  });
});
