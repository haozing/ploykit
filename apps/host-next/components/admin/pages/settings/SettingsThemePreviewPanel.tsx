import { AdminPanel, FactList } from '@host/components/admin/shared/AdminPrimitives';
import { Input, Select } from '@host/components/ui';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import type { SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminHostSettingsView } from '@host/lib/admin-settings';

export function SettingsThemePreviewPanel({
  lang,
  settings,
}: {
  lang: SupportedLanguage;
  settings?: AdminHostSettingsView;
}) {
  return (
    <AdminPanel
      className="order-4"
      title={adminInlineText(lang, 'Theme component preview')}
      description={adminInlineText(
        lang,
        'A compact smoke preview for shell primitives. Full profile, workspace scope, diagnostics, and rollout checks live in Theme management below.'
      )}
    >
      <div className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: 'Surface',
              className: 'bg-admin-surface text-admin-text border-admin-border',
              value: 'surface / text / border',
            },
            {
              label: 'Primary',
              className: 'bg-admin-primary text-white border-admin-primary',
              value: 'primary action',
            },
            {
              label: 'Success',
              className: 'bg-admin-success/10 text-admin-success border-admin-success/25',
              value: 'success state',
            },
            {
              label: 'Warning',
              className: 'bg-admin-warning/10 text-admin-warning border-admin-warning/25',
              value: 'warning state',
            },
          ].map((token) => (
            <article key={token.label} className={`rounded-admin-md border p-4 ${token.className}`}>
              <span className="block text-[11px] font-semibold uppercase opacity-75">
                {token.label}
              </span>
              <strong className="mt-3 block text-lg">{token.value}</strong>
            </article>
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-admin-md border border-admin-border bg-admin-bg/45 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-flex min-h-9 items-center justify-center rounded-admin-md bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white"
              >
                {adminInlineText(lang, 'Primary')}
              </button>
              <button
                type="button"
                className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text"
              >
                {adminInlineText(lang, 'Secondary')}
              </button>
              <StatusBadge lang={lang} value="ready" tone="success" />
              <StatusBadge lang={lang} value="warning" tone="warning" />
              <StatusBadge lang={lang} value="failed" tone="danger" />
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-3">
              <Input
                defaultValue={settings?.siteName ?? 'PloyKit'}
                aria-label={adminInlineText(lang, 'Theme preview input')}
              />
              <Select
                defaultValue="comfortable"
                aria-label={adminInlineText(lang, 'Theme preview density')}
              >
                <option value="comfortable">{adminInlineText(lang, 'comfortable')}</option>
                <option value="compact">{adminInlineText(lang, 'compact')}</option>
              </Select>
              <div className="rounded-admin-md border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text-muted">
                {adminInlineText(lang, 'radius · border · focus')}
              </div>
            </div>
          </div>
          <FactList
            lang={lang}
            density="compact"
            items={[
              { label: 'Scope', value: 'product / workspace / module override' },
              {
                label: 'Allowed tokens',
                value:
                  'background, foreground, card, muted, border, primary, success, warning, destructive, radius',
              },
              { label: 'Admin shell', value: 'token consumer, not arbitrary CSS target' },
            ]}
          />
        </div>
      </div>
    </AdminPanel>
  );
}
