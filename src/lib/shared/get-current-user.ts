/**
 * Server-side utility to get current authenticated user
 *
 * UseCan¦çæ«
 * - Server Components (GetCurrent userInformation)
 * - Server Actions (Needä½ºæ¤é´ç¨©DExecuteîActions)
 * - API Route Handlers (å®¸æ¥â¬æ°³ç¹ withAuth æ¶î¢æ£¿æµ èµå½æ¸æ¶³ç´Toolç»æ¸¶Useå§ãä¼
 *
 * é¿çç¬ å§ãææµ æµè´ server-onlyéå±¼ç¬æ´æ¿æ¹ªç¹ã¡åç»îî±
 *
 * @example
 * // In a Server Component
 * import { getCurrentUserId } from '@/lib/shared/get-current-user';
 *
 * export default async function Page() {
 *   const userId = await getCurrentUserId();
 *   if (!userId) {
 *     redirect('/login');
 *   }
 *   // Use userId to fetch user-specific data
 * }
 *
 * @example
 * // With error handling
 * import { requireAuth } from '@/lib/shared/get-current-user';
 *
 * export default async function ProtectedPage() {
 *   const session = await requireAuth(); // Throws if not authenticated
 *   const userId = session.user.id;
 *   // Guaranteed to have authenticated user here
 * }
 */

import 'server-only';
import { auth } from '@/lib/auth/server';
import { headers } from 'next/headers';

/**
 * Get current authenticated user session
 *
 * @returns Session object with user information, or null if not authenticated
 *
 * @example
 * const session = await getCurrentUser();
 * if (session?.user) {
 *   console.log('User:', session.user.name, session.user.email);
 * }
 */
export async function getCurrentUser() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    return session;
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
}

/**
 * Get current authenticated user ID
 *
 * @returns User ID string, or null if not authenticated
 *
 * @example
 * const userId = await getCurrentUserId();
 * if (!userId) {
 *   redirect('/login');
 * }
 * const userFiles = await db.query.files.findMany({
 *   where: eq(files.userId, userId)
 * });
 */
export async function getCurrentUserId(): Promise<string | null> {
  const session = await getCurrentUser();
  return session?.user?.id ?? null;
}
