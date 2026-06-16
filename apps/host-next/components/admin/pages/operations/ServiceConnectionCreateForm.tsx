import { ConfirmSubmitButton, Input, Select } from '@host/components/ui';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { SupportedLanguage } from '@host/lib/i18n';
import {
  connectionAuthTypeOptions,
  connectionOwnerTypeOptions,
  connectionScopeTypeOptions,
} from './OperationsPageUtils';
import type { AdminFormAction } from './ServiceConnectionMaintenanceModel';

export function ServiceConnectionCreateForm({
  lang,
  action,
}: {
  lang: SupportedLanguage;
  action: AdminFormAction;
}) {
  return (
    <form
      action={action}
      className="rounded-admin-md border border-admin-border bg-admin-surface p-5 shadow-admin-card grid gap-4"
    >
      <div>
        <h2>{adminInlineText(lang, 'Create Connection')}</h2>
        <p>
          {adminInlineText(
            lang,
            '声明一个自定义 provider 连接，secret 只能填写 env 或 encrypted 引用。'
          )}
        </p>
      </div>
      <Input
        name="connectionId"
        placeholder={adminInlineText(lang, 'custom:crm-api')}
        aria-label={adminInlineText(lang, 'Connection ID')}
        required
      />
      <Input
        name="service"
        placeholder={adminInlineText(lang, 'crm-api')}
        aria-label={adminInlineText(lang, 'Service')}
        required
      />
      <Input
        name="provider"
        placeholder={adminInlineText(lang, 'custom-http')}
        aria-label={adminInlineText(lang, 'Provider')}
        required
      />
      <Input
        name="baseUrl"
        placeholder={adminInlineText(lang, 'https://api.example.com')}
        aria-label={adminInlineText(lang, 'Base URL')}
        required
      />
      <Select name="authType" defaultValue="apiKey" aria-label={adminInlineText(lang, 'Auth type')}>
        {connectionAuthTypeOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {adminInlineText(lang, option.label)}
          </option>
        ))}
      </Select>
      <Input
        name="secretSource"
        placeholder={adminInlineText(lang, 'env:CRM_API_KEY')}
        aria-label={adminInlineText(lang, 'Secret source')}
      />
      <textarea
        name="secretRefs"
        placeholder={adminInlineText(
          lang,
          'bearertoken_env_service_bearer_token_hmacsecret_env__a8f7b281'
        )}
        aria-label={adminInlineText(lang, 'Secret refs JSON')}
        className="min-h-24 rounded-admin-md border border-admin-border bg-admin-elevated px-3 py-2 text-sm text-admin-text shadow-admin-inset outline-none transition focus:border-admin-primary"
      />
      <Select name="ownerType" defaultValue="workspace" aria-label={adminInlineText(lang, 'Owner type')}>
        {connectionOwnerTypeOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {adminInlineText(lang, option.label)}
          </option>
        ))}
      </Select>
      <Select name="scopeType" defaultValue="workspace" aria-label={adminInlineText(lang, 'Scope type')}>
        {connectionScopeTypeOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {adminInlineText(lang, option.label)}
          </option>
        ))}
      </Select>
      <Input
        name="workspaceId"
        placeholder={adminInlineText(lang, 'default-workspace')}
        aria-label={adminInlineText(lang, 'Workspace ID')}
      />
      <Input
        name="environment"
        placeholder={adminInlineText(lang, 'development')}
        aria-label={adminInlineText(lang, 'Environment')}
      />
      <Input
        name="timeoutMs"
        placeholder="8000"
        aria-label={adminInlineText(lang, 'Timeout milliseconds')}
      />
      <Input
        name="retry"
        placeholder={adminInlineText(lang, '2 attempts / exponential')}
        aria-label={adminInlineText(lang, 'Retry policy')}
      />
      <Input
        name="maxResponseBytes"
        placeholder="524288"
        aria-label={adminInlineText(lang, 'Max response bytes')}
      />
      <Input
        name="healthCheck"
        placeholder={adminInlineText(lang, '/health or provider readiness')}
        aria-label={adminInlineText(lang, 'Health check')}
      />
      <Input
        name="actorClaims"
        placeholder={adminInlineText(lang, 'system')}
        aria-label={adminInlineText(lang, 'Actor claims')}
      />
      <Input
        name="reason"
        placeholder={adminInlineText(lang, 'reason')}
        aria-label={adminInlineText(lang, 'Create connection reason')}
      />
      <ConfirmSubmitButton
        type="submit"
        className="inline-flex min-h-8 items-center justify-center rounded-admin-md bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
        confirmation={adminInlineText(lang, '确认创建自定义 service connection？')}
      >
        {adminInlineText(lang, 'Create')}
      </ConfirmSubmitButton>
    </form>
  );
}
