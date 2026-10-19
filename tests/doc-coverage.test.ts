import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { extractExportedSymbols, checkDocCoverage } = require('../scripts/check-doc-coverage.js');

const rootDir = path.resolve(__dirname, '..');
const entryPointPath = path.join(rootDir, 'src', 'index.ts');
const apiDocPath = path.join(rootDir, 'docs', 'API.md');

describe('scripts/check-doc-coverage.js (#452)', () => {
  it('extracts real barrel and named exports from src/index.ts without undefined entries', () => {
    const symbols: Set<string> = extractExportedSymbols(entryPointPath);
    expect(symbols.has(undefined as unknown as string)).toBe(false);
    expect(symbols.size).toBeGreaterThan(50);

    // Direct named re-exports in src/index.ts
    expect(symbols.has('TrustFlowClient')).toBe(true);
    expect(symbols.has('parseEvent')).toBe(true);
    expect(symbols.has('parseEvents')).toBe(true);
    expect(symbols.has('isTrustFlowEvent')).toBe(true);
    expect(symbols.has('ClientConfigSchema')).toBe(true);
    expect(symbols.has('CreateEscrowInput')).toBe(true);
    expect(symbols.has('GetBalanceOptions')).toBe(true);

    // Barrel `export * from './...'` re-exports
    expect(symbols.has('MultiSigEscrowClient')).toBe(true);
    expect(symbols.has('createEscrow')).toBe(true);
    expect(symbols.has('TransactionPipeline')).toBe(true);
    expect(symbols.has('TrustFlowError')).toBe(true);
  });

  it('passes checkDocCoverage against the current src/index.ts and docs/API.md', () => {
    const result = checkDocCoverage({ entryPointPath, apiDocPath });
    expect(result.missingSymbols).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('runs node scripts/check-doc-coverage.js with exit code 0', () => {
    expect(() =>
      execFileSync('node', [path.join(rootDir, 'scripts', 'check-doc-coverage.js')], {
        cwd: rootDir,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });

  it('detects drift when a documented symbol is removed from docs/API.md or a new export is added', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trustflow-doc-coverage-'));
    try {
      const subFile = path.join(tmpDir, 'sub.ts');
      const idxFile = path.join(tmpDir, 'index.ts');
      const docFile = path.join(tmpDir, 'API.md');

      fs.writeFileSync(
        subFile,
        `export function documentedHelper() {}\nexport class UndocumentedFeature {}\n`,
        'utf8',
      );
      fs.writeFileSync(
        idxFile,
        `export * from './sub';\nexport { NamedExport, type NamedType } from './other';\n`,
        'utf8',
      );
      fs.writeFileSync(
        docFile,
        `# API\n- \`TrustFlowClient\`\n- \`MultiSigEscrowClient\`\n- \`documentedHelper\`\n- \`NamedExport\`\n- \`NamedType\`\n`,
        'utf8',
      );

      const failResult = checkDocCoverage({ entryPointPath: idxFile, apiDocPath: docFile });
      expect(failResult.ok).toBe(false);
      expect(failResult.missingSymbols).toEqual(['UndocumentedFeature']);

      // Documenting the missing symbol resolves drift
      fs.appendFileSync(docFile, `- \`UndocumentedFeature\`\n`, 'utf8');
      const passResult = checkDocCoverage({ entryPointPath: idxFile, apiDocPath: docFile });
      expect(passResult.ok).toBe(true);
      expect(passResult.missingSymbols).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
