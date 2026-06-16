import { ConfirmSubmitButton, Input, Select } from '@host/components/ui';
import { FactList } from '@host/components/admin/shared/AdminPrimitives';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { SupportedLanguage } from '@host/lib/i18n';
import type { AdminServiceConnectionsView } from '@host/lib/admin-service-connections';
import type { AdminFormAction } from './ServiceConnectionMaintenanceModel';

export function ServiceConnectionSecretRotationForm({
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
        <h2>{adminInlineText(lang, 'Secret rotation wizard')}</h2>
        <p>
          {adminInlineText(
            lang,
            'Rotate by pointing the connection at a new env or encrypted secret reference. Plaintext secrets are never entered here.'
          )}
        </p>
      </div>
      <FactList
        lang={lang}
        density="compact"
        items={[
          {
            label: 'Step 1',
            value: adminInlineText(
              lang,
              'choose_the_connection_that_will_read_a_new_secret_re_09c104d3'
            ),
          },
          {
            label: 'Step 2',
            value: adminInlineText(
              lang,
              'enter_env_name_after_the_secret_is_provisioned_as_an_ab33c040'
            ),
          },
          {
            label: 'Step 3',
            value: adminInlineText(
              lang,
              'run_test_from_the_provider_matrix_and_verify_audit_e_4c9b8122'
            ),
          },
        ]}
      />
      <Select name="connectionId" aria-label={adminInlineText(lang, 'Connection')}>
        {connections.connections.map((connection) => (
          <option key={connection.id} value={connection.id}>
            {connection.id} · {connection.service}
          </option>
        ))}
      </Select>
      <Input
        name="secretSource"
        placeholder={adminInlineText(lang, 'env:NEW_SECRET')}
        aria-label={adminInlineText(lang, 'Secret source')}
        required
      />
      <Input
        name="reason"
        placeholder={adminInlineText(lang, 'rotation reason')}
        aria-label={adminInlineText(lang, 'Rotation reason')}
        required
      />
      <ConfirmSubmitButton
        type="submit"
        className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-warning/25 bg-admin-warning/10 px-3 py-1.5 text-xs font-semibold text-admin-warning transition hover:bg-admin-warning/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
        confirmation={adminInlineText(
          lang,
          '确认轮换该 service connection secret reference？请确认新 secret 已在环境或密文存储中就绪。'
        )}
      >
        {adminInlineText(lang, 'Rotate secret')}
      </ConfirmSubmitButton>
    </form>
  );
}
