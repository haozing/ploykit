import type {
  DefinedAction,
  DefinedApi,
  ModuleActionHandler,
  ModuleApiDefinition,
} from '@ploykit/module-sdk';

export function readModuleDefaultExport(value: unknown): unknown {
  if (value && typeof value === 'object' && 'default' in value) {
    return (value as { default: unknown }).default;
  }
  return value;
}

export function isDefinedApi(value: unknown): value is DefinedApi {
  return Boolean(
    value &&
    typeof value === 'object' &&
    '$$ploykit' in value &&
    (value as { $$ploykit?: { type?: string } }).$$ploykit?.type === 'ploykit.api'
  );
}

export function isDefinedAction(value: unknown): value is DefinedAction {
  return Boolean(
    value &&
    typeof value === 'object' &&
    '$$ploykit' in value &&
    (value as { $$ploykit?: { type?: string } }).$$ploykit?.type === 'ploykit.action'
  );
}

export function asModuleApiDefinition(value: unknown): ModuleApiDefinition | null {
  const exported = readModuleDefaultExport(value);
  return isDefinedApi(exported) ? exported : null;
}

export function asModuleActionHandler(value: unknown): ModuleActionHandler | null {
  const exported = readModuleDefaultExport(value);
  if (isDefinedAction(exported)) {
    return exported.run as ModuleActionHandler;
  }

  if (typeof exported === 'function') {
    return exported as ModuleActionHandler;
  }

  return null;
}
