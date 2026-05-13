/**
 * Role Check Utilities
 *
 * Server-side permission checking utilities for admin pages
 *
 * Usage:
 * - requireAdmin(): Ensures user is admin, redirects otherwise
 * - requireAuth(): Ensures user is authenticated, redirects otherwise
 */

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/server';
import { isAdmin, getUserRole } from '@/lib/auth/permissions';
import { defaultLocale } from '@/i18n/config';

function getCurrentPath(headersList: Headers, fallback: string): string {
  return headersList.get('x-pathname') || fallback;
}

function createLoginRedirect(headersList: Headers, fallback: string): string {
  const callbackUrl = encodeURIComponent(getCurrentPath(headersList, fallback));
  return `/${defaultLocale}/login?callbackUrl=${callbackUrl}`;
}

/**
 * Require authenticated user
 *
 * Redirects to login if not authenticated
 *
 * @returns User object
 */
export async function requireAuth() {
  const headersList = await headers();
  const session = await auth.api.getSession({
    headers: headersList,
  });

  if (!session?.user) {
    redirect(createLoginRedirect(headersList, `/${defaultLocale}/profile`));
  }

  return session.user;
}

/**
 * Require admin user
 *
 * Redirects to login if not authenticated
 * Redirects to profile if not admin
 *
 * @returns User object (guaranteed to be admin)
 */
export async function requireAdmin() {
  const headersList = await headers();
  const session = await auth.api.getSession({
    headers: headersList,
  });

  // Not authenticated -> redirect to login
  if (!session?.user) {
    redirect(createLoginRedirect(headersList, `/${defaultLocale}/admin`));
  }

  // Check if user is admin
  const isUserAdmin = await isAdmin(session.user.id);

  // Not admin -> redirect to profile
  if (!isUserAdmin) {
    redirect(`/${defaultLocale}/profile`);
  }

  return session.user;
}

/**
 * Get current user's role (without redirect)
 *
 * @returns Role slug ('admin' | 'user' | null)
 */
export async function getCurrentUserRole() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return null;
  }

  return await getUserRole(session.user.id);
}

/**
 * Check if current user is admin (without redirect)
 *
 * @returns True if admin, false otherwise
 */
export async function checkIsAdmin() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return false;
  }

  return await isAdmin(session.user.id);
}
