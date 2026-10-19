const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const defaultApiDocPath = path.join(__dirname, '../docs/API.md');
const defaultEntryPointPath = path.join(__dirname, '../src/index.ts');

function resolveModulePath(baseDir, spec) {
  const target = path.resolve(baseDir, spec);
  if (fs.existsSync(`${target}.ts`) && fs.statSync(`${target}.ts`).isFile()) {
    return `${target}.ts`;
  }
  if (spec.endsWith('.js')) {
    const tsTarget = target.replace(/\.js$/, '.ts');
    if (fs.existsSync(tsTarget) && fs.statSync(tsTarget).isFile()) {
      return tsTarget;
    }
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

function hasExportModifier(node) {
  return (
    Array.isArray(node.modifiers) &&
    node.modifiers.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function hasDefaultModifier(node) {
  return (
    Array.isArray(node.modifiers) &&
    node.modifiers.some((mod) => mod.kind === ts.SyntaxKind.DefaultKeyword)
  );
}

function collectBindingNames(nameNode, symbols) {
  if (!nameNode) return;
  if (ts.isIdentifier(nameNode)) {
    symbols.add(nameNode.text);
  } else if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
    for (const element of nameNode.elements) {
      if (ts.isBindingElement(element)) {
        collectBindingNames(element.name, symbols);
      }
    }
  }
}

/**
 * Recursively extracts all public symbols exported from a TypeScript entry file
 * using the TypeScript AST parser (`ts.createSourceFile`), walking:
 * - `export * from './x'` barrel re-exports
 * - `export * as ns from './x'` namespace re-exports
 * - `export { A, B as C, type D } [from './x']` named export blocks
 * - direct `export` declarations (classes, functions, interfaces, types, enums,
 *   namespaces, and single/multi/destructured variable declarations).
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
  const sourceFile = ts.createSourceFile(resolved, raw, ts.ScriptTarget.Latest, true);
  const dir = path.dirname(resolved);
  const symbols = new Set();

  for (const stmt of sourceFile.statements) {
    if (ts.isExportDeclaration(stmt)) {
      const moduleSpec =
        stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
          ? stmt.moduleSpecifier.text
          : null;

      if (!stmt.exportClause) {
        // `export * from './module'` or `export type * from './module'`
        if (moduleSpec && moduleSpec.startsWith('.')) {
          const childPath = resolveModulePath(dir, moduleSpec);
          if (childPath) {
            for (const sym of extractExportedSymbols(childPath, visited)) {
              symbols.add(sym);
            }
          }
        }
      } else if (ts.isNamespaceExport(stmt.exportClause)) {
        // `export * as ns from './module'`
        symbols.add(stmt.exportClause.name.text);
      } else if (ts.isNamedExports(stmt.exportClause)) {
        // `export { A, B as C, type D } [from './module']`
        for (const element of stmt.exportClause.elements) {
          const exportedName = element.name.text;
          if (exportedName && exportedName !== 'default') {
            symbols.add(exportedName);
          }
        }
      }
      continue;
    }

    if (!hasExportModifier(stmt) || hasDefaultModifier(stmt)) {
      continue;
    }

    if (
      (ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isInterfaceDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt) ||
        ts.isModuleDeclaration(stmt)) &&
      stmt.name &&
      ts.isIdentifier(stmt.name)
    ) {
      symbols.add(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        collectBindingNames(decl.name, symbols);
      }
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

  const missingSymbols = [];
  for (const symbol of exportedSymbols) {
    if (!symbol) continue;
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(#|\\b)${escaped}\\b`);
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
