import { ConfirmSubmitButton, Input, Select } from '@host/components/ui';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { SupportedLanguage } from '@host/lib/i18n';
import type { AdminServiceConnectionsView } from '@host/lib/admin-service-connections';
import { connectionAuthTypeOptions } from './OperationsPageUtils';
import type { AdminFormAction } from './ServiceConnectionMaintenanceModel';

export function ServiceConnectionPolicyForm({
  lang,
  connections,
  action,
}: {
  lang: SupportedLanguage;
  connections: AdminServiceConnectionsView;
  action: AdminFormAction;
}) {
  return (
    <form
      action={action}
      className="rounded-admin-md border border-admin-border bg-admin-surface p-5 shadow-admin-card grid gap-4"
    >
      <div>
        <h2>{adminInlineText(lang, 'Update Policy')}</h2>
        <p>
          {adminInlineText(lang, '覆盖连接策略；空字段保持当前值，secret source 不接收明文。')}
        </p>
      </div>
      <Select name="connectionId" aria-label={adminInlineText(lang, 'Connection')}>
        {connections.connections.map((connection) => (
          <option key={connection.id} value={connection.id}>
            {connection.id}
          </option>
        ))}
      </Select>
      <Input
        name="baseUrl"
        placeholder={adminInlineText(lang, 'baseUrl')}
        aria-label={adminInlineText(lang, 'Base URL')}
      />
      <Select name="authType" defaultValue="" aria-label={adminInlineText(lang, 'Auth type')}>
        <option value="">{adminInlineText(lang, 'Keep current')}</option>
        {connectionAuthTypeOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {adminInlineText(lang, option.label)}
          </option>
        ))}
      </Select>
      <Input
        name="secretSource"
        placeholder={adminInlineText(lang, 'env:NAME')}
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
      <Input
        name="timeoutMs"
        placeholder={adminInlineText(lang, 'timeoutMs')}
        aria-label={adminInlineText(lang, 'Timeout milliseconds')}
      />
      <Input
        name="retry"
        placeholder={adminInlineText(lang, 'retry policy')}
        aria-label={adminInlineText(lang, 'Retry policy')}
      />
      <Input
        name="maxResponseBytes"
        placeholder={adminInlineText(lang, 'maxResponseBytes')}
        aria-label={adminInlineText(lang, 'Max response bytes')}
      />
      <Input
        name="healthCheck"
        placeholder={adminInlineText(lang, 'health check')}
        aria-label={adminInlineText(lang, 'Health check')}
      />
      <Input
        name="actorClaims"
        placeholder={adminInlineText(lang, 'actor claims')}
        aria-label={adminInlineText(lang, 'Actor claims')}
      />
      <Input
        name="reason"
        placeholder={adminInlineText(lang, 'reason')}
        aria-label={adminInlineText(lang, 'Update connection reason')}
      />
      <ConfirmSubmitButton
        type="submit"
        className="inline-flex min-h-8 items-center justify-center rounded-admin-md px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
        confirmation={adminInlineText(lang, '确认更新 service connection policy？')}
      >
        {adminInlineText(lang, 'Update Policy')}
      </ConfirmSubmitButton>
    </form>
  );
}
