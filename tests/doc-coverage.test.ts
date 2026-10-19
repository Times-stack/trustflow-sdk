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
        `# API\n- \`documentedHelper\`\n- \`NamedExport\`\n- \`NamedType\`\n`,
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

  it('fails when TrustFlowClient is removed from docs/API.md against real src/index.ts', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trustflow-doc-real-'));
    try {
      const modifiedDocPath = path.join(tmpDir, 'API.md');
      const realDoc = fs.readFileSync(apiDocPath, 'utf8');
      const strippedDoc = realDoc.replace(/\bTrustFlowClient\b/g, 'RemovedClientPlaceholder');
      fs.writeFileSync(modifiedDocPath, strippedDoc, 'utf8');

      const result = checkDocCoverage({ entryPointPath, apiDocPath: modifiedDocPath });
      expect(result.ok).toBe(false);
      expect(result.missingSymbols).toContain('TrustFlowClient');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles circular barrel re-exports, comment-like string literals, destructuring, and case-sensitivity', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trustflow-doc-ast-'));
    try {
      const aFile = path.join(tmpDir, 'a.ts');
      const bFile = path.join(tmpDir, 'b.ts');
      const docFile = path.join(tmpDir, 'API.md');

      fs.writeFileSync(
        aFile,
        [
          `export * from './b';`,
          `const markerStart = '/* not a comment start';`,
          `export function survivingBetweenStrings() { return markerStart; }`,
          `const markerEnd = 'not a comment end */';`,
          `export const { alpha, beta: renamedBeta } = { alpha: 1, beta: markerEnd };`,
          `export const FIRST = 1, SECOND = 2;`,
        ].join('\n'),
        'utf8',
      );
      fs.writeFileSync(
        bFile,
        `export * from './a';\nexport interface CaseSensitiveSymbol { id: string; }\n`,
        'utf8',
      );

      const extracted: Set<string> = extractExportedSymbols(aFile);
      expect(Array.from(extracted).sort()).toEqual(
        [
          'CaseSensitiveSymbol',
          'FIRST',
          'SECOND',
          'alpha',
          'renamedBeta',
          'survivingBetweenStrings',
        ].sort(),
      );

      // Lowercase `casesensitivesymbol` in prose must not satisfy `CaseSensitiveSymbol`
      fs.writeFileSync(
        docFile,
        `# API\n` +
          `This mentions casesensitivesymbol in lowercase prose only.\n` +
          `- \`survivingBetweenStrings\`\n- \`alpha\`\n- \`renamedBeta\`\n- \`FIRST\`\n- \`SECOND\`\n`,
        'utf8',
      );
      const caseFail = checkDocCoverage({ entryPointPath: aFile, apiDocPath: docFile });
      expect(caseFail.ok).toBe(false);
      expect(caseFail.missingSymbols).toEqual(['CaseSensitiveSymbol']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
