import type { ModulePageDefinition } from './types';

export function page(definition: Omit<ModulePageDefinition, '$$type'>): ModulePageDefinition {
  return Object.freeze({
    ...definition,
    $$type: 'ploykit.page',
  });
}
