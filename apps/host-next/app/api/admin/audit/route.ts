import { apiOk, requireApiSession } from '@host/lib/api';
import { listAdminAudit, readAdminApiQuery } from '@host/lib/admin-api';
import { defaultProductId } from '@host/lib/default-scope';
import { getHostRuntimeStore } from '@host/lib/runtime-store';
import type { ModuleHostSession } from '@/lib/module-runtime';

function csvCell(value: unknown): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return `"${raw.replaceAll('"', '""')}"`;
}

function auditCsv(records: Awaited<ReturnType<typeof listAdminAudit>>['items']): string {
  const header = [
    'id',
    'type',
    'actorId',
    'productId',
    'workspaceId',
    'moduleId',
    'createdAt',
    'metadata',
    'category',
    'risk',
    'recordHash',
  ];
  const rows = records.map((record) =>
    [
      record.id,
      record.type,
      record.actorId ?? 'system',
      record.productId,
      record.workspaceId ?? '',
      record.moduleId ?? 'host',
      record.createdAt,
      record.metadata,
      record.integrity?.category ?? '',
      record.integrity?.risk ?? '',
      record.integrity?.recordHash ?? '',
    ]
      .map(csvCell)
      .join(',')
  );
  return [header.join(','), ...rows].join('\n');
}

async function recordAdminAuditAccess(input: {
  request: Request;
  session: ModuleHostSession;
  query: ReturnType<typeof readAdminApiQuery>;
  format: 'api' | 'csv' | 'json';
  result: Awaited<ReturnType<typeof listAdminAudit>>;
}) {
  try {
    const runtimeStore = await getHostRuntimeStore();
    await runtimeStore.store.recordAudit({
      productId: defaultProductId(input.session.productId),
      workspaceId: input.session.workspaceId ?? null,
      actorId: input.session.actorId ?? input.session.userId ?? input.session.user?.id,
      type: input.format === 'api' ? 'admin.audit.viewed' : 'admin.audit.exported',
      metadata: {
        format: input.format,
        q: input.query.q,
        status: input.query.status,
        type: input.query.type,
        range: input.query.range,
        from: input.query.from,
        to: input.query.to,
        limit: input.result.page.limit,
        offset: input.result.page.offset,
        resultCount: input.result.items.length,
        total: input.result.page.total,
        requestId: input.request.headers.get('x-request-id') ?? undefined,
        correlationId: input.request.headers.get('x-correlation-id') ?? undefined,
      },
    });
  } catch {
    // Audit export should not fail solely because the follow-up audit write failed.
  }
}

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'admin.audit', { admin: true });
  if (resolved instanceof Response) {
    return resolved;
  }
  const format = new URL(request.url).searchParams.get('format');
  const exportFormat = format === 'csv' || format === 'json' ? format : 'api';
  const query = readAdminApiQuery(request);
  const result = await listAdminAudit(query);
  await recordAdminAuditAccess({
    request,
    session: resolved.session,
    query,
    format: exportFormat,
    result,
  });
  if (format === 'csv') {
    return new Response(auditCsv(result.items), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="ploykit-admin-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }
  if (format === 'json') {
    return new Response(JSON.stringify(result, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="ploykit-admin-audit-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  }
  return apiOk(result);
}
