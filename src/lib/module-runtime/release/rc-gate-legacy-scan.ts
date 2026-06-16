import fs from 'node:fs';
import path from 'node:path';

import type { LegacyRuntimeTerm, ReleaseCandidateDiagnostic } from './rc-gate-types';

export const DEFAULT_RELEASE_CANDIDATE_SCAN_TARGETS = [
  'src',
  'modules',
  'templates',
  'apps',
  'docs',
  'README.md',
  'package.json',
] as const;

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.runtime',
  'coverage',
  'dist',
  'node_modules',
]);

const LEGACY_RUNTIME_TERMS: LegacyRuntimeTerm[] = [
  {
    code: 'RC_LEGACY_DEFINE_FACTORY',
    value: `${'define'}${'Plugin'}`,
    formalName: 'legacy factory API',
  },
  {
    code: 'RC_LEGACY_ENTRY_FILE',
    value: `${'plugin'}.${'ts'}`,
    formalName: 'legacy entry file',
  },
  {
    code: 'RC_LEGACY_STORAGE_API',
    value: `${'ctx'}.${'storage'}`,
    formalName: 'legacy storage API',
  },
  {
    code: 'RC_LEGACY_SDK_IMPORT',
    value: `${'@ploykit'}/${'plugin-sdk'}`,
    formalName: 'legacy SDK import',
  },
  {
    code: 'RC_LEGACY_RUNTIME_IMPORT',
    value: `${'plugin'}-${'runtime'}`,
    formalName: 'legacy runtime import',
  },
  {
    code: 'RC_LEGACY_MODULE_ROOT',
    value: `${'plugins'}/`,
    formalName: 'legacy module root',
  },
  {
    code: 'RC_LEGACY_MODULE_ROOT',
    value: `${'plugins'}\\`,
    formalName: 'legacy module root',
  },
];

function slash(value: string): string {
  return value.replace(/\\/g, '/');
}

function isTextFile(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function collectFiles(root: string, target: string): string[] {
  const absolute = path.resolve(root, target);
  if (!fs.existsSync(absolute)) {
    return [];
  }
  const stat = fs.statSync(absolute);
  if (stat.isFile()) {
    return isTextFile(absolute) ? [absolute] : [];
  }
  if (!stat.isDirectory()) {
    return [];
  }

  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          visit(path.join(dir, entry.name));
        }
        continue;
      }
      const filePath = path.join(dir, entry.name);
      if (entry.isFile() && isTextFile(filePath)) {
        files.push(filePath);
      }
    }
  };
  visit(absolute);
  return files;
}

function isCleanupContext(relativePath: string, line: string): boolean {
  const normalized = slash(relativePath);
  if (normalized.startsWith('docs/old-ploykit-')) {
    return true;
  }
  if (
    /(do not|don't|must not|never|legacy|old|forbidden|deny|cleanup|remove|removed|no longer|not use)/i.test(
      line
    )
  ) {
    return true;
  }
  if (
    /(不恢复|不使用|不迁移|不保留|不再|不应|不能|不得|不要|没有新增|删除|旧|老|禁止|阻断|清理|门禁|拒绝|禁用)/u.test(
      line
    )
  ) {
    return true;
  }
  if (normalized.startsWith('docs/') && /(\.\.\/PloyKit|老代码|材料库)/u.test(line)) {
    return true;
  }
  return false;
}

function scanFile(root: string, filePath: string): ReleaseCandidateDiagnostic[] {
  const relativePath = slash(path.relative(root, filePath));
  const content = fs.readFileSync(filePath, 'utf8');
  const diagnostics: ReleaseCandidateDiagnostic[] = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const term of LEGACY_RUNTIME_TERMS) {
      if (!line.includes(term.value) || isCleanupContext(relativePath, line)) {
        continue;
      }
      diagnostics.push({
        severity: 'error',
        code: term.code,
        message: `Formal v2 entry mentions ${term.formalName}.`,
        path: relativePath,
        line: index + 1,
        term: term.formalName,
        snippet: line.trim(),
        fix: 'Replace the formal entry with defineModule, ctx.data, modules/, and the v2 module runtime contract.',
      });
    }
  });

  return diagnostics;
}

export function collectReleaseCandidateScan(
  projectRoot: string,
  targets: readonly string[]
): { files: string[]; diagnostics: ReleaseCandidateDiagnostic[] } {
  const files = [...new Set(targets.flatMap((target) => collectFiles(projectRoot, target)))].sort();
  return {
    files,
    diagnostics: files.flatMap((file) => scanFile(projectRoot, file)),
  };
}
