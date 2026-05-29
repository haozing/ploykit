import { redirect } from 'next/navigation';
import { AdminWebhookDetailOperationsPage } from '@host/components/admin/AdminPages';
import { createAdminAction } from '@host/lib/admin-action';
import {
  archiveAdminOutbox,
  discardAdminOutbox,
  getAdminOutboxDetail,
  retryAdminWebhookReceipt,
  retryAdminOutbox,
} from '@host/lib/admin-delivery';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';
import { readAdminTableQuery, type RouteSearchParams } from '@host/lib/table-query';

interface AdminOutboxDetailRouteParams extends LanguageRouteParams {
  outboxId: string;
}

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`ADMIN_FORM_FIELD_REQUIRED: ${name}`);
  }
  return value;
}

function readOptionalFormString(formData: FormData, name: string, fallback: string): string {
  const value = formData.get(name);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function operationResultHref(
  lang: SupportedLanguage,
  outboxId: string,
  operation: string,
  input: {
    processed?: number;
    failed?: number;
    skipped?: number;
    deadLettered?: number;
  }
) {
  const processed = input.processed ?? 0;
  const failed = input.failed ?? 0;
  const deadLettered = input.deadLettered ?? 0;
  const skipped = input.skipped ?? 0;
  const matched = processed + failed + deadLettered + skipped;
  const params = new URLSearchParams({
    operation,
    outcome: failed > 0 || deadLettered > 0 ? 'warning' : 'success',
    matched: String(matched),
    processed: String(processed),
    failed: String(failed),
    skipped: String(skipped),
    deadLettered: String(deadLettered),
  });
  return `${localizedPath(lang, `/admin/webhooks/${outboxId}`)}?${params.toString()}`;
}

const retryOutboxAction = createAdminAction({
  id: 'webhooks.detail.retryOutbox',
  parse: (formData) => ({
    outboxId: readRequiredFormString(formData, 'outboxId'),
    reason: readOptionalFormString(formData, 'reason', 'Retried from detail page'),
  }),
  run: ({ session, input }) => retryAdminOutbox(session, input.outboxId, input.reason),
  revalidate: ({ input }) => ['/admin/webhooks', `/admin/webhooks/${input.outboxId}`],
  redirect: ({ lang, input }) => operationResultHref(lang, input.outboxId, 'outbox retry', { processed: 1 }),
  audit: { metadata: ({ input }) => input },
});

const discardOutboxAction = createAdminAction({
  id: 'webhooks.detail.discardOutbox',
  parse: (formData) => ({
    outboxId: readRequiredFormString(formData, 'outboxId'),
    reason: readOptionalFormString(formData, 'reason', 'Discarded from detail page'),
  }),
  run: ({ session, input }) => discardAdminOutbox(session, input.outboxId, input.reason),
  revalidate: ({ input }) => ['/admin/webhooks', `/admin/webhooks/${input.outboxId}`],
  redirect: ({ lang, input }) => operationResultHref(lang, input.outboxId, 'outbox discard', { processed: 1 }),
  audit: { metadata: ({ input }) => input },
});

const archiveOutboxAction = createAdminAction({
  id: 'webhooks.detail.archiveOutbox',
  parse: (formData) => ({
    outboxId: readRequiredFormString(formData, 'outboxId'),
    reason: readOptionalFormString(formData, 'reason', 'Archived from detail page'),
  }),
  run: ({ session, input }) => archiveAdminOutbox(session, input.outboxId, input.reason),
  revalidate: ({ input }) => ['/admin/webhooks', `/admin/webhooks/${input.outboxId}`],
  redirect: ({ lang, input }) => operationResultHref(lang, input.outboxId, 'outbox archive', { processed: 1 }),
  audit: { metadata: ({ input }) => input },
});

const retryWebhookReceiptAction = createAdminAction({
  id: 'webhooks.detail.retryReceipt',
  parse: (formData) => ({
    receiptId: readRequiredFormString(formData, 'receiptId'),
    outboxId: readOptionalFormString(formData, 'outboxId', ''),
    reason: readOptionalFormString(formData, 'reason', 'Retried from outbox detail page'),
  }),
  run: ({ session, input }) => retryAdminWebhookReceipt(session, input.receiptId, input.reason),
  revalidate: ({ input }) =>
    input.outboxId ? ['/admin/webhooks', `/admin/webhooks/${input.outboxId}`] : ['/admin/webhooks'],
  redirect: ({ lang, input }) =>
    input.outboxId
      ? operationResultHref(lang, input.outboxId, 'webhook receipt retry', { processed: 1 })
      : `${localizedPath(lang, '/admin/webhooks')}?operation=webhook+receipt+retry&outcome=success&matched=1&processed=1&failed=0&skipped=0&deadLettered=0`,
  audit: { metadata: ({ input }) => input },
});

export default async function AdminOutboxDetailPage({
  params,
  searchParams,
}: {
  params: Promise<AdminOutboxDetailRouteParams>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const resolved = await params;
  const [lang] = await readLanguageAndRequireAdmin(
    Promise.resolve(resolved),
    `/admin/webhooks/${resolved.outboxId}`
  );
  const [detail, query] = await Promise.all([
    getAdminOutboxDetail(resolved.outboxId),
    readAdminTableQuery(searchParams),
  ]);
  return (
    <AdminWebhookDetailOperationsPage
      lang={lang}
      detail={detail}
      retryOutboxAction={retryOutboxAction}
      discardOutboxAction={discardOutboxAction}
      archiveOutboxAction={archiveOutboxAction}
      retryWebhookReceiptAction={retryWebhookReceiptAction}
      query={query}
    />
  );
}
