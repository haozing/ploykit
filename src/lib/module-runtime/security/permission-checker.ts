import {
  SystemOnlyPermissions,
  type ModuleCommercialRequirement,
  type ModuleNavigationItem,
  type ModuleRouteAuth,
  type PermissionValue,
} from '@ploykit/module-sdk';
import type { ModuleRuntimeContract } from '../contract';
import type { ModuleRuntimeAccessSession } from './session';

export type ModuleRuntimeGuardKind = 'api' | 'page' | 'action' | 'surface' | 'navigation';

export interface ModuleRuntimeAccessDecision {
  allow: boolean;
  status: 401 | 403;
  code: string;
  message: string;
  reason:
    | 'auth-required'
    | 'admin-required'
    | 'system-required'
    | 'module-permission-missing'
    | 'permission-denied'
    | 'entitlement-denied'
    | 'plan-denied'
    | 'credits-denied'
    | 'feature-denied'
    | 'service-connection-denied';
}

export interface CheckModuleRuntimeAccessInput {
  kind: ModuleRuntimeGuardKind;
  contract: ModuleRuntimeContract;
  session: ModuleRuntimeAccessSession;
  auth?: ModuleRouteAuth;
  permissions?: readonly PermissionValue[];
  commercial?: ModuleCommercialRequirement;
  navigation?: ModuleNavigationItem;
  features?: readonly string[];
}

function codePrefix(kind: ModuleRuntimeGuardKind): string {
  switch (kind) {
    case 'api':
      return 'MODULE_API';
    case 'page':
      return 'MODULE_PAGE';
    case 'action':
      return 'MODULE_ACTION';
    case 'surface':
      return 'MODULE_SURFACE';
    case 'navigation':
      return 'MODULE_NAVIGATION';
  }
}

function deny(
  kind: ModuleRuntimeGuardKind,
  status: ModuleRuntimeAccessDecision['status'],
  code: string,
  message: string,
  reason: ModuleRuntimeAccessDecision['reason']
): ModuleRuntimeAccessDecision {
  return {
    allow: false,
    status,
    code: `${codePrefix(kind)}_${code}`,
    message,
    reason,
  };
}

function hasUserPermission(
  session: ModuleRuntimeAccessSession,
  permission: PermissionValue
): boolean {
  if (session.system || session.user?.role === 'admin') {
    return true;
  }

  return new Set(session.permissions ?? []).has(permission);
}

function sessionPlans(session: ModuleRuntimeAccessSession): Set<string> {
  return new Set([...(session.plans ?? []), ...(session.plan ? [session.plan] : [])]);
}

function hasAll(values: readonly string[] | undefined, required: readonly string[]): boolean {
  const set = new Set(values ?? []);
  return required.every((value) => set.has(value));
}

function requiredPermissions(input: CheckModuleRuntimeAccessInput): readonly PermissionValue[] {
  return input.permissions ?? [];
}

export function checkModuleRuntimeAccess(
  input: CheckModuleRuntimeAccessInput
): ModuleRuntimeAccessDecision | null {
  const auth = input.auth ?? 'auth';
  const authenticated =
    Boolean(input.session.user) || input.session.system || input.session.authKind === 'apiKey';
  if (auth !== 'public' && !authenticated) {
    return deny(input.kind, 401, 'AUTH_REQUIRED', 'Authentication is required.', 'auth-required');
  }

  if (auth === 'admin' && !input.session.system && input.session.user?.role !== 'admin') {
    return deny(input.kind, 403, 'ADMIN_REQUIRED', 'Admin role is required.', 'admin-required');
  }

  const modulePermissions = new Set(input.contract.permissions);
  for (const permission of requiredPermissions(input)) {
    if (SystemOnlyPermissions.has(permission) && !input.session.system) {
      return deny(
        input.kind,
        403,
        'SYSTEM_PERMISSION_REQUIRED',
        `System permission "${permission}" requires host system context.`,
        'system-required'
      );
    }

    if (!modulePermissions.has(permission)) {
      return deny(
        input.kind,
        403,
        'PERMISSION_NOT_DECLARED',
        `Module "${input.contract.id}" does not declare permission "${permission}".`,
        'module-permission-missing'
      );
    }

    if (!hasUserPermission(input.session, permission)) {
      return deny(
        input.kind,
        403,
        'PERMISSION_DENIED',
        `Permission "${permission}" is required.`,
        'permission-denied'
      );
    }
  }

  const requiredEntitlements = input.commercial?.entitlements ?? [];
  if (
    requiredEntitlements.length > 0 &&
    !hasAll(input.session.entitlements, requiredEntitlements)
  ) {
    return deny(
      input.kind,
      403,
      'ENTITLEMENT_REQUIRED',
      'Required entitlement is missing.',
      'entitlement-denied'
    );
  }

  const requiredPlans = input.commercial?.plans ?? [];
  if (requiredPlans.length > 0) {
    const plans = sessionPlans(input.session);
    if (!requiredPlans.some((plan) => plans.has(plan))) {
      return deny(input.kind, 403, 'PLAN_REQUIRED', 'Required plan is missing.', 'plan-denied');
    }
  }

  const requiredCredits = input.commercial?.credits?.amount;
  if (requiredCredits !== undefined && (input.session.creditsBalance ?? 0) < requiredCredits) {
    return deny(
      input.kind,
      403,
      'CREDITS_REQUIRED',
      'Not enough credits for this operation.',
      'credits-denied'
    );
  }

  const requiredFeatures = input.features ?? [];
  if (requiredFeatures.length > 0 && !hasAll(input.session.features, requiredFeatures)) {
    return deny(
      input.kind,
      403,
      'FEATURE_REQUIRED',
      'Required feature is missing.',
      'feature-denied'
    );
  }

  const navigation = input.navigation;
  if (navigation?.requires) {
    const requiredNavigationEntitlements = navigation.requires.entitlements ?? [];
    if (
      requiredNavigationEntitlements.length > 0 &&
      !hasAll(input.session.entitlements, requiredNavigationEntitlements)
    ) {
      return deny(
        input.kind,
        403,
        'ENTITLEMENT_REQUIRED',
        'Required navigation entitlement is missing.',
        'entitlement-denied'
      );
    }

    const requiredServiceConnections = navigation.requires.serviceConnections ?? [];
    if (
      requiredServiceConnections.length > 0 &&
      !hasAll(input.session.serviceConnections, requiredServiceConnections)
    ) {
      return deny(
        input.kind,
        403,
        'SERVICE_CONNECTION_REQUIRED',
        'Required service connection is missing.',
        'service-connection-denied'
      );
    }

    const requiredRoles = navigation.requires.scopeRoles ?? [];
    if (requiredRoles.length > 0 && !requiredRoles.includes(input.session.workspaceRole!)) {
      return deny(
        input.kind,
        403,
        'SCOPE_ROLE_REQUIRED',
        'Required workspace role is missing.',
        'permission-denied'
      );
    }
  }

  return null;
}

export function canAccessModuleRuntime(input: CheckModuleRuntimeAccessInput): boolean {
  return checkModuleRuntimeAccess(input) === null;
}
