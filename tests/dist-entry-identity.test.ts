import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * #304 — the root and every subpath entry must share one copy of TrustFlowError and the
 * escrow classes, in both CJS and ESM output. Builds into a temporary directory and runs
 * the same check CI runs against `dist/`.
 */
const root = path.resolve(__dirname, '..');

describe('built entries share module identity (#304)', () => {
  let outDir: string;
  let packageRoot: string;

  beforeAll(() => {
    // Inside the project tree (and therefore inside `node_modules/`, which is
    // gitignored) so the built files resolve the SDK's own dependencies —
    // `require('axios')` from an OS temp dir cannot walk up to them, for the
    // CJS *and* ESM halves of the check.
    const cacheRoot = path.join(root, 'node_modules', '.cache');
    fs.mkdirSync(cacheRoot, { recursive: true });
    packageRoot = fs.mkdtempSync(path.join(cacheRoot, 'trustflow-package-'));
    outDir = path.join(packageRoot, 'dist');
    fs.mkdirSync(outDir, { recursive: true });
    fs.copyFileSync(path.join(root, 'package.json'), path.join(packageRoot, 'package.json'));
    execFileSync('npx', ['tsup', '--no-dts', '--out-dir', outDir], { cwd: root, stdio: 'pipe' });
  }, 180_000);

  afterAll(() => {
    fs.rmSync(packageRoot, { recursive: true, force: true });
  });

  it('resolves isWalletRejection through the public @trustflow/sdk/wallet subpath', () => {
    const checkScript = path.join(packageRoot, 'check-wallet-public-entry.cjs');
    fs.writeFileSync(
      checkScript,
      [
        "const assert = require('node:assert/strict');",
        "const cjs = require('@trustflow/sdk/wallet');",
        "assert.equal(typeof cjs.isWalletRejection, 'function');",
        "assert.equal(cjs.isWalletRejection({ code: 4001 }), true);",
        "assert.equal(cjs.isWalletRejection(new Error('network timeout')), false);",
        "(async () => {",
        "  const esm = await import('@trustflow/sdk/wallet');",
        "  assert.equal(typeof esm.isWalletRejection, 'function');",
        "  assert.equal(esm.isWalletRejection({ code: 'USER_REJECTED' }), true);",
        "  assert.equal(esm.isWalletRejection(new Error('network timeout')), false);",
        "})().catch((error) => { console.error(error); process.exitCode = 1; });",
      ].join('\n'),
    );

    expect(() =>
      execFileSync('node', [checkScript], { cwd: packageRoot, stdio: 'pipe' }),
    ).not.toThrow();
  }, 60_000);

  it('exposes identical classes and error identity across entries', () => {
    expect(() =>
      execFileSync('node', [path.join(root, 'scripts', 'check-dist-identity.js'), outDir], {
        cwd: root,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  }, 60_000);
});
