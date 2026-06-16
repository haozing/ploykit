import { DetailDrawer } from '@host/components/ui';
import { CopyButton } from '@host/components/ui/CopyButton';
import { FactList } from '@host/components/admin/shared/AdminPrimitives';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { SupportedLanguage } from '@host/lib/i18n';
import type { AdminOutboxDetailView } from '@host/lib/admin-delivery';

export function AdminWebhookDetailDrawer({
  lang,
  outbox,
}: {
  lang: SupportedLanguage;
  outbox: NonNullable<AdminOutboxDetailView['outbox']>;
}) {
  return (
    <DetailDrawer
      open
      title={adminInlineText(lang, 'Outbox snapshot')}
      description={outbox.id}
      actions={
        <CopyButton
          value={outbox.id}
          label={adminInlineText(lang, 'Copy ID')}
          copiedLabel={adminInlineText(lang, 'Copied ID')}
        />
      }
      className="xl:sticky xl:top-24 xl:self-start"
    >
      <FactList
        lang={lang}
        items={[
          { label: 'Outbox ID', value: outbox.id, copyValue: outbox.id, mono: true },
          { label: 'Name', value: outbox.name },
          { label: 'Module', value: outbox.moduleId ?? 'host', mono: true },
          { label: 'Status', value: outbox.status },
          { label: 'Attempts', value: String(outbox.attempts) },
          { label: 'Created', value: outbox.createdAt },
          { label: 'Updated', value: outbox.updatedAt },
        ]}
      />
    </DetailDrawer>
  );
}
