import { roleSatisfies, useAuth, useWorkspace, type Perm } from '@ploykit/hooks'

// Re-exported so every UI-side permission gate (AppShell sidebar + user-panel
// menus) imports its predicates from one module. The definition itself stays
// in @ploykit/hooks — there is exactly one role matrix.
export { roleSatisfies }
export type { Perm }

/** Fields shared by sidebar `NavItem`s and `UserMenuExtraItem` entries. */
export interface PermissionGatedItem {
  perm?: Perm
  permKey?: string
}

/**
 * Provider-safe workspace role / effective permission set.
 *
 * AppShell deliberately does not require `PloykitProvider` (progressive
 * adoption / plain-shell renders), so `useWorkspaceCtx()` may throw
 * synchronously. In that case both values degrade to `undefined`: role-gated
 * items hide (`roleSatisfies(undefined, perm)` is false) and `permKey`-gated
 * items stay visible (unknown permission set = backward compatible).
 */
export function useWorkspaceRoleSafe(): { role: string | undefined; rolePerms: string[] | undefined } {
  try {
    const current = useWorkspace().current
    return { role: current?.role, rolePerms: current?.role_perms ?? undefined }
  } catch {
    return { role: undefined, rolePerms: undefined }
  }
}

/**
 * Provider-safe platform-admin flag: `false` when no AuthContext is mounted
 * instead of throwing. Platform admins bypass role-level (`perm`) gating —
 * the server remains the real boundary; fine-grained `permKey`s are still
 * checked against their effective permission set.
 */
export function useIsPlatformAdminSafe(): boolean {
  try {
    return useAuth().user?.is_platform_admin === true
  } catch {
    return false
  }
}

/**
 * Fine-grained permission-key containment check.
 *
 * Unknown permission set (`rolePerms === undefined` — legacy payload without
 * `role_perms`, or no Provider) means "visible": backward compatible, same
 * rule as AppShell's nav filter. Owner is not special-cased — the backend
 * hands owners the full catalog in `role_perms`, so inclusion is natural.
 */
export function permKeyVisible(rolePerms: string[] | undefined, permKey?: string): boolean {
  if (permKey === undefined) return true
  if (rolePerms === undefined) return true
  return rolePerms.includes(permKey)
}

/**
 * Single visibility rule shared by the sidebar nav and the user-panel menus:
 * - no `perm` / `permKey` → always visible
 * - `perm` → minimum workspace role (platform admins bypass this level,
 *   matching AppShell)
 * - `permKey` → must be contained in a *known* `rolePerms` set
 * - both declared → both must pass
 */
export function permissionVisible(
  item: PermissionGatedItem,
  role: string | undefined,
  rolePerms: string[] | undefined,
  isPlatformAdmin = false,
): boolean {
  if (item.perm !== undefined && !isPlatformAdmin && !roleSatisfies(role, item.perm)) return false
  return permKeyVisible(rolePerms, item.permKey)
}
