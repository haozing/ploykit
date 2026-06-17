import { createModuleDiagnostic, type ModuleDiagnostic } from './diagnostics';
import { normalizeModuleNpmDependencies } from './dependencies';
import {
  ModulePermissionValues,
  Permission,
  ReservedRuntimePermissions,
  SystemOnlyPermissions,
  type PermissionValue,
} from './permissions';
import { validateServiceRequirement } from './validator-service-requirements';
import type { ModuleDefinition, ModuleLifecycleDefinition } from './types';

const MODULE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const LOCAL_PATH_PATTERN = /^\.\/(?!\.)(?!.*(?:^|\/)\.\.(?:\/|$))/;
const ORIGIN_PATTERN = /^https?:\/\/[^/\s]+$/;

const LIFECYCLE_HOOKS = new Set([
  'install',
  'enable',
  'disable',
  'update',
  'seed',
  'activate',
  'deactivate',
  'reset',
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

function validateKey(
  diagnostics: ModuleDiagnostic[],
  key: string,
  path: string,
  label: string
): void {
  if (!MODULE_KEY_PATTERN.test(key)) {
    addError(
      diagnostics,
      'MODULE_KEY_INVALID',
      `${label} "${key}" must use snake_case and start with a letter.`,
      path,
      'Use a key like "orders", "blog_posts", or "create_order".'
    );
  }
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

export function validateLifecycle(
  diagnostics: ModuleDiagnostic[],
  lifecycle: ModuleLifecycleDefinition | undefined
): void {
  for (const [hookName, hookPath] of Object.entries(lifecycle ?? {})) {
    if (!LIFECYCLE_HOOKS.has(hookName)) {
      addError(
        diagnostics,
        'MODULE_LIFECYCLE_HOOK_UNKNOWN',
        `Lifecycle hook "${hookName}" is not supported.`,
        `lifecycle.${hookName}`,
        `Use one of ${[...LIFECYCLE_HOOKS].join(', ')}.`
      );
    }

    validateLocalModulePath(
      diagnostics,
      hookPath,
      `lifecycle.${hookName}`,
      `Lifecycle ${hookName} hook`
    );
  }
}

export function validateDependencies(
  diagnostics: ModuleDiagnostic[],
  definition: ModuleDefinition
): void {
  const result = normalizeModuleNpmDependencies(definition.dependencies?.npm);
  for (const item of result.diagnostics) {
    addDiagnostic(diagnostics, item.severity, item.code, item.message, item.path, item.fix);
  }
}

export function validateCapabilityMetadata(
  diagnostics: ModuleDiagnostic[],
  definition: ModuleDefinition
): void {
  for (const [meterName, meter] of Object.entries(definition.meters ?? {})) {
    validateKey(diagnostics, meterName, `meters.${meterName}`, 'Meter');
    if (meter.unit !== undefined && !meter.unit.trim()) {
      addError(
        diagnostics,
        'MODULE_METER_UNIT_EMPTY',
        `Meter "${meterName}" unit must not be empty when declared.`,
        `meters.${meterName}.unit`
      );
    }
  }

  for (const [name, requirement] of Object.entries(definition.serviceRequirements ?? {})) {
    validateServiceRequirement(diagnostics, definition, name, requirement);
  }

  for (const [name, binding] of Object.entries(definition.resourceBindings ?? {})) {
    validateKey(diagnostics, name, `resourceBindings.${name}`, 'Resource binding');
    if (!binding.kind?.trim()) {
      addError(
        diagnostics,
        'MODULE_RESOURCE_BINDING_KIND_REQUIRED',
        `Resource binding "${name}" must declare a kind.`,
        `resourceBindings.${name}.kind`
      );
    }
  }

  for (const [name, config] of Object.entries(definition.config ?? {})) {
    validateKey(diagnostics, name, `config.${name}`, 'Config field');
    if (!['string', 'number', 'boolean', 'json'].includes(config.type)) {
      addError(
        diagnostics,
        'MODULE_CONFIG_TYPE_INVALID',
        `Config field "${name}" type "${config.type}" is not supported.`,
        `config.${name}.type`
      );
    }

    if (config.secret === true && config.default !== undefined) {
      addError(
        diagnostics,
        'MODULE_SECRET_DEFAULT_FORBIDDEN',
        `Secret config field "${name}" must not declare a default value.`,
        `config.${name}.default`,
        'Remove the default and provide the value through ctx.secrets or host secret configuration.'
      );
    }
  }
}

export function validateEgress(
  diagnostics: ModuleDiagnostic[],
  definition: ModuleDefinition
): void {
  const egress = definition.egress ?? [];
  const permissions = new Set(definition.permissions ?? []);

  if (egress.length > 0 && !permissions.has(Permission.ExternalHttp)) {
    addError(
      diagnostics,
      'MODULE_EGRESS_PERMISSION_REQUIRED',
      'Modules that declare egress origins must also declare Permission.ExternalHttp.',
      'permissions',
      'Add Permission.ExternalHttp or remove the unused egress declaration.'
    );
  }

  if (permissions.has(Permission.ExternalHttp) && egress.length === 0) {
    addError(
      diagnostics,
      'MODULE_HTTP_EGRESS_REQUIRED',
      'Permission.ExternalHttp requires at least one explicit egress origin.',
      'egress',
      'Declare egress: ["https://api.example.com"].'
    );
  }

  for (const [index, origin] of (definition.egress ?? []).entries()) {
    if (!ORIGIN_PATTERN.test(origin) || origin.includes('*')) {
      addError(
        diagnostics,
        'MODULE_EGRESS_ORIGIN_INVALID',
        `Egress origin "${origin}" must be an explicit http(s) origin.`,
        `egress.${index}`,
        'Use an origin like "https://api.example.com".'
      );
    }
  }
}
