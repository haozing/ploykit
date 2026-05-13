/* eslint-disable no-console */
/**
 * Dependency Check
 *
 * Validates that all directly imported third-party packages
 * are declared in package.json dependencies or devDependencies.
 *
 * Usage:
 *   tsx scripts/check-dependencies.ts
 */

import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const PROJECT_ROOT = process.cwd();
const PACKAGE_JSON_PATH = path.join(PROJECT_ROOT, 'package.json');
const SRC_DIR = path.join(PROJECT_ROOT, 'src');

// Built-in and known-safe modules that don't need to be in package.json
const BUILT_IN_MODULES = new Set([
  'child_process',
  'crypto',
  'fs',
  'http',
  'https',
  'os',
  'path',
  'stream',
  'url',
  'util',
  'zlib',
  'buffer',
  'events',
  'querystring',
  'string_decoder',
  'timers',
  'assert',
  'async_hooks',
  'cluster',
  'dgram',
  'dns',
  'domain',
  'inspector',
  'module',
  'net',
  'perf_hooks',
  'process',
  'punycode',
  'readline',
  'repl',
  'tls',
  'trace_events',
  'tty',
  'v8',
  'vm',
  'worker_threads',
]);

// Known framework/runtime packages that are transitive but safe
const ALLOWED_TRANSITIVE = new Set([
  'next',
  'react',
  'react-dom',
  'typescript',
  'eslint',
  'tailwindcss',
]);

const INTERNAL_PACKAGE_ALIASES = new Set(['@ploykit/plugin-sdk']);

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function loadPackageJson(): PackageJson {
  const content = fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8');
  return JSON.parse(content);
}

function getDeclaredPackages(pkg: PackageJson): Set<string> {
  const declared = new Set<string>();
  if (pkg.dependencies) {
    Object.keys(pkg.dependencies).forEach((dep) => declared.add(dep));
  }
  if (pkg.devDependencies) {
    Object.keys(pkg.devDependencies).forEach((dep) => declared.add(dep));
  }
  return declared;
}

function findSourceFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findSourceFiles(fullPath));
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractImports(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const imports: string[] = [];
  const scriptKind =
    filePath.endsWith('.tsx') || filePath.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );

  function addImport(importPath: string): void {
    // Only check bare imports (not relative or absolute paths)
    if (importPath.startsWith('.') || importPath.startsWith('/')) {
      return;
    }

    // Extract package name (handle scoped packages like @org/pkg)
    const parts = importPath.split('/');
    const pkgName = importPath.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
    imports.push(pkgName);
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      addImport(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      addImport(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const expression = node.moduleReference.expression;
      if (expression && ts.isStringLiteralLike(expression)) {
        addImport(expression.text);
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      addImport(node.arguments[0].text);
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      addImport(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

function main() {
  const pkg = loadPackageJson();
  const declaredPackages = getDeclaredPackages(pkg);
  const sourceFiles = findSourceFiles(SRC_DIR);

  const undeclaredImports = new Map<string, string[]>();

  for (const file of sourceFiles) {
    const imports = extractImports(file);
    for (const pkgName of imports) {
      const normalizedPkgName = pkgName.startsWith('node:') ? pkgName.slice(5) : pkgName;
      if (BUILT_IN_MODULES.has(normalizedPkgName)) continue;
      if (ALLOWED_TRANSITIVE.has(pkgName)) continue;
      if (declaredPackages.has(pkgName)) continue;

      // Skip internal aliases
      if (pkgName.startsWith('@/')) continue;
      if (INTERNAL_PACKAGE_ALIASES.has(pkgName)) continue;

      const relativePath = path.relative(PROJECT_ROOT, file);
      if (!undeclaredImports.has(pkgName)) {
        undeclaredImports.set(pkgName, []);
      }
      undeclaredImports.get(pkgName)!.push(relativePath);
    }
  }

  if (undeclaredImports.size > 0) {
    console.error('❌ Dependency check failed: found undeclared imports\n');
    for (const [pkgName, files] of undeclaredImports) {
      console.error(`  Package: ${pkgName}`);
      for (const file of files.slice(0, 3)) {
        console.error(`    - ${file}`);
      }
      if (files.length > 3) {
        console.error(`    - ... and ${files.length - 3} more files`);
      }
      console.error();
    }
    console.error('Fix: add missing packages to package.json dependencies or devDependencies\n');
    process.exit(1);
  }

  console.log('✅ Dependency check passed');
}

main();
