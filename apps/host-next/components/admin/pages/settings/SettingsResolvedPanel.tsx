import { AdminPanel, FactList } from '@host/components/admin/shared/AdminPrimitives';
import { DataTable } from '@host/components/ui';
import type { SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminHostSettingsView } from '@host/lib/admin-settings';

function compactJson(value: unknown, maxLength = Number.POSITIVE_INFINITY): string {
  if (value === undefined) {
    return '';
  }
  const text = JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

export function SettingsResolvedPanel({
  lang,
  settings,
}: {
  lang: SupportedLanguage;
  settings: AdminHostSettingsView;
}) {
  return (
    <AdminPanel
      className="order-3"
      title={adminInlineText(lang, 'Resolved product settings')}
      description={adminInlineText(
        lang,
        'Current values after environment and runtime overrides are resolved.'
      )}
    >
      <FactList
        lang={lang}
        className="md:grid-cols-2 xl:grid-cols-3"
        density="compact"
        items={[
          { label: 'Site name', value: settings.siteName },
          { label: 'Support email', value: settings.supportEmail },
          { label: 'Locale', value: settings.defaultLocale },
          { label: 'Timezone', value: settings.timezone },
          { label: 'Email verification', value: String(settings.requireEmailVerification) },
          { label: 'Session max age', value: `${settings.sessionMaxAgeDays} days` },
          { label: 'Password min length', value: String(settings.passwordMinLength) },
          { label: 'Email provider', value: settings.emailProvider },
          { label: 'From', value: `${settings.fromName} <${settings.fromEmail}>` },
          { label: 'Digest', value: settings.digestFrequency },
          { label: 'Source', value: settings.source },
          {
            label: 'Version',
            value: settings.version ? String(settings.version) : 'not versioned',
          },
          { label: 'Updated', value: settings.updatedAt ?? 'not updated' },
        ]}
      />
      <div className="mt-4">
        <DataTable
          columns={adminInlineColumns(lang, [
            'Setting',
            'Value',
            'Default',
            'Source',
            'Risk',
            'Restart',
            'Scope',
          ])}
          rows={settings.fields.map((field) => [
            <span key={`${field.key}:setting`} className="block min-w-0">
              <span className="block truncate font-semibold text-admin-text">{field.key}</span>
              <span className="mt-1 block text-xs leading-5 text-admin-text-muted">
                {field.description}
              </span>
            </span>,
            compactJson(field.value),
            compactJson(field.defaultValue),
            field.source,
            field.risk,
            adminInlineText(lang, field.requiresRestart ? 'yes' : 'no'),
            field.scope,
          ])}
        />
      </div>
    </AdminPanel>
  );
}
