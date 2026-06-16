import path from 'node:path';

export function resolveModuleLocalPath(moduleRoot, localPath) {
  if (!localPath.startsWith('./')) {
    throw new Error(`Module data path must be a local "./" path: ${localPath}`);
  }

  const moduleRootPath = path.resolve(moduleRoot);
  const relative = localPath.replace(/^\.\//, '');
  const resolved = path.resolve(moduleRootPath, relative);
  const inside = path.relative(moduleRootPath, resolved);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new Error(`Module data path escapes module root: ${localPath}`);
  }
  return resolved;
}
