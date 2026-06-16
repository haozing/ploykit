import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminTableQuery } from '@host/lib/table-query';
import type { RuntimeStoreCommercialOrder } from '@/lib/module-runtime';
import type { AdminCommercialView } from '@host/lib/admin-commercial';

export interface AdminPagedResult<T> {
  items: T[];
  page: {
    total: number;
    offset: number;
    limit: number;
  };
}

export function cleanRevenueTableQuery(query?: AdminTableQuery): Required<AdminTableQuery> {
  return {
    q: query?.q?.trim() ?? '',
    status: query?.status?.trim() ?? '',
    role: query?.role?.trim() ?? '',
    type: query?.type?.trim() ?? '',
    moduleId: query?.moduleId?.trim() ?? '',
    service: query?.service?.trim() ?? '',
    workspace: query?.workspace?.trim() ?? '',
    environment: query?.environment?.trim() ?? '',
    range: query?.range?.trim() ?? '',
    from: query?.from?.trim() ?? '',
    to: query?.to?.trim() ?? '',
    owner: query?.owner?.trim() ?? '',
    mime: query?.mime?.trim() ?? '',
    provider: query?.provider?.trim() ?? '',
    path: query?.path?.trim() ?? '',
    minSize: query?.minSize ?? 0,
    maxSize: query?.maxSize ?? 0,
    page: query?.page ?? 1,
    pageSize: query?.pageSize ?? 20,
    operation: query?.operation?.trim() ?? '',
    outcome: query?.outcome?.trim() ?? '',
    matched: query?.matched ?? 0,
    processed: query?.processed ?? 0,
    failed: query?.failed ?? 0,
    skipped: query?.skipped ?? 0,
    deadLettered: query?.deadLettered ?? 0,
  };
}

export function adminListHref(
  lang: SupportedLanguage,
  path: string,
  query: Required<AdminTableQuery>,
  page: number
): string {
  const params = new URLSearchParams();
  if (query.q) {
    params.set('q', query.q);
  }
  if (query.status) {
    params.set('status', query.status);
  }
  if (query.role) {
    params.set('role', query.role);
  }
  if (query.type) {
    params.set('type', query.type);
  }
  if (query.moduleId) {
    params.set('moduleId', query.moduleId);
  }
  if (query.service) {
    params.set('service', query.service);
  }
  if (query.workspace) {
    params.set('workspace', query.workspace);
  }
  if (query.environment) {
    params.set('environment', query.environment);
  }
  if (query.range) {
    params.set('range', query.range);
  }
  if (query.from) {
    params.set('from', query.from);
  }
  if (query.to) {
    params.set('to', query.to);
  }
  if (query.owner) {
    params.set('owner', query.owner);
  }
  if (query.mime) {
    params.set('mime', query.mime);
  }
  if (query.provider) {
    params.set('provider', query.provider);
  }
  if (query.path) {
    params.set('path', query.path);
  }
  if (query.minSize) {
    params.set('minSize', String(query.minSize));
  }
  if (query.maxSize) {
    params.set('maxSize', String(query.maxSize));
  }
  if (page > 1) {
    params.set('page', String(page));
  }
  if (query.pageSize !== 20) {
    params.set('pageSize', String(query.pageSize));
  }
  const search = params.toString();
  return `${localizedPath(lang, path)}${search ? `?${search}` : ''}`;
}

export function compactJson(value: unknown, maxLength = Number.POSITIVE_INFINITY): string {
  if (value === undefined) {
    return '';
  }
  const text = JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

export function metadataOrderId(record: {
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}) {
  const orderId = record.metadata?.orderId;
  return typeof orderId === 'string' && orderId.length > 0
    ? orderId
    : record.idempotencyKey?.startsWith('order:')
      ? record.idempotencyKey.split(':')[1]
      : undefined;
}

export function orderBenefitSummary(
  order: RuntimeStoreCommercialOrder,
  commercial: AdminCommercialView
) {
  const sku = commercial.catalog.skus.find((item) => item.id === order.sku);
  const expectedEntitlements = [...new Set(sku?.entitlements ?? [])];
  const expectedCredits = sku?.credits ?? 0;
  const entitlements = commercial.entitlements.filter((grant) => {
    const grantOrderId = metadataOrderId(grant);
    return (
      grant.userId === order.userId &&
      (grantOrderId === order.id ||
        grant.idempotencyKey?.startsWith(`order:${order.id}:entitlement:`) ||
        grant.source === 'order')
    );
  });
  const credits = commercial.credits.filter((entry) => {
    const entryOrderId = metadataOrderId(entry);
    return (
      entry.userId === order.userId &&
      (entryOrderId === order.id ||
        entry.idempotencyKey?.startsWith(`order:${order.id}:credits:`) ||
        entry.reason === 'order.paid')
    );
  });
  const missingEntitlements =
    order.status === 'paid'
      ? expectedEntitlements.filter(
          (entitlement) =>
            !entitlements.some(
              (grant) => grant.entitlement === entitlement && grant.status === 'active'
            )
        )
      : [];
  const creditGranted = credits.reduce((sum, entry) => sum + Math.max(0, entry.amount), 0);
  const missingCredits =
    order.status === 'paid' && expectedCredits > creditGranted
      ? expectedCredits - creditGranted
      : 0;
  return {
    sku,
    expectedEntitlements,
    expectedCredits,
    entitlements,
    credits,
    missingEntitlements,
    missingCredits,
  };
}

export type RevenueOrderBenefitSummary = ReturnType<typeof orderBenefitSummary>;

export function orderContextLinks(lang: SupportedLanguage, order: RuntimeStoreCommercialOrder) {
  return [
    {
      label: adminInlineText(lang, 'User'),
      href: localizedPath(lang, `/admin/users?q=${encodeURIComponent(order.userId)}`),
    },
    {
      label: adminInlineText(lang, 'Revenue'),
      href: localizedPath(lang, `/admin/revenue?q=${encodeURIComponent(order.id)}`),
    },
    {
      label: adminInlineText(lang, 'Entitlements'),
      href: localizedPath(lang, `/admin/entitlements?q=${encodeURIComponent(order.userId)}`),
    },
    {
      label: adminInlineText(lang, 'Audit'),
      href: localizedPath(lang, `/admin/audit?q=${encodeURIComponent(order.id)}`),
    },
  ];
}
