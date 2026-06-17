import { createModuleDiagnostic, type ModuleDiagnostic } from './diagnostics';
import {
  ModulePermissionValues,
  ReservedRuntimePermissions,
  SystemOnlyPermissions,
  type PermissionValue,
} from './permissions';
import type { ModuleCommercialRequirement, ModuleDefinition, ModuleRouteAuth } from './types';

const ACTION_KEY_PATTERN = /^[a-z][a-zA-Z0-9_]*$/;
const LOCAL_PATH_PATTERN = /^\.\/(?!\.)(?!.*(?:^|\/)\.\.(?:\/|$))/;
const ROUTE_AUTHS = new Set<ModuleRouteAuth>(['public', 'auth', 'admin']);
const ACTION_SIDE_EFFECTS = new Set([
  'none',
  'read',
  'write',
  'external',
  'billing',
  'destructive',
]);

function addDiagnostic(
  diagnostics: ModuleDiagnostic[],
  severity: ModuleDiagnostic['severity'],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  diagnostics.push(createModuleDiagnostic({ code, severity, message, path, fix }));
}

function addError(
  diagnostics: ModuleDiagnostic[],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  addDiagnostic(diagnostics, 'error', code, message, path, fix);
}

function addWarning(
  diagnostics: ModuleDiagnostic[],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  addDiagnostic(diagnostics, 'warning', code, message, path, fix);
}

function validateLocalModulePath(
  diagnostics: ModuleDiagnostic[],
  value: string | undefined,
  path: string,
  label: string,
  required = true
): void {
  if (!value) {
    if (required) {
      addError(diagnostics, 'MODULE_LOCAL_PATH_REQUIRED', `${label} path is required.`, path);
    }
    return;
  }

  if (!LOCAL_PATH_PATTERN.test(value)) {
    addError(
      diagnostics,
      'MODULE_LOCAL_PATH_INVALID',
      `${label} path "${value}" must be a local module path and must not escape the module root.`,
      path,
      'Use a path like "./api/run" or "./pages/HomePage".'
    );
  }
}

function validatePermissionList(
  diagnostics: ModuleDiagnostic[],
  permissions: readonly string[] | undefined,
  path: string
): void {
  for (const [index, permission] of (permissions ?? []).entries()) {
    const itemPath = `${path}.${index}`;
    const permissionValue = permission as PermissionValue;
    if (!ModulePermissionValues.has(permissionValue)) {
      addError(
        diagnostics,
        'MODULE_PERMISSION_UNKNOWN',
        `Permission "${permission}" is not part of @ploykit/module-sdk.`,
        itemPath
      );
      continue;
    }

    if (SystemOnlyPermissions.has(permissionValue)) {
      addWarning(
        diagnostics,
        'MODULE_SYSTEM_PERMISSION_CONTEXT_BOUND',
        `System permission "${permission}" can only be executed by CLI or host system context.`,
        itemPath,
        'Keep it only when the capability is used outside request runtime.'
      );
    }
    if (ReservedRuntimePermissions.has(permissionValue)) {
      addError(
        diagnostics,
        'MODULE_PERMISSION_RESERVED_RUNTIME',
        `Permission "${permission}" is reserved and has no request runtime capability.`,
        itemPath,
        'Remove it until the host exposes and guards the matching capability.'
      );
    }
  }
}

function validateDeclaredPermissionList(
  diagnostics: ModuleDiagnostic[],
  permissions: readonly string[] | undefined,
  modulePermissions: ReadonlySet<string>,
  path: string
): void {
  for (const [index, permission] of (permissions ?? []).entries()) {
    const permissionValue = permission as PermissionValue;
    if (!ModulePermissionValues.has(permissionValue)) {
      continue;
    }
    if (!modulePermissions.has(permissionValue)) {
      addError(
        diagnostics,
        'MODULE_ENTRY_PERMISSION_NOT_DECLARED',
        `Entry permission "${permission}" must also be declared in module permissions.`,
        `${path}.${index}`,
        'Add the permission to the top-level permissions array.'
      );
    }
  }
}

function validateCommercialRequirement(
  diagnostics: ModuleDiagnostic[],
  commercial: ModuleCommercialRequirement | undefined,
  path: string
): void {
  if (!commercial) {
    return;
  }

  for (const [field, values] of [
    ['entitlements', commercial.entitlements ?? []],
    ['plans', commercial.plans ?? []],
  ] as const) {
    for (const [index, value] of values.entries()) {
      if (!value.trim()) {
        addError(
          diagnostics,
          'MODULE_COMMERCIAL_REQUIREMENT_EMPTY',
          `Commercial ${field} entry must not be empty.`,
          `${path}.${field}.${index}`
        );
      }
    }
  }

  if (commercial.meter !== undefined && !commercial.meter.trim()) {
    addError(
      diagnostics,
      'MODULE_COMMERCIAL_METER_EMPTY',
      'Commercial meter must not be empty when declared.',
      `${path}.meter`
    );
  }

  if (commercial.credits && commercial.credits.amount <= 0) {
    addError(
      diagnostics,
      'MODULE_COMMERCIAL_CREDITS_INVALID',
      'Commercial credits amount must be greater than zero.',
      `${path}.credits.amount`
    );
  }
}

export function validateActions(
  diagnostics: ModuleDiagnostic[],
  definition: ModuleDefinition
): void {
  const modulePermissions = new Set(definition.permissions ?? []);
  for (const [actionName, action] of Object.entries(definition.actions ?? {})) {
    if (!ACTION_KEY_PATTERN.test(actionName)) {
      addError(
        diagnostics,
        'MODULE_ACTION_NAME_INVALID',
        `Action "${actionName}" must start with a letter and contain only letters, numbers, or underscores.`,
        `actions.${actionName}`,
        'Use a name like "createPost" or "create_post".'
      );
    }
    validateLocalModulePath(diagnostics, action.handler, `actions.${actionName}.handler`, 'Action');
    validateLocalModulePath(
      diagnostics,
      action.input,
      `actions.${actionName}.input`,
      'Action input',
      false
    );

    if (action.auth && !ROUTE_AUTHS.has(action.auth)) {
      addError(
        diagnostics,
        'MODULE_ACTION_AUTH_INVALID',
        `Action auth "${action.auth}" is not supported.`,
        `actions.${actionName}.auth`
      );
    }

    if (action.timeoutMs !== undefined && action.timeoutMs <= 0) {
      addError(
        diagnostics,
        'MODULE_ACTION_TIMEOUT_INVALID',
        'Action timeoutMs must be greater than zero.',
        `actions.${actionName}.timeoutMs`
      );
    }

    validatePermissionList(diagnostics, action.permissions, `actions.${actionName}.permissions`);
    validateDeclaredPermissionList(
      diagnostics,
      action.permissions,
      modulePermissions,
      `actions.${actionName}.permissions`
    );
    validateCommercialRequirement(
      diagnostics,
      action.commercial,
      `actions.${actionName}.commercial`
    );

    if (action.sideEffect && !ACTION_SIDE_EFFECTS.has(action.sideEffect)) {
      addError(
        diagnostics,
        'MODULE_ACTION_SIDE_EFFECT_INVALID',
        `Action sideEffect "${action.sideEffect}" is not supported.`,
        `actions.${actionName}.sideEffect`,
        `Use one of: ${Array.from(ACTION_SIDE_EFFECTS).join(', ')}.`
      );
    }

    if (
      (action.sideEffect === 'destructive' || action.sideEffect === 'billing') &&
      action.confirmation?.required !== true
    ) {
      addError(
        diagnostics,
        'MODULE_ACTION_CONFIRMATION_REQUIRED',
        `Action "${actionName}" is ${action.sideEffect} and must require explicit confirmation.`,
        `actions.${actionName}.confirmation`,
        'Add confirmation: { required: true, fallbackMessage: "..." }.'
      );
    }

    if (action.confirmation?.required && !action.confirmation.fallbackMessage?.trim()) {
      addError(
        diagnostics,
        'MODULE_ACTION_CONFIRMATION_MESSAGE_REQUIRED',
        'Confirmed actions must provide a fallback confirmation message.',
        `actions.${actionName}.confirmation.fallbackMessage`,
        'Add a concise fallbackMessage for operators and generated clients.'
      );
    }

    if (
      (action.sideEffect === 'external' || action.sideEffect === 'billing') &&
      action.idempotency?.required !== true
    ) {
      addError(
        diagnostics,
        'MODULE_ACTION_IDEMPOTENCY_REQUIRED',
        `Action "${actionName}" is ${action.sideEffect} and must require idempotency.`,
        `actions.${actionName}.idempotency`,
        'Add idempotency: { required: true, keyFrom: "request" }.'
      );
    }

    if (action.idempotency?.required && !action.idempotency.keyFrom) {
      addError(
        diagnostics,
        'MODULE_ACTION_IDEMPOTENCY_KEY_SOURCE_REQUIRED',
        'Idempotent actions must declare idempotency.keyFrom.',
        `actions.${actionName}.idempotency.keyFrom`,
        'Use "request", "user", "scope", or "input".'
      );
    }
  }
}
