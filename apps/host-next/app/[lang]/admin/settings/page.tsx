import { CompositionSettings } from '@host/components/admin/CompositionSettings';
import { AdminSettingsOperationsPage } from '@host/components/admin/AdminPages';
import { getAdminOperationsView } from '@host/lib/admin-module-operations';
import { getAdminHostSettingsView, updateAdminHostSettings } from '@host/lib/admin-settings';
import { getAdminProviderStatusView } from '@host/lib/admin-provider-status';
import { getAdminWorkerStatusView } from '@host/lib/admin-worker-status';
import { runHostConfigDoctor } from '@host/lib/config-doctor';
import { getHostRuntimeHealth } from '@host/lib/create-host';
import { isSupportedLanguage } from '@host/lib/i18n';
import { getProductCompositionView } from '@host/lib/product-composition';
import { createAdminAction } from '@host/lib/admin-action';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';

function readString(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(formData: FormData, name: string): number | undefined {
  const value = readString(formData, name);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readBoolean(formData: FormData, name: string): boolean {
  return formData.get(name) === 'on' || formData.get(name) === 'true';
}

const updateSettingsAction = createAdminAction({
  id: 'settings.update',
  parse: (formData) => {
    const digest = readString(formData, 'digestFrequency');
    const defaultLocale = readString(formData, 'defaultLocale');
    const digestFrequency: 'immediate' | 'daily' | 'weekly' | 'off' | undefined =
      digest === 'daily' || digest === 'weekly' || digest === 'off' || digest === 'immediate'
        ? digest
        : undefined;
    return {
      siteName: readString(formData, 'siteName'),
      supportEmail: readString(formData, 'supportEmail'),
      defaultLocale:
        defaultLocale && isSupportedLanguage(defaultLocale) ? defaultLocale : undefined,
      timezone: readString(formData, 'timezone'),
      requireEmailVerification: readBoolean(formData, 'requireEmailVerification'),
      sessionMaxAgeDays: readNumber(formData, 'sessionMaxAgeDays'),
      passwordMinLength: readNumber(formData, 'passwordMinLength'),
      emailProvider: readString(formData, 'emailProvider'),
      fromEmail: readString(formData, 'fromEmail'),
      fromName: readString(formData, 'fromName'),
      digestFrequency,
      reason: readString(formData, 'reason'),
    };
  },
  run: ({ session, input }) => updateAdminHostSettings(session, input),
  revalidate: () => ['/admin/settings'],
  audit: {
    metadata: ({ input }) => ({
      fields: Object.entries(input)
        .filter(([key, value]) => key !== 'reason' && value !== undefined)
        .map(([key]) => key),
      reason: input.reason,
    }),
  },
});

export default async function AdminSettingsPage({
  params,
}: {
  params: Promise<LanguageRouteParams>;
}) {
  const [lang] = await readLanguageAndRequireAdmin(params, '/admin/settings');
  const [view, health, configDoctor, settings, composition] = await Promise.all([
    getAdminOperationsView(),
    getHostRuntimeHealth(),
    runHostConfigDoctor({ projectRoot: process.cwd() }),
    getAdminHostSettingsView(),
    getProductCompositionView(),
  ]);
  const [providerStatus, workerStatus] = await Promise.all([
    getAdminProviderStatusView({ configDoctor }),
    getAdminWorkerStatusView(),
  ]);
  return (
    <AdminSettingsOperationsPage
      lang={lang}
      snapshot={view.snapshot}
      store={view.store}
      health={health}
      configDoctor={configDoctor}
      providerStatus={providerStatus}
      workerStatus={workerStatus}
      settings={settings}
      updateSettingsAction={updateSettingsAction}
      compositionPanel={<CompositionSettings lang={lang} view={composition} />}
    />
  );
}
