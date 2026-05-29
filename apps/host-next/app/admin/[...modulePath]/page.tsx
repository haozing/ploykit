import { redirect } from 'next/navigation';
import { DEFAULT_LANGUAGE, localizedAdminPath } from '@host/lib/i18n';
import { modulePathFromSegments } from '@host/lib/paths';

export const dynamic = 'force-dynamic';

export default async function AdminModuleRedirectPage({
  params,
}: {
  params: Promise<{ modulePath?: string[] }>;
}) {
  const { modulePath } = await params;
  redirect(localizedAdminPath(DEFAULT_LANGUAGE, modulePathFromSegments(modulePath)));
}
