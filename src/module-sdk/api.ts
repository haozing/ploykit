import type { ModuleApiDefinitionContract } from './types';

export function api(
  definition: Omit<ModuleApiDefinitionContract, '$$type'>
): ModuleApiDefinitionContract {
  return Object.freeze({
    ...definition,
    $$type: 'ploykit.api-route',
  });
}
