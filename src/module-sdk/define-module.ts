import type { DefinedModule, ModuleDefinition } from './types';

export function defineModule<TDefinition extends object>(
  definition: TDefinition
): DefinedModule<TDefinition> {
  return Object.freeze({
    ...definition,
    $$ploykit: {
      type: 'ploykit.module',
      sdkVersion: '0.1.0',
    },
  }) as unknown as DefinedModule<TDefinition>;
}
