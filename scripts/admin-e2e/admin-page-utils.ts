import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const ADMIN_APP_ROOT = path.join('src', 'app', '[lang]', 'admin');

export function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

export function listAdminPageSourcePaths(root = process.cwd()): string[] {
  const absoluteRoot = path.join(root, ADMIN_APP_ROOT);
  const results: string[] = [];

  function walk(currentPath: string): void {
    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name === 'page.tsx') {
        results.push(toPosixPath(path.relative(root, fullPath)));
      }
    }
  }

  if (!statSync(absoluteRoot).isDirectory()) {
    throw new Error(`Admin app root not found: ${absoluteRoot}`);
  }

  walk(absoluteRoot);
  return results.sort();
}

export function sourcePathToRoutePattern(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, '/');
  const prefix = 'src/app/[lang]';
  const suffix = '/page.tsx';

  if (!normalized.startsWith(prefix) || !normalized.endsWith(suffix)) {
    throw new Error(`Not an admin app page source path: ${sourcePath}`);
  }

  const route = normalized.slice(prefix.length, -suffix.length);
  return route || '/';
}
