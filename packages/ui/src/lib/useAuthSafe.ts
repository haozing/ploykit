import { useAuth, type PKUser } from '@ploykit/hooks'

/**
 * Provider-safe subset of `useAuth()`.
 *
 * AppShell deliberately does not require `PloykitProvider` (progressive
 * adoption / plain-shell renders). Every component the shell always renders
 * must therefore degrade instead of throwing when no AuthContext is mounted:
 * `useAuthCtx()` throws synchronously without a provider, so this helper
 * wraps it in the same try/catch pattern as AppShell's
 * `useWorkspaceRoleSafe` / `useIsPlatformAdminSafe`.
 *
 * @returns `{ user, logout }` when an AuthContext is present (a provider with
 *   a logged-out user still returns `user: null`), or `null` when there is no
 *   provider — callers render nothing in that case.
 */
export interface SafeAuth {
  user: PKUser | null
  logout: () => Promise<void>
}

export function useAuthSafe(): SafeAuth | null {
  try {
    const { user, logout } = useAuth()
    return { user, logout }
  } catch {
    return null
  }
}
