import type { ModuleResourceDefinition } from './types';

export function resource(definition: Omit<ModuleResourceDefinition, '$$type'>): ModuleResourceDefinition {
  return Object.freeze({
    ...definition,
    $$type: 'ploykit.resource',
  });
}
