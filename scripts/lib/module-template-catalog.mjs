import fs from 'node:fs';
import path from 'node:path';

export const MODULE_TEMPLATES = new Set([
  'app',
  'connector',
  'resource',
  'tool',
]);

export const MODULE_EXTENSIONS = new Set();
export const TEMPLATES_WITH_DATA_ARTIFACTS = new Set(['resource']);

export function formatChoiceList(values) {
  return [...values].sort().join('|');
}

export function createUsage() {
  return `Usage: npm run module:create -- <module-id> [--template ${formatChoiceList(MODULE_TEMPLATES)}]`;
}

export function listModuleTemplateCatalog(projectRoot, helpers) {
  const { slash, toProjectPath } = helpers;
  const templateRoot = path.join(projectRoot, 'templates', 'modules');

  const listFiles = (dir) =>
    fs.existsSync(dir)
      ? fs
          .readdirSync(dir, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => {
            const absolute = path.join(entry.parentPath ?? dir, entry.name);
            return slash(path.relative(dir, absolute));
          })
          .sort()
      : [];

  const templates = [...MODULE_TEMPLATES].sort().map((name) => {
    const dir = path.join(templateRoot, name);
    return {
      name,
      path: toProjectPath(dir),
      files: listFiles(dir),
    };
  });
  return { templates, extensions: [] };
}
