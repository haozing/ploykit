import { FormField } from '@host/components/ProductShell';
import { AdminPanel } from '@host/components/admin/shared/AdminPrimitives';
import { ConfirmSubmitButton, Input, Select } from '@host/components/ui';
import type { SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminHostSettingsView } from '@host/lib/admin-settings';

export type AdminFormAction = (formData: FormData) => void | Promise<void>;

type AdminSettingsFieldKey = AdminHostSettingsView['fields'][number]['key'];

const saveSettingsButtonClass =
  'inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 py-1.5 text-xs font-semibold text-admin-primary transition hover:bg-admin-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50';

function settingsField(settings: AdminHostSettingsView, key: AdminSettingsFieldKey) {
  return settings.fields.find((field) => field.key === key);
}

function settingDisabled(settings: AdminHostSettingsView, key: AdminSettingsFieldKey) {
  const field = settingsField(settings, key);
  return Boolean(field && !field.editable);
}

function settingDiffProps(
  settings: AdminHostSettingsView,
  key: AdminSettingsFieldKey,
  value: string | number | boolean
) {
  const field = settingsField(settings, key);
  return {
    'data-current-value': String(value),
    'data-risk': field?.risk ?? 'unknown',
    'data-requires-restart': String(Boolean(field?.requiresRestart)),
  };
}

export function SettingsSaveButton({
  lang,
  formId,
}: {
  lang: SupportedLanguage;
  formId?: string;
}) {
  return (
    <ConfirmSubmitButton
      form={formId}
      type="submit"
      className={saveSettingsButtonClass}
      confirmation={adminInlineText(lang, '确认保存系统设置？')}
      formDiff
      formDiffTitle={adminInlineText(lang, 'change_diff_risk_restart_impact_c5687988')}
      formDiffEmptyLabel={adminInlineText(lang, 'no_field_changes_detected_1503883a')}
    >
      {adminInlineText(lang, 'Save Settings')}
    </ConfirmSubmitButton>
  );
}

export function SettingsProductSettingsPanel({
  lang,
  settings,
  updateSettingsAction,
}: {
  lang: SupportedLanguage;
  settings: AdminHostSettingsView;
  updateSettingsAction: AdminFormAction;
}) {
  return (
    <AdminPanel
      className="order-2"
      title={adminInlineText(lang, 'Product settings')}
      description={adminInlineText(
        lang,
        'White-label product settings stay separate from runtime and diagnostic evidence. Changes write audit records.'
      )}
    >
      <form id="settings-product-form" action={updateSettingsAction} className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <FormField label={adminInlineText(lang, 'Site name')} htmlFor="settings-site-name">
            <Input
              id="settings-site-name"
              name="siteName"
              defaultValue={settings.siteName}
              disabled={settingDisabled(settings, 'siteName')}
              {...settingDiffProps(settings, 'siteName', settings.siteName)}
            />
          </FormField>
          <FormField label={adminInlineText(lang, 'Support email')} htmlFor="settings-support-email">
            <Input
              id="settings-support-email"
              name="supportEmail"
              defaultValue={settings.supportEmail}
              disabled={settingDisabled(settings, 'supportEmail')}
              {...settingDiffProps(settings, 'supportEmail', settings.supportEmail)}
            />
          </FormField>
          <FormField label={adminInlineText(lang, 'Locale')} htmlFor="settings-locale">
            <Select
              id="settings-locale"
              name="defaultLocale"
              defaultValue={settings.defaultLocale}
              disabled={settingDisabled(settings, 'defaultLocale')}
              {...settingDiffProps(settings, 'defaultLocale', settings.defaultLocale)}
            >
              <option value="zh">zh</option>
              <option value="en">en</option>
            </Select>
          </FormField>
          <FormField label={adminInlineText(lang, 'Timezone')} htmlFor="settings-timezone">
            <Input
              id="settings-timezone"
              name="timezone"
              defaultValue={settings.timezone}
              disabled={settingDisabled(settings, 'timezone')}
              {...settingDiffProps(settings, 'timezone', settings.timezone)}
            />
          </FormField>
          <FormField
            label={adminInlineText(lang, 'Session max age days')}
            htmlFor="settings-session-age"
          >
            <Input
              id="settings-session-age"
              name="sessionMaxAgeDays"
              defaultValue={String(settings.sessionMaxAgeDays)}
              disabled={settingDisabled(settings, 'sessionMaxAgeDays')}
              {...settingDiffProps(settings, 'sessionMaxAgeDays', settings.sessionMaxAgeDays)}
            />
          </FormField>
          <FormField
            label={adminInlineText(lang, 'Password min length')}
            htmlFor="settings-password-min"
          >
            <Input
              id="settings-password-min"
              name="passwordMinLength"
              defaultValue={String(settings.passwordMinLength)}
              disabled={settingDisabled(settings, 'passwordMinLength')}
              {...settingDiffProps(settings, 'passwordMinLength', settings.passwordMinLength)}
            />
          </FormField>
          <FormField label={adminInlineText(lang, 'Email provider')} htmlFor="settings-email-provider">
            <Select
              id="settings-email-provider"
              name="emailProvider"
              defaultValue={settings.emailProvider}
              disabled={settingDisabled(settings, 'emailProvider')}
              {...settingDiffProps(settings, 'emailProvider', settings.emailProvider)}
            >
              <option value="log">{adminInlineText(lang, 'log')}</option>
              <option value="webhook">{adminInlineText(lang, 'webhook')}</option>
              <option value="disabled">{adminInlineText(lang, 'disabled')}</option>
            </Select>
          </FormField>
          <FormField label={adminInlineText(lang, 'Digest frequency')} htmlFor="settings-digest">
            <Select
              id="settings-digest"
              name="digestFrequency"
              defaultValue={settings.digestFrequency}
              disabled={settingDisabled(settings, 'digestFrequency')}
              {...settingDiffProps(settings, 'digestFrequency', settings.digestFrequency)}
            >
              <option value="immediate">{adminInlineText(lang, 'immediate')}</option>
              <option value="daily">{adminInlineText(lang, 'daily')}</option>
              <option value="weekly">{adminInlineText(lang, 'weekly')}</option>
              <option value="off">{adminInlineText(lang, 'off')}</option>
            </Select>
          </FormField>
          <FormField label={adminInlineText(lang, 'From name')} htmlFor="settings-from-name">
            <Input
              id="settings-from-name"
              name="fromName"
              defaultValue={settings.fromName}
              disabled={settingDisabled(settings, 'fromName')}
              {...settingDiffProps(settings, 'fromName', settings.fromName)}
            />
          </FormField>
          <FormField label={adminInlineText(lang, 'From email')} htmlFor="settings-from-email">
            <Input
              id="settings-from-email"
              name="fromEmail"
              defaultValue={settings.fromEmail}
              disabled={settingDisabled(settings, 'fromEmail')}
              {...settingDiffProps(settings, 'fromEmail', settings.fromEmail)}
            />
          </FormField>
          <FormField label={adminInlineText(lang, 'Change reason')} htmlFor="settings-reason">
            <Input id="settings-reason" name="reason" defaultValue="" />
          </FormField>
        </div>
        <div className="flex flex-col gap-3 border-t border-admin-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="checkbox-row">
            <input
              type="checkbox"
              name="requireEmailVerification"
              defaultChecked={settings.requireEmailVerification}
              disabled={settingDisabled(settings, 'requireEmailVerification')}
              {...settingDiffProps(
                settings,
                'requireEmailVerification',
                settings.requireEmailVerification
              )}
            />
            <span>{adminInlineText(lang, 'Require email verification')}</span>
          </label>
          <div className="text-sm text-admin-text-muted">
            {adminInlineText(lang, 'source')} {settings.source}
            {settings.updatedAt
              ? adminInlineText(lang, 'updated_value_5da794a3', {
                  value1: settings.updatedAt,
                })
              : ''}
          </div>
          <SettingsSaveButton lang={lang} />
        </div>
      </form>
    </AdminPanel>
  );
}
