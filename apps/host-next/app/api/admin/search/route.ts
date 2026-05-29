import { createHash } from 'node:crypto';
import type { ModuleHostSession } from '@/lib/module-runtime';
import { apiOk, requireApiSession } from '@host/lib/api';
import { readAdminApiQuery, searchAdmin } from '@host/lib/admin-api';
import type { AdminSearchResult } from '@host/lib/admin-search-model';
import { defaultProductId } from '@host/lib/default-scope';
import { getHostRuntimeStore } from '@host/lib/runtime-store';

type AdminSearchResponse = {
  items: readonly AdminSearchResult[];
  page: {
    total: number;
    offset: number;
    limit: number;
  };
};

function queryHash(query: string | undefined): string | undefined {
  const normalized = query?.trim().toLowerCase();
  return normalized
    ? `sha256:${createHash('sha256').update(normalized).digest('hex')}`
    : undefined;
}

function countResultTypes(items: readonly AdminSearchResult[]) {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item.type] = (acc[item.type] ?? 0) + 1;
    return acc;
  }, {});
}

async function recordAdminSearchAudit(input: {
  request: Request;
  session: ModuleHostSession;
  query: ReturnType<typeof readAdminApiQuery>;
  result: AdminSearchResponse;
}) {
  try {
    const runtimeStore = await getHostRuntimeStore();
    await runtimeStore.store.recordAudit({
      productId: defaultProductId(input.session.productId),
      workspaceId: input.session.workspaceId ?? null,
      actorId: input.session.actorId ?? input.session.userId ?? input.session.user?.id,
      type: 'admin.search.queried',
      metadata: {
        source: 'api',
        qLength: input.query.q?.trim().length ?? 0,
        qHash: queryHash(input.query.q),
        resultType: input.query.type ?? 'all',
        limit: input.result.page.limit,
        offset: input.result.page.offset,
        resultCount: input.result.items.length,
        total: input.result.page.total,
        categories: countResultTypes(input.result.items),
        requestId: input.session.requestId ?? input.request.headers.get('x-request-id') ?? undefined,
        correlationId: input.request.headers.get('x-correlation-id') ?? undefined,
      },
    });
  } catch {
    // Search availability should not depend on observability storage.
  }
}

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'admin.search', { admin: true });
  if (resolved instanceof Response) {
    return resolved;
  }
  const query = readAdminApiQuery(request);
  const result = await searchAdmin(query, { session: resolved.session });
  await recordAdminSearchAudit({ request, session: resolved.session, query, result });
  return apiOk(result);
}
