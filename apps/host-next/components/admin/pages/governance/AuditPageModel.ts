import type { AdminTableQuery } from '@host/lib/table-query';
import type { AdminOperationsSnapshot, RuntimeStoreAuditRecord } from '@/lib/module-runtime';
import { cleanGovernanceTableQuery } from './GovernancePageModel';

export type AuditUsageRecord = AdminOperationsSnapshot['recent']['usageRecords'][number];

export const recordTypeOptions = [
  { value: 'audit', label: 'Audit' },
  { value: 'usage', label: 'Usage' },
] as const;

export function compactJson(value: unknown, maxLength = Number.POSITIVE_INFINITY): string {
  if (value === undefined) {
    return '';
  }
  const text = JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

export function matchesTextSearch(query: string, values: readonly unknown[]): boolean {
  if (query.length === 0) {
    return true;
  }
  const needle = query.toLowerCase();
  return values.some((value) =>
    String(value ?? '')
      .toLowerCase()
      .includes(needle)
  );
}

export function isFailureAudit(record: RuntimeStoreAuditRecord): boolean {
  return (
    record.integrity?.risk === 'medium' ||
    ['failed', 'denied', 'blocked', 'error'].some((token) =>
      compactJson(record.metadata).toLowerCase().includes(token)
    )
  );
}

export function isDangerousAudit(record: RuntimeStoreAuditRecord): boolean {
  return (
    record.integrity?.risk === 'high' ||
    ['delete', 'revoke', 'archive', 'discard', 'disable', 'retention'].some((token) =>
      record.type.includes(token)
    )
  );
}

export function auditActorType(record: RuntimeStoreAuditRecord) {
  const actor = (record.actorId ?? '').toLowerCase();
  if (!actor || actor === 'system') {
    return 'system' as const;
  }
  if (record.type.startsWith('admin.') || actor.startsWith('admin') || actor.includes('admin')) {
    return 'admin' as const;
  }
  if (actor.includes('worker') || record.type.includes('worker')) {
    return 'worker' as const;
  }
  if (actor.startsWith('module:') || record.moduleId) {
    return 'module' as const;
  }
  if (actor.includes('@') || actor.startsWith('user')) {
    return 'user' as const;
  }
  return 'unknown' as const;
}

function auditActionLabel(record: RuntimeStoreAuditRecord) {
  if (isFailureAudit(record)) {
    return 'failed';
  }
  if (record.type.includes('delete') || record.type.includes('discard')) {
    return 'destructive';
  }
  if (record.type.includes('revoke') || record.type.includes('disable')) {
    return 'access';
  }
  if (record.type.includes('archive') || record.type.includes('retention')) {
    return 'retention';
  }
  if (record.type.includes('billing') || record.type.includes('payment')) {
    return 'commerce';
  }
  if (record.integrity?.category === 'commercial') {
    return 'commerce';
  }
  return 'operation';
}

export function auditActionFamily(record: RuntimeStoreAuditRecord) {
  const label = auditActionLabel(record);
  if (label === 'failed') {
    return {
      label: 'Failure',
      detail: 'The record includes failed, denied, blocked, or error metadata.',
      status: 'failed',
      tone: 'danger' as const,
    };
  }
  if (label === 'destructive') {
    return {
      label: 'Destructive',
      detail: 'Delete or discard action; review impact and actor before cleanup.',
      status: 'sensitive',
      tone: 'warning' as const,
    };
  }
  if (label === 'access') {
    return {
      label: 'Access change',
      detail: 'Permission, entitlement, or disable/revoke action.',
      status: 'sensitive',
      tone: 'warning' as const,
    };
  }
  if (label === 'retention') {
    return {
      label: 'Retention',
      detail: 'Retention, archive, or evidence lifecycle policy action.',
      status: 'retention',
      tone: 'warning' as const,
    };
  }
  if (label === 'commerce') {
    return {
      label: 'Commerce',
      detail: 'Billing, payment, order, or settlement operation.',
      status: 'commerce',
      tone: 'neutral' as const,
    };
  }
  return {
    label: 'Operation',
    detail: 'Routine host, module, or product operation.',
    status: 'operation',
    tone: 'neutral' as const,
  };
}

function buildAuditExportHref(tableQuery: Required<AdminTableQuery>, format: 'csv' | 'json') {
  const params = new URLSearchParams();
  params.set('format', format);
  params.set('limit', '200');
  if (tableQuery.q) {
    params.set('q', tableQuery.q);
  }
  if (tableQuery.status) {
    params.set('status', tableQuery.status);
  }
  if (tableQuery.from) {
    params.set('from', tableQuery.from);
  }
  if (tableQuery.to) {
    params.set('to', tableQuery.to);
  }
  if (tableQuery.type && tableQuery.type !== 'usage' && tableQuery.type !== 'audit') {
    params.set('type', tableQuery.type);
  }
  return `/api/admin/audit?${params.toString()}`;
}

function auditStatusText(record: RuntimeStoreAuditRecord): string {
  return [
    compactJson(record.metadata),
    record.type,
    record.integrity?.category,
    record.integrity?.risk,
    record.integrity?.resourceType,
    record.integrity?.resourceId,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function buildAuditPageModel({
  snapshot,
  auditLogs: auditLogSource,
  query,
}: {
  snapshot: AdminOperationsSnapshot;
  auditLogs?: RuntimeStoreAuditRecord[];
  query?: AdminTableQuery;
}) {
  const tableQuery = cleanGovernanceTableQuery(query);
  const showAudit = tableQuery.type.length === 0 || tableQuery.type === 'audit';
  const showUsage = tableQuery.type.length === 0 || tableQuery.type === 'usage';
  const sourceAuditLogs = auditLogSource ?? snapshot.recent.auditLogs;
  const auditLogs = sourceAuditLogs.filter(
    (record) =>
      matchesTextSearch(tableQuery.q, [
        record.id,
        record.type,
        record.actorId ?? 'system',
        record.moduleId ?? 'host',
        record.productId,
        record.workspaceId ?? '',
        record.integrity?.category ?? '',
        record.integrity?.risk ?? '',
        record.integrity?.resourceType ?? '',
        record.integrity?.resourceId ?? '',
        record.integrity?.correlationId ?? '',
        record.integrity?.recordHash ?? '',
        compactJson(record.metadata, 160),
        record.createdAt,
      ]) &&
      (!tableQuery.status || auditStatusText(record).includes(tableQuery.status.toLowerCase())) &&
      (!tableQuery.type || record.type.includes(tableQuery.type) || tableQuery.type === 'audit')
  );
  const usageRecords = snapshot.recent.usageRecords.filter((record) =>
    matchesTextSearch(tableQuery.q, [
      record.id,
      record.meter,
      record.moduleId,
      record.quantity,
      record.unit ?? '',
      record.createdAt,
    ])
  );
  const visibleCount = (showAudit ? auditLogs.length : 0) + (showUsage ? usageRecords.length : 0);
  const totalCount = sourceAuditLogs.length + snapshot.recent.usageRecords.length;
  const pageSize = tableQuery.pageSize || 20;
  const auditTotalPages = Math.max(1, Math.ceil(auditLogs.length / pageSize));
  const auditPage = Math.min(Math.max(tableQuery.page || 1, 1), auditTotalPages);
  const pageStart = (auditPage - 1) * pageSize;
  const pagedAuditLogs = auditLogs.slice(pageStart, pageStart + pageSize);
  const actionStats = auditLogs.reduce<Record<string, number>>((acc, record) => {
    const action = record.type.split('.').slice(0, 3).join('.');
    acc[action] = (acc[action] ?? 0) + 1;
    return acc;
  }, {});
  const actorStats = auditLogs.reduce<Record<string, number>>((acc, record) => {
    const type = auditActorType(record);
    acc[type] = (acc[type] ?? 0) + 1;
    return acc;
  }, {});
  const familyStats = auditLogs.reduce<Record<string, number>>((acc, record) => {
    const family = auditActionFamily(record).label;
    acc[family] = (acc[family] ?? 0) + 1;
    return acc;
  }, {});
  const failureCount = auditLogs.filter(isFailureAudit).length;
  const dangerousActions = auditLogs.filter(isDangerousAudit).length;
  const focusAudit =
    pagedAuditLogs.find(isDangerousAudit) ??
    pagedAuditLogs.find(isFailureAudit) ??
    pagedAuditLogs[0] ??
    auditLogs[0] ??
    null;

  return {
    tableQuery,
    showAudit,
    showUsage,
    auditLogs,
    usageRecords,
    visibleCount,
    totalCount,
    exportCsvHref: buildAuditExportHref(tableQuery, 'csv'),
    exportJsonHref: buildAuditExportHref(tableQuery, 'json'),
    auditTotalPages,
    auditPage,
    pagedAuditLogs,
    actionStats,
    actorStats,
    familyStats,
    failureCount,
    dangerousActions,
    focusAudit,
  };
}
