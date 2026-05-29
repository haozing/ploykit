import { redirect } from 'next/navigation';
import { localizedAdminPath, DEFAULT_LANGUAGE } from '@host/lib/i18n';

export const dynamic = 'force-dynamic';

export default function AdminPage() {
  redirect(localizedAdminPath(DEFAULT_LANGUAGE));
}
