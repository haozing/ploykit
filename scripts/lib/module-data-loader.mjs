import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function moduleDefinitionUrl(moduleRoot) {
  return pathToFileURL(path.join(moduleRoot, 'module.ts')).href;
}

export function readDefaultExport(value) {
  let current = value;
  for (let index = 0; index < 5; index += 1) {
    if (!current || typeof current !== 'object' || !('default' in current)) {
      return current;
    }
    current = current.default;
  }
  return current;
}

export function createModuleDataLoader(input) {
  const { diagnostic, importModule, parentUrl, toProjectPath } = input;

  async function readModuleDefinition(moduleRoot) {
    const loaded = await importModule(moduleDefinitionUrl(moduleRoot), parentUrl);
    const definition = readDefaultExport(loaded);
    if (!definition || typeof definition !== 'object') {
      throw new Error(`Module ${toProjectPath(moduleRoot)} did not export a module definition.`);
    }
    return definition;
  }

  async function loadModuleDefinition(moduleRoot) {
    try {
      return {
        ok: true,
        definition: await readModuleDefinition(moduleRoot),
      };
    } catch (error) {
      return {
        ok: false,
        result: {
          moduleRoot: toProjectPath(moduleRoot),
          moduleId: path.basename(moduleRoot),
          hasData: false,
          diagnostics: [
            diagnostic(
              'error',
              'MODULE_DATA_CONTRACT_LOAD_FAILED',
              error instanceof Error ? error.message : String(error),
              toProjectPath(path.join(moduleRoot, 'module.ts')),
              'Ensure module.ts exports defineModule(...) and compiles.'
            ),
          ],
          plan: null,
        },
      };
    }
  }

  return {
    loadModuleDefinition,
    readModuleDefinition,
  };
}
