export type RouteSearchParams = Record<string, string | string[] | undefined>;

export interface AdminTableQuery {
  q?: string;
  status?: string;
  role?: string;
  type?: string;
  moduleId?: string;
  service?: string;
  workspace?: string;
  environment?: string;
  owner?: string;
  mime?: string;
  provider?: string;
  path?: string;
  minSize?: number;
  maxSize?: number;
  range?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  operation?: string;
  outcome?: string;
  matched?: number;
  processed?: number;
  failed?: number;
  skipped?: number;
  deadLettered?: number;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function numberParam(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function readAdminTableQuery(
  searchParams?: Promise<RouteSearchParams>
): Promise<AdminTableQuery> {
  const query = searchParams ? await searchParams : {};
  return {
    q: clean(first(query.q)),
    status: clean(first(query.status)),
    role: clean(first(query.role)),
    type: clean(first(query.type)),
    moduleId: clean(first(query.moduleId)),
    service: clean(first(query.service)),
    workspace: clean(first(query.workspace)),
    environment: clean(first(query.environment)),
    owner: clean(first(query.owner)),
    mime: clean(first(query.mime)),
    provider: clean(first(query.provider)),
    path: clean(first(query.path)),
    minSize: numberParam(first(query.minSize), 0),
    maxSize: numberParam(first(query.maxSize), 0),
    range: clean(first(query.range)),
    from: clean(first(query.from)),
    to: clean(first(query.to)),
    page: numberParam(first(query.page), 1),
    pageSize: Math.min(numberParam(first(query.pageSize), 20), 100),
    operation: clean(first(query.operation)),
    outcome: clean(first(query.outcome)),
    matched: numberParam(first(query.matched), 0),
    processed: numberParam(first(query.processed), 0),
    failed: numberParam(first(query.failed), 0),
    skipped: numberParam(first(query.skipped), 0),
    deadLettered: numberParam(first(query.deadLettered), 0),
  };
}
