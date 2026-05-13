import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getCurrentUserId } from '@/lib/shared/get-current-user';
import FilesPageClient from './page-client';
import { defaultLocale } from '@/i18n/config';

/**
 * Files Page (Server Component)
 *
 * Updated for user-level architecture:
 * - Gets authenticated user from Better Auth session
 * - Passes userId to client component
 * - Redirects unauthenticated users to login
 *
 * This Server Component wrapper allows us to:
 * 1. Use async/await to get current user from session
 * 2. Handle authentication at the server level
 * 3. Pass real userId to client component (no more hardcoded placeholders)
 */

// Force dynamic rendering since we use headers()
export const dynamic = 'force-dynamic';

export default async function FilesPage() {
  const userId = await getCurrentUserId();

  if (!userId) {
    const headersList = await headers();
    const pathname = headersList.get('x-pathname') || '/admin/files';
    const callbackUrl = encodeURIComponent(pathname);
    redirect(`/${defaultLocale}/login?callbackUrl=${callbackUrl}`);
  }

  return <FilesPageClient userId={userId} />;
}
