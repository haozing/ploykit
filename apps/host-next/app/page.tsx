import { redirect } from 'next/navigation';
import { localizedPath, DEFAULT_LANGUAGE } from '@host/lib/i18n';

export default function HomePage() {
  redirect(localizedPath(DEFAULT_LANGUAGE));
}
