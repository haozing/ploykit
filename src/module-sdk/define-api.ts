import type { DefinedApi, ModuleApiDefinition } from './types';

export function defineApi<TDefinition extends ModuleApiDefinition>(
  definition: TDefinition
): DefinedApi<TDefinition> {
  return Object.freeze({
    ...definition,
    $$ploykit: {
      type: 'ploykit.api',
      sdkVersion: '0.1.0',
    },
  }) as DefinedApi<TDefinition>;
}
