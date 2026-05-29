import type { DefinedAction, ModuleActionHandler, ModuleActionRuntimeDefinition } from './types';

export function defineAction<TDefinition extends ModuleActionRuntimeDefinition<any, any, any>>(
  definition: TDefinition
): DefinedAction<TDefinition> {
  return Object.freeze({
    ...definition,
    $$ploykit: {
      type: 'ploykit.action',
      sdkVersion: '0.1.0',
    },
  }) as DefinedAction<TDefinition>;
}

export function action<TContext, TInput, TResult>(
  run: ModuleActionHandler<TContext, TInput, TResult>
): DefinedAction<ModuleActionRuntimeDefinition<TContext, TInput, TResult>> {
  return defineAction({ run });
}
