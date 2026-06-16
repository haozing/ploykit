import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function listModuleHashFiles(moduleRoot, helpers) {
  const { slash } = helpers;
  const files = [];
  const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.sql', '.md']);
  const ignored = new Set(['node_modules', '.next', '.runtime', 'dist']);

  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.name !== '.ploykit') {
        continue;
      }
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) {
          visit(path.join(current, entry.name));
        }
        continue;
      }
      if (!entry.isFile() || entry.name.includes('.test.')) {
        continue;
      }
      if (extensions.has(path.extname(entry.name))) {
        files.push(path.join(current, entry.name));
      }
    }
  }

  visit(moduleRoot);
  return files.sort((left, right) =>
    slash(path.relative(moduleRoot, left)).localeCompare(slash(path.relative(moduleRoot, right)))
  );
}

export function sourceHash(moduleRoot, helpers) {
  const { slash } = helpers;
  const hash = crypto.createHash('sha256');
  for (const file of listModuleHashFiles(moduleRoot, helpers)) {
    hash.update(slash(path.relative(moduleRoot, file)));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function contractSourceDigest(moduleRoot) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(moduleRoot, 'module.ts')))
    .digest('hex');
}
