import { SDKLogger, createLogger, type Logger } from '../src/utils/logger';

describe('SDKLogger level filtering', () => {
  let debugSpy: jest.SpyInstance;
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('only emits at or above the minimum level (default error)', () => {
    const log = new SDKLogger();
    expect(log.getMinLevel()).toBe('error');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('emits debug when minLevel is debug, and setMinLevel updates at runtime', () => {
    const log = new SDKLogger({ minLevel: 'debug' });
    log.debug('d');
    expect(debugSpy).toHaveBeenCalledTimes(1);
    log.setMinLevel('silent');
    log.error('e');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('delegates to an injected application logger', () => {
    const calls: Array<[string, unknown?]> = [];
    const appLogger: Logger = {
      debug: (m, c) => void calls.push(['debug', c ?? m]),
      info: (m, c) => void calls.push(['info', c ?? m]),
      warn: (m, c) => void calls.push(['warn', c ?? m]),
      error: (m, c) => void calls.push(['error', c ?? m]),
    };
    const log = new SDKLogger({ minLevel: 'debug', logger: appLogger });
    log.debug('hello', { a: 1 });
    log.error('boom');
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe('debug');
    // Nothing should go to the real console when a custom logger is set
    expect(debugSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('redacts secrets (Authorization, api keys, tokens) from context', () => {
    const log = new SDKLogger({ minLevel: 'debug' });
    log.info('request', {
      Authorization: 'Bearer secret',
      apiKey: 'super-secret',
      nested: { token: 'abc', safe: 'ok' },
    });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const context = infoSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(context['Authorization']).toBe('[REDACTED]');
    expect(context['apiKey']).toBe('[REDACTED]');
    expect((context['nested'] as Record<string, unknown>)['token']).toBe('[REDACTED]');
    expect((context['nested'] as Record<string, unknown>)['safe']).toBe('ok');
  });

  it('preserves array shape and order in logged context', () => {
    const log = new SDKLogger({ minLevel: 'debug' });
    log.info('batch', {
      items: [1, 2, 3],
      empty: [],
      nestedArrays: [['a', 'b'], ['c']],
      note: 'ok',
    });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const context = infoSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(Array.isArray(context['items'])).toBe(true);
    expect(context['items']).toEqual([1, 2, 3]);
    expect(Array.isArray(context['empty'])).toBe(true);
    expect(context['empty']).toEqual([]);
    expect(Array.isArray(context['nestedArrays'])).toBe(true);
    expect(context['nestedArrays']).toEqual([['a', 'b'], ['c']]);
    expect(context['note']).toBe('ok');
  });

  it('redacts sensitive keys inside array elements while preserving array shape', () => {
    const log = new SDKLogger({ minLevel: 'debug' });
    log.info('credentials', {
      entries: [
        { apiKey: 'secret-1', label: 'primary' },
        { password: 'secret-2', nested: [{ token: 'secret-3', id: 42 }] },
      ],
      tokens: [{ apiKey: 'x' }],
      rawTokens: ['jwt-1', 'jwt-2'],
      nestedRawTokens: [['jwt-3', 'jwt-4']],
    });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const context = infoSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(Array.isArray(context['entries'])).toBe(true);
    expect(context['entries']).toEqual([
      { apiKey: '[REDACTED]', label: 'primary' },
      { password: '[REDACTED]', nested: [{ token: '[REDACTED]', id: 42 }] },
    ]);
    expect(Array.isArray(context['tokens'])).toBe(true);
    expect(context['tokens']).toEqual([{ apiKey: '[REDACTED]' }]);
    expect(Array.isArray(context['rawTokens'])).toBe(true);
    expect(context['rawTokens']).toEqual(['[REDACTED]', '[REDACTED]']);
    expect(Array.isArray(context['nestedRawTokens'])).toBe(true);
    expect(context['nestedRawTokens']).toEqual([['[REDACTED]', '[REDACTED]']]);
  });

  it('preserves top-level array context and redacts sensitive elements', () => {
    const log = new SDKLogger({ minLevel: 'debug' });
    log.info('top-level-array', [{ apiKey: 'secret' }, 'plain-item']);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const context = infoSpy.mock.calls[0][1];
    expect(Array.isArray(context)).toBe(true);
    expect(context).toEqual([{ apiKey: '[REDACTED]' }, 'plain-item']);
  });

  it('handles circular references and shared object references safely', () => {
    const log = new SDKLogger({ minLevel: 'debug' });
    const circularArray: unknown[] = ['first'];
    circularArray.push(circularArray);

    const sharedItem = { apiKey: 'secret-shared', label: 'shared' };
    log.info('cycles-and-shared', {
      cycle: circularArray,
      shared: [sharedItem, sharedItem],
    });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const context = infoSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(Array.isArray(context['cycle'])).toBe(true);
    expect(context['cycle']).toEqual(['first', '[Circular]']);
    expect(context['shared']).toEqual([
      { apiKey: '[REDACTED]', label: 'shared' },
      { apiKey: '[REDACTED]', label: 'shared' },
    ]);
  });

  it('emits structured JSON with timestamp/scope/message/context', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const log = new SDKLogger({ minLevel: 'info', json: true, prefix: 'TestScope' });
    log.debug('suppressed');
    log.info('hello', { foo: 'bar', password: 'secret' });
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('suppressed'));
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(payload.scope).toBe('TestScope');
    expect(payload.level).toBe('INFO');
    expect(payload.message).toBe('hello');
    expect(payload.timestamp).toBeDefined();
    expect(payload.context.foo).toBe('bar');
    expect(payload.context.password).toBe('[REDACTED]');
    logSpy.mockRestore();
  });

  it('does not touch context when the level is disabled (cheap)', () => {
    const log = new SDKLogger({ minLevel: 'error' });
    let accessed = false;
    const context = {};
    Object.defineProperty(context, 'expensive', {
      get() {
        accessed = true;
        return 'x';
      },
    });
    log.debug('nope', context);
    expect(accessed).toBe(false);
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('createLogger sets a custom prefix', () => {
    const log = createLogger('MyApp', { minLevel: 'info' });
    log.info('hi');
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(String(infoSpy.mock.calls[0][0])).toContain('[MyApp]');
  });
});
