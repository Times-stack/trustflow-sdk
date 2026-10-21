import { formatBytes } from '../src/utils/request-validation';

describe('formatBytes (#564)', () => {
  it('formats sizes below 1 TB as before', () => {
    expect(formatBytes(0)).toBe('0 Bytes');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1024 ** 2)).toBe('1 MB');
    expect(formatBytes(1024 ** 3)).toBe('1 GB');
  });

  it('formats sizes of 1 TB and above with a defined unit', () => {
    expect(formatBytes(1024 ** 4)).toBe('1 TB');
    expect(formatBytes(1024 ** 5)).toBe('1 PB');
  });

  it('never prints "undefined" for non-negative finite sizes', () => {
    for (const bytes of [0.5, 1, 1024 ** 4, 1024 ** 5, 1024 ** 6, Number.MAX_SAFE_INTEGER]) {
      expect(formatBytes(bytes)).not.toContain('undefined');
    }
  });

  it('clamps absurdly large sizes instead of indexing past the units array', () => {
    expect(formatBytes(1024 ** 6)).toBe(`${1024} PB`);
  });
});
