import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { SupportedLanguage } from '@host/lib/i18n';
import type { AdminServiceConnectionsView } from '@host/lib/admin-service-connections';
import { ServiceConnectionCreateForm } from './ServiceConnectionCreateForm';
import { ServiceConnectionPolicyForm } from './ServiceConnectionPolicyForm';
import { ServiceConnectionRetentionForm } from './ServiceConnectionRetentionForm';
import { ServiceConnectionSecretRotationForm } from './ServiceConnectionSecretRotationForm';
import type { AdminFormAction } from './ServiceConnectionMaintenanceModel';

export function AdminServiceConnectionMaintenancePanel({
  lang,
  connections,
  createConnectionAction,
  updateConnectionPolicyAction,
  applyLogRetentionAction,
  rotateConnectionSecretAction,
}: {
  lang: SupportedLanguage;
  connections: AdminServiceConnectionsView;
  createConnectionAction?: AdminFormAction;
  updateConnectionPolicyAction?: AdminFormAction;
  applyLogRetentionAction?: AdminFormAction;
  rotateConnectionSecretAction?: AdminFormAction;
}) {
  if (
    !createConnectionAction &&
    !updateConnectionPolicyAction &&
    !applyLogRetentionAction &&
    !rotateConnectionSecretAction
  ) {
    return null;
  }

  return (
    <details className="rounded-admin-md border border-admin-border bg-admin-surface shadow-admin-card">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-admin-text transition hover:bg-admin-surface-muted/60 [&::-webkit-details-marker]:hidden">
        {adminInlineText(lang, 'Connection maintenance')}
      </summary>
      <section className="connection-policy-grid border-t border-admin-border p-4">
        {createConnectionAction ? (
          <ServiceConnectionCreateForm lang={lang} action={createConnectionAction} />
        ) : null}
        {updateConnectionPolicyAction ? (
          <ServiceConnectionPolicyForm
            lang={lang}
            connections={connections}
            action={updateConnectionPolicyAction}
          />
        ) : null}
        {rotateConnectionSecretAction ? (
          <ServiceConnectionSecretRotationForm
            lang={lang}
            connections={connections}
            action={rotateConnectionSecretAction}
          />
        ) : null}
        {applyLogRetentionAction ? (
          <ServiceConnectionRetentionForm
            lang={lang}
            connections={connections}
            action={applyLogRetentionAction}
          />
        ) : null}
      </section>
    </details>
  );
}
