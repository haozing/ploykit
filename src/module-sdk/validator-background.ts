import { createModuleDiagnostic, type ModuleDiagnostic } from './diagnostics';
import {
  ModulePermissionValues,
  Permission,
  ReservedRuntimePermissions,
  SystemOnlyPermissions,
  type PermissionValue,
} from './permissions';
import type {
  ModuleCommercialRequirement,
  ModuleDefinition,
  ModuleHttpMethod,
  ModuleRouteAuth,
} from './types';

const MODULE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_.:-]*$/;
const LOCAL_PATH_PATTERN = /^\.\/(?!\.)(?!.*(?:^|\/)\.\.(?:\/|$))/;

const ROUTE_AUTHS = new Set<ModuleRouteAuth>(['public', 'auth', 'admin']);
const HTTP_METHODS = new Set<ModuleHttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const WEBHOOK_SIGNATURES = new Set(['none', 'hmac-sha256', 'stripe', 'github']);

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

function validateRouteBase(
  diagnostics: ModuleDiagnostic[],
  route: {
    path: string;
    auth?: ModuleRouteAuth;
    permissions?: readonly string[];
    commercial?: ModuleCommercialRequirement;
  },
  path: string
): void {
  if (!route.path?.startsWith('/')) {
    addError(
      diagnostics,
      'MODULE_ROUTE_PATH_INVALID',
      `Route path "${route.path}" must start with "/".`,
      `${path}.path`,
      'Declare module-local paths such as "/orders".'
    );
  }

  if (route.auth && !ROUTE_AUTHS.has(route.auth)) {
    addError(
      diagnostics,
      'MODULE_ROUTE_AUTH_INVALID',
      `Route auth "${route.auth}" is not supported.`,
      `${path}.auth`
    );
  }

  validatePermissionList(diagnostics, route.permissions, `${path}.permissions`);
  validateCommercialRequirement(diagnostics, route.commercial, `${path}.commercial`);
}

export function validateJobsEventsWebhooks(
  diagnostics: ModuleDiagnostic[],
  definition: ModuleDefinition
): void {
  const modulePermissions = new Set(definition.permissions ?? []);

  for (const [jobName, job] of Object.entries(definition.jobs ?? {})) {
    validateKey(diagnostics, jobName, `jobs.${jobName}`, 'Job');
    validateLocalModulePath(diagnostics, job.handler, `jobs.${jobName}.handler`, 'Job handler');
    if (job.timeoutMs !== undefined && job.timeoutMs <= 0) {
      addError(
        diagnostics,
        'MODULE_JOB_TIMEOUT_INVALID',
        'Job timeoutMs must be greater than zero.',
        `jobs.${jobName}.timeoutMs`
      );
    }
    if (job.retries !== undefined && (!Number.isInteger(job.retries) || job.retries < 0)) {
      addError(
        diagnostics,
        'MODULE_JOB_RETRIES_INVALID',
        'Job retries must be a non-negative integer.',
        `jobs.${jobName}.retries`
      );
    }
  }

  const publishedEvents = definition.events?.publishes ?? [];
  const subscribedEvents = Object.entries(definition.events?.subscribes ?? {});
  const webhookEntries = Object.entries(definition.webhooks ?? {});

  if (publishedEvents.length > 0 && !modulePermissions.has(Permission.EventsEmit)) {
    addError(
      diagnostics,
      'MODULE_EVENTS_EMIT_PERMISSION_REQUIRED',
      'Event publish declarations require Permission.EventsEmit.',
      'permissions',
      'Add Permission.EventsEmit or remove events.publishes.'
    );
  }

  if (subscribedEvents.length > 0 && !modulePermissions.has(Permission.EventsSubscribe)) {
    addError(
      diagnostics,
      'MODULE_EVENTS_SUBSCRIBE_PERMISSION_REQUIRED',
      'Event subscription declarations require Permission.EventsSubscribe.',
      'permissions',
      'Add Permission.EventsSubscribe or remove events.subscribes.'
    );
  }

  if (webhookEntries.length > 0 && !modulePermissions.has(Permission.WebhookReceive)) {
    addError(
      diagnostics,
      'MODULE_WEBHOOK_RECEIVE_PERMISSION_REQUIRED',
      'Webhook declarations require Permission.WebhookReceive.',
      'permissions',
      'Add Permission.WebhookReceive or remove webhooks.'
    );
  }

  for (const [index, eventName] of publishedEvents.entries()) {
    if (!EVENT_NAME_PATTERN.test(eventName)) {
      addError(
        diagnostics,
        'MODULE_EVENT_NAME_INVALID',
        `Published event "${eventName}" must start with a lowercase letter and contain only lowercase letters, numbers, "_", ".", ":", or "-".`,
        `events.publishes.${index}`
      );
    }
  }

  for (const [eventName, handler] of subscribedEvents) {
    if (!EVENT_NAME_PATTERN.test(eventName)) {
      addError(
        diagnostics,
        'MODULE_EVENT_NAME_INVALID',
        `Subscribed event "${eventName}" must start with a lowercase letter and contain only lowercase letters, numbers, "_", ".", ":", or "-".`,
        `events.subscribes.${eventName}`
      );
    }
    validateLocalModulePath(
      diagnostics,
      handler,
      `events.subscribes.${eventName}`,
      'Event subscription handler'
    );
  }

  for (const [webhookName, webhook] of webhookEntries) {
    validateKey(diagnostics, webhookName, `webhooks.${webhookName}`, 'Webhook');
    validateRouteBase(diagnostics, webhook, `webhooks.${webhookName}`);
    validateLocalModulePath(
      diagnostics,
      webhook.handler,
      `webhooks.${webhookName}.handler`,
      'Webhook handler'
    );

    if (webhook.signature && !WEBHOOK_SIGNATURES.has(webhook.signature)) {
      addError(
        diagnostics,
        'MODULE_WEBHOOK_SIGNATURE_INVALID',
        `Webhook signature "${webhook.signature}" is not supported.`,
        `webhooks.${webhookName}.signature`,
        'Use "none", "hmac-sha256", "stripe", or "github".'
      );
    }

    for (const [index, method] of (webhook.methods ?? ['POST']).entries()) {
      if (!HTTP_METHODS.has(method)) {
        addError(
          diagnostics,
          'MODULE_WEBHOOK_METHOD_INVALID',
          `Webhook method "${method}" is not supported.`,
          `webhooks.${webhookName}.methods.${index}`
        );
      }
    }
  }
}
