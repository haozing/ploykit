import type { PermissionValue } from '@ploykit/module-sdk';
import type { ModuleRuntimeContract } from '../contract';
import type { ModuleRuntimeAccessSession } from './session';

export function assertPermission(
  contract: ModuleRuntimeContract,
  session: ModuleRuntimeAccessSession,
  permission: PermissionValue,
  path: string
): void {
  const permissions = session.permissions ?? [];
  if (session.system || permissions.includes(permission)) return;
  if (contract.permissions.includes(permission) && permissions.includes(permission)) return;
  throw new Error(`MODULE_PERMISSION_DENIED: ${path} requires ${permission}`);
}
