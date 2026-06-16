import {
  Permission,
  SystemOnlyPermissions,
  type CommercialSubject,
  type PermissionValue,
} from '@ploykit/module-sdk';
import type { ModuleRuntimeContract } from '../contract';
import type { ModuleRuntimeAccessSession } from './session';

export function deny(code: string, message: string): never {
  throw new Error(`${code}: ${message}`);
}

export function hasSessionPermission(
  session: ModuleRuntimeAccessSession,
  permission: PermissionValue
): boolean {
  if (session.system || session.user?.role === 'admin') {
    return true;
  }
  if (!Array.isArray(session.permissions)) {
    return false;
  }
  return session.permissions.includes(permission);
}

export function assertPermission(
  contract: ModuleRuntimeContract,
  session: ModuleRuntimeAccessSession,
  permission: PermissionValue,
  capabilityPath: string
): void {
  if (SystemOnlyPermissions.has(permission) && !session.system) {
    deny(
      'MODULE_CAPABILITY_SYSTEM_PERMISSION_REQUIRED',
      `${capabilityPath} requires system-only permission "${permission}".`
    );
  }

  if (!contract.permissions.includes(permission)) {
    deny(
      'MODULE_CAPABILITY_PERMISSION_NOT_DECLARED',
      `${capabilityPath} requires module permission "${permission}".`
    );
  }

  if (!hasSessionPermission(session, permission)) {
    deny(
      'MODULE_CAPABILITY_PERMISSION_DENIED',
      `${capabilityPath} requires session permission "${permission}".`
    );
  }
}

export function assertConfigDeclared(
  contract: ModuleRuntimeContract,
  key: string,
  secret: boolean
): void {
  const field = contract.definition.config?.[key];
  if (!field || (secret && field.secret !== true)) {
    deny(
      secret ? 'MODULE_CAPABILITY_SECRET_NOT_DECLARED' : 'MODULE_CAPABILITY_CONFIG_NOT_DECLARED',
      secret
        ? `Secret "${key}" is not declared as a secret config field.`
        : `Config field "${key}" is not declared.`
    );
  }
}

export function assertServiceDeclared(contract: ModuleRuntimeContract, name: string): void {
  if (!contract.definition.serviceRequirements?.[name]) {
    deny(
      'MODULE_CAPABILITY_SERVICE_NOT_DECLARED',
      `Service "${name}" is not declared in serviceRequirements.`
    );
  }
}

export function assertResourceBindingDeclared(contract: ModuleRuntimeContract, name: string): void {
  if (!contract.definition.resourceBindings?.[name]) {
    deny(
      'MODULE_CAPABILITY_RESOURCE_BINDING_NOT_DECLARED',
      `Resource binding "${name}" is not declared.`
    );
  }
}

export function assertResourceBindingWritePermission(
  contract: ModuleRuntimeContract,
  session: ModuleRuntimeAccessSession,
  capabilityPath: string
): void {
  if (!contract.permissions.includes(Permission.ResourceBindingsWrite)) {
    deny(
      'MODULE_CAPABILITY_PERMISSION_NOT_DECLARED',
      `${capabilityPath} requires module permission "${Permission.ResourceBindingsWrite}".`
    );
  }
  if (
    session.system ||
    session.user?.role === 'admin' ||
    session.workspaceRole === 'owner' ||
    session.workspaceRole === 'admin' ||
    hasSessionPermission(session, Permission.ResourceBindingsWrite)
  ) {
    return;
  }
  deny(
    'MODULE_CAPABILITY_PERMISSION_DENIED',
    `${capabilityPath} requires workspace owner/admin or permission "${Permission.ResourceBindingsWrite}".`
  );
}

export function assertOwnUser(
  session: ModuleRuntimeAccessSession,
  userId: string,
  capabilityPath: string
) {
  assertSubjectAccess(session, { type: 'user', id: userId }, capabilityPath);
}

export function sameCommercialSubject(left: CommercialSubject, right: CommercialSubject): boolean {
  return left.type === right.type && left.id === right.id;
}

export function canAccessSubject(
  session: ModuleRuntimeAccessSession,
  subject: CommercialSubject
): boolean {
  if (session.system || session.user?.role === 'admin') {
    return true;
  }

  if (session.subject && sameCommercialSubject(session.subject, subject)) {
    return true;
  }

  if (subject.type === 'user') {
    const actorId = session.userId ?? session.user?.id;
    return Boolean(actorId && actorId === subject.id);
  }

  if (subject.type === 'workspace') {
    return Boolean(session.workspaceId && session.workspaceId === subject.id);
  }

  if (subject.type === 'organization') {
    return Boolean(session.organizationId && session.organizationId === subject.id);
  }

  if (subject.type === 'apiKey') {
    return Boolean(session.apiKeyId && session.apiKeyId === subject.id);
  }

  return false;
}

export function assertSubjectAccess(
  session: ModuleRuntimeAccessSession,
  subject: CommercialSubject,
  capabilityPath: string
) {
  if (canAccessSubject(session, subject)) {
    return;
  }

  deny(
    'MODULE_CAPABILITY_SUBJECT_SCOPE_DENIED',
    `${capabilityPath} cannot target commercial subject "${subject.type}:${subject.id}".`
  );
}

export function userCommercialSubject(userId: string): CommercialSubject {
  return { type: 'user', id: userId };
}

export function subjectFromInput(
  input: { subject?: CommercialSubject; userId?: string },
  capabilityPath: string
): CommercialSubject {
  if (input.subject) {
    return input.subject;
  }
  if (input.userId) {
    return userCommercialSubject(input.userId);
  }

  deny('MODULE_CAPABILITY_SUBJECT_REQUIRED', `${capabilityPath} requires a subject or userId.`);
}

export function assertOptionalSubjectAccess(
  session: ModuleRuntimeAccessSession,
  subject: CommercialSubject | undefined,
  capabilityPath: string
) {
  if (subject) {
    assertSubjectAccess(session, subject, capabilityPath);
  }
}

export function assertPrivilegedCommercialMaintenance(
  session: ModuleRuntimeAccessSession,
  capabilityPath: string
) {
  if (session.system || session.user?.role === 'admin') {
    return;
  }
  deny(
    'MODULE_CAPABILITY_BULK_COMMERCIAL_WRITE_DENIED',
    `${capabilityPath} requires an admin or system session because it can mutate multiple commercial subjects.`
  );
}

export function filterAccessibleSubjects<TItem>(
  session: ModuleRuntimeAccessSession,
  items: readonly TItem[],
  resolveSubject: (item: TItem) => CommercialSubject | undefined
): TItem[] {
  if (session.system || session.user?.role === 'admin') {
    return [...items];
  }

  return items.filter((item) => {
    const subject = resolveSubject(item);
    return Boolean(subject && canAccessSubject(session, subject));
  });
}
