import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const NODE_BUILTINS = new Set(
  builtinModules.map((specifier) => specifier.replace(/^node:/, '').split('/')[0])
);

function slash(value) {
  return value.replace(/\\/g, '/');
}

function toProjectPath(projectRoot, file) {
  return slash(path.relative(projectRoot, file));
}

function extractImportSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?[^'";]+from\s*['"`]([^'"`]+)['"`]/g,
    /\bexport\s+[^'";]+from\s*['"`]([^'"`]+)['"`]/g,
    /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    /\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function isPathInsideDirectory(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function listModuleSourceFiles(moduleRoot) {
  const files = [];

  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (
        entry.name === '.ploykit' ||
        entry.name === 'migrations' ||
        entry.name === 'node_modules' ||
        entry.name === 'scripts' ||
        entry.name === 'tests'
      ) {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }

  visit(moduleRoot);
  return files;
}

export function readModuleSourceCode(moduleRoot) {
  return listModuleSourceFiles(moduleRoot)
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
}

export function checkModuleSourceSafety({
  projectRoot,
  moduleRoot,
  diagnostics,
  diagnostic,
}) {
  for (const file of listModuleSourceFiles(moduleRoot)) {
    const source = fs.readFileSync(file, 'utf8');
    const projectPath = toProjectPath(projectRoot, file);

    for (const specifier of extractImportSpecifiers(source)) {
      const normalizedSpecifier = specifier.replace(/\\/g, '/');
      const builtin = normalizedSpecifier.replace(/^node:/, '').split('/')[0];
      if (
        normalizedSpecifier.includes('src/lib') ||
        normalizedSpecifier.includes('apps/host-next') ||
        normalizedSpecifier.startsWith('@host/') ||
        normalizedSpecifier.startsWith('@/lib/module-runtime')
      ) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_HOST_IMPORT_FORBIDDEN',
            'Module code must not import host internals.',
            projectPath,
            'Use @ploykit/module-sdk and ctx capabilities instead.'
          )
        );
      }

      if (normalizedSpecifier.startsWith('.')) {
        const resolved = path.resolve(path.dirname(file), normalizedSpecifier);
        if (!isPathInsideDirectory(moduleRoot, resolved)) {
          diagnostics.push(
            diagnostic(
              'error',
              'MODULE_SOURCE_IMPORT_ESCAPES_ROOT',
              `Module source import "${specifier}" must not escape the module root.`,
              projectPath,
              'Move shared code inside the module root or expose it through @ploykit/module-sdk.'
            )
          );
        }
      }

      if (NODE_BUILTINS.has(builtin)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_NODE_BUILTIN_FORBIDDEN',
            `Module code must not import Node builtin "${specifier}".`,
            projectPath,
            'Move privileged IO into a host service or connector capability.'
          )
        );
      }
    }

    if (/\bprocess\.env\b/.test(source)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_PROCESS_ENV_FORBIDDEN',
          'Module code must not read process.env directly.',
          projectPath,
          'Use ctx.config or ctx.secrets.'
        )
      );
    }

    if (/\bctx\s*\[/.test(source)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DYNAMIC_CTX_ACCESS_FORBIDDEN',
          'Module code must not access ctx with dynamic property names.',
          projectPath,
          'Use explicit ctx capabilities so doctor can map permissions.'
        )
      );
    }

    if (/\beval\s*\(|\bnew\s+Function\s*\(|(?<!function\s+)\bFunction\s*\(/.test(source)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DYNAMIC_CODE_FORBIDDEN',
          'Module code must not use eval or Function constructors.',
          projectPath,
          'Use normal module code and declared handlers.'
        )
      );
    }

    if (/\bimport\s*\(\s*(?!['"`])/.test(source)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DYNAMIC_IMPORT_FORBIDDEN',
          'Module code must not use dynamic import specifiers.',
          projectPath,
          'Use static imports so doctor can validate source boundaries.'
        )
      );
    }

    if (/\brequire\s*\(\s*(?!['"`])/.test(source)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DYNAMIC_REQUIRE_FORBIDDEN',
          'Module code must not use dynamic require specifiers.',
          projectPath,
          'Use static imports so doctor can validate source boundaries.'
        )
      );
    }

    if (/(?<![\w.])fetch\s*\(/.test(source)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_RAW_FETCH_FORBIDDEN',
          'Module code must not call global fetch directly.',
          projectPath,
          'Use ctx.http.fetch and declare Permission.ExternalHttp with a narrow egress origin.'
        )
      );
    }
  }
}
