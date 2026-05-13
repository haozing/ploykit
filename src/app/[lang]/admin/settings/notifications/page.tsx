import { redirect } from 'next/navigation';

export default async function AdminNotificationSettingsRedirect({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  redirect(`/${lang}/settings/notifications`);
}
