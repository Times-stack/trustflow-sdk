import { formatBytes } from '../src/utils/request-validation';

describe('formatBytes large values (#564)', () => {
  it('formats TB and PB without undefined', () => {
    expect(formatBytes(1024 ** 4)).toBe('1 TB');
    expect(formatBytes(1024 ** 5)).toBe('1 PB');
    expect(formatBytes(1024 ** 6)).not.toContain('undefined');
    expect(formatBytes(1024 ** 3)).toBe('1 GB');
  });
});
