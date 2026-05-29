import { Permission, type PermissionValue } from '@ploykit/module-sdk';
import type { ModuleHostSession } from '@/lib/module-runtime';

export type HostCapability =
  | 'admin.access'
  | 'admin.users.manage'
  | 'admin.rbac.read'
  | 'admin.operations.read'
  | 'admin.operations.write'
  | 'admin.devConsole.read'
  | 'admin.serviceConnections.read'
  | 'admin.serviceConnections.write'
  | 'admin.settings.read'
  | 'admin.settings.write'
  | 'admin.webhooks.read'
  | 'admin.webhooks.write'
  | 'billing.read'
  | 'billing.write'
  | 'files.read'
  | 'notifications.read'
  | 'profile.write'
  | 'workspace.manage';

export interface HostRoleDefinition {
  id: 'admin' | 'user';
  label: string;
  builtIn: boolean;
  capabilities: readonly HostCapability[];
  modulePermissions: readonly PermissionValue[];
}

export const USER_MODULE_PERMISSIONS = [
  Permission.DataDocumentRead,
  Permission.DataTableRead,
  Permission.FilesRead,
  Permission.RunsRead,
  Permission.CreditsRead,
  Permission.BillingRead,
  Permission.NotificationsRead,
  Permission.NotificationsSend,
] as const satisfies readonly PermissionValue[];

export const HOST_CAPABILITIES: readonly { id: HostCapability; label: string }[] = [
  { id: 'admin.access', label: 'Access Admin Console' },
  { id: 'admin.users.manage', label: 'Manage Users' },
  { id: 'admin.rbac.read', label: 'Read RBAC' },
  { id: 'admin.operations.read', label: 'Read Operations' },
  { id: 'admin.operations.write', label: 'Write Operations' },
  { id: 'admin.devConsole.read', label: 'Read Module Dev Console' },
  { id: 'admin.serviceConnections.read', label: 'Read Service Connections' },
  { id: 'admin.serviceConnections.write', label: 'Write Service Connections' },
  { id: 'admin.settings.read', label: 'Read Settings' },
  { id: 'admin.settings.write', label: 'Write Settings' },
  { id: 'admin.webhooks.read', label: 'Read Webhooks' },
  { id: 'admin.webhooks.write', label: 'Write Webhooks' },
  { id: 'billing.read', label: 'Read Billing' },
  { id: 'billing.write', label: 'Write Billing' },
  { id: 'files.read', label: 'Read Files' },
  { id: 'notifications.read', label: 'Read Notifications' },
  { id: 'profile.write', label: 'Update Profile' },
  { id: 'workspace.manage', label: 'Manage Workspace' },
] as const;

export const HOST_ROLES: readonly HostRoleDefinition[] = [
  {
    id: 'admin',
    label: 'Admin',
    builtIn: true,
    capabilities: HOST_CAPABILITIES.map((capability) => capability.id),
    modulePermissions: [],
  },
  {
    id: 'user',
    label: 'User',
    builtIn: true,
    capabilities: ['billing.read', 'files.read', 'notifications.read', 'profile.write'],
    modulePermissions: USER_MODULE_PERMISSIONS,
  },
] as const;

export function getHostCapabilitiesForSession(session: ModuleHostSession): readonly HostCapability[] {
  if (session.system || session.user?.role === 'admin') {
    return HOST_CAPABILITIES.map((capability) => capability.id);
  }
  const role = HOST_ROLES.find((item) => item.id === session.user?.role);
  const capabilities = new Set<HostCapability>(role?.capabilities ?? []);
  if (session.workspaceRole === 'owner' || session.workspaceRole === 'admin') {
    capabilities.add('workspace.manage');
  }
  return [...capabilities];
}

export function hasHostCapability(
  session: ModuleHostSession,
  capability: HostCapability
): boolean {
  return getHostCapabilitiesForSession(session).includes(capability);
}

export function requireCapability(
  session: ModuleHostSession,
  capability: HostCapability
): void {
  if (!hasHostCapability(session, capability)) {
    throw new Error(`HOST_CAPABILITY_REQUIRED:${capability}`);
  }
}
