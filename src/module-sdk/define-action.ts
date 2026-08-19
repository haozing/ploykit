import type {
  DefinedAction,
  ModuleActionDefinition,
  ModuleActionHandler,
  ModuleActionRuntimeDefinition,
} from './types';

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
): DefinedAction<ModuleActionRuntimeDefinition<TContext, TInput, TResult>>;
export function action(definition: ModuleActionDefinition): ModuleActionDefinition;
export function action<TContext, TInput, TResult>(
  runOrDefinition:
    | ModuleActionHandler<TContext, TInput, TResult>
    | ModuleActionDefinition
): DefinedAction<ModuleActionRuntimeDefinition<TContext, TInput, TResult>> | ModuleActionDefinition {
  if (typeof runOrDefinition !== 'function') {
    return Object.freeze({ ...runOrDefinition });
  }
  return defineAction({ run: runOrDefinition });
}
