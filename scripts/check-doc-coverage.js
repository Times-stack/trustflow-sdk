const fs = require('fs');
const path = require('path');

const defaultApiDocPath = path.join(__dirname, '../docs/API.md');
const defaultEntryPointPath = path.join(__dirname, '../src/index.ts');

function resolveModulePath(baseDir, spec) {
  const target = path.resolve(baseDir, spec);
  if (fs.existsSync(`${target}.ts`) && fs.statSync(`${target}.ts`).isFile()) {
    return `${target}.ts`;
  }
  const indexTarget = path.join(target, 'index.ts');
  if (fs.existsSync(indexTarget) && fs.statSync(indexTarget).isFile()) {
    return indexTarget;
  }
  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    return target;
  }
  return null;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/**
 * Recursively extracts all public symbols exported from a TypeScript entry file,
 * walking `export * from './x'`, `export * as ns from './x'`,
 * `export { A, B as C, type D } [from './x']`, and direct `export` declarations.
 *
 * @param {string} filePath
 * @param {Set<string>} [visited]
 * @returns {Set<string>}
 */
function extractExportedSymbols(filePath, visited = new Set()) {
  const resolved = path.resolve(filePath);
  if (visited.has(resolved) || !fs.existsSync(resolved)) {
    return new Set();
  }
  visited.add(resolved);

  const raw = fs.readFileSync(resolved, 'utf8');
  const content = stripComments(raw);
  const dir = path.dirname(resolved);
  const symbols = new Set();

  // 1. Barrel re-exports: `export * from './module'` or `export type * from './module'`
  const starRegex = /export\s+(?:type\s+)?\*\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = starRegex.exec(content)) !== null) {
    const specifier = match[1];
    if (specifier.startsWith('.')) {
      const childPath = resolveModulePath(dir, specifier);
      if (childPath) {
        for (const sym of extractExportedSymbols(childPath, visited)) {
          symbols.add(sym);
        }
      }
    }
  }

  // 2. Namespace re-exports: `export * as name from './module'`
  const starNamespaceRegex =
    /export\s+(?:type\s+)?\*\s+as\s+([A-Za-z0-9_$]+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = starNamespaceRegex.exec(content)) !== null) {
    if (match[1]) {
      symbols.add(match[1]);
    }
  }

  // 3. Named export blocks: `export { A, B as C, type D } [from './module']`
  const namedExportRegex = /export\s+(?:type\s+)?\{([^}]+)\}/g;
  while ((match = namedExportRegex.exec(content)) !== null) {
    const entries = match[1].split(',');
    for (const rawEntry of entries) {
      const cleaned = rawEntry.trim().replace(/^type\s+/, '').trim();
      if (!cleaned) continue;
      const parts = cleaned.split(/\s+as\s+/);
      const exportedName = (parts[1] || parts[0]).trim();
      if (/^[A-Za-z0-9_$]+$/.test(exportedName) && exportedName !== 'default') {
        symbols.add(exportedName);
      }
    }
  }

  // 4. Direct declarations: `export [declare] [abstract] [async] (class|function|const|let|var|enum|interface|type) Name`
  const declarationRegex =
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function|const|let|var|enum|interface|type)\s+([A-Za-z0-9_$]+)/g;
  while ((match = declarationRegex.exec(content)) !== null) {
    if (match[1]) {
      symbols.add(match[1]);
    }
  }

  return symbols;
}

/**
 * Checks that every symbol exported from `entryPointPath` is documented in `apiDocPath`.
 *
 * @param {{ entryPointPath?: string; apiDocPath?: string }} [options]
 * @returns {{ ok: boolean; exportedSymbols: string[]; missingSymbols: string[] }}
 */
function checkDocCoverage(options = {}) {
  const entryPointPath = options.entryPointPath || defaultEntryPointPath;
  const apiDocPath = options.apiDocPath || defaultApiDocPath;

  if (!fs.existsSync(apiDocPath) || !fs.existsSync(entryPointPath)) {
    return { ok: false, exportedSymbols: [], missingSymbols: [] };
  }

  const docContent = fs.readFileSync(apiDocPath, 'utf8');
  const exportedSymbols = extractExportedSymbols(entryPointPath);

  const coreTargets = ['MultiSigEscrowClient', 'TrustFlowClient'];
  for (const target of coreTargets) {
    exportedSymbols.add(target);
  }

  const missingSymbols = [];
  for (const symbol of exportedSymbols) {
    if (!symbol) continue;
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(#|\\b)${escaped}\\b`, 'i');
    if (!pattern.test(docContent)) {
      missingSymbols.push(symbol);
    }
  }

  return {
    ok: missingSymbols.length === 0 && exportedSymbols.size > 0,
    exportedSymbols: Array.from(exportedSymbols),
    missingSymbols,
  };
}

if (require.main === module) {
  if (!fs.existsSync(defaultApiDocPath) || !fs.existsSync(defaultEntryPointPath)) {
    console.error('❌ Required files (docs/API.md or src/index.ts) were not found.');
    process.exit(1);
  }

  console.log('🔍 Running TrustFlow SDK public surface documentation drift checks...');
  const result = checkDocCoverage();

  for (const symbol of result.missingSymbols) {
    console.error(
      `❌ Drift Detected: '${symbol}' is exported publicly from src/index.ts but missing from docs/API.md!`,
    );
  }

  if (!result.ok) {
    console.error(
      `📊 Documentation sync check failed (${result.missingSymbols.length} undocumented symbol(s) out of ${result.exportedSymbols.length} exported). Please document missing components inside docs/API.md.`,
    );
    process.exit(1);
  }

  console.log(
    `✅ Documentation synchronization surface check passed successfully (${result.exportedSymbols.length} exported symbols verified)!`,
  );
  process.exit(0);
}

module.exports = {
  extractExportedSymbols,
  checkDocCoverage,
};
