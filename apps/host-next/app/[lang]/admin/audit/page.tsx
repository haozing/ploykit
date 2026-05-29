import { AdminAuditOperationsPage } from '@host/components/admin/AdminPages';
import { listAdminAudit } from '@host/lib/admin-api';
import { applyAdminAuditRetention, getAdminOperationsView } from '@host/lib/admin-operations';
import { createAdminAction } from '@host/lib/admin-action';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';
import { readAdminTableQuery, type RouteSearchParams } from '@host/lib/table-query';

function readOptionalString(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalNumber(formData: FormData, name: string): number | undefined {
  const value = readOptionalString(formData, name);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const applyAuditRetentionAction = createAdminAction({
  id: 'audit.applyRetention',
  parse: (formData) => {
    const mode = readOptionalString(formData, 'mode');
    const normalizedMode: 'delete' | 'archive' | 'hide-before-cutoff' =
      mode === 'delete' || mode === 'hide-before-cutoff' ? mode : 'archive';
    return {
      retentionDays: readOptionalNumber(formData, 'retentionDays'),
      mode: normalizedMode,
      reason: readOptionalString(formData, 'reason'),
    };
  },
  run: async ({ session, input }) => applyAdminAuditRetention(session, input),
  revalidate: () => ['/admin/audit'],
  audit: {
    metadata: ({ input }) => ({
      retentionDays: input.retentionDays,
      mode: input.mode,
      reason: input.reason,
    }),
  },
});

export default async function AdminAuditPage({
  params,
  searchParams,
}: {
  params: Promise<LanguageRouteParams>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const [lang] = await readLanguageAndRequireAdmin(params, '/admin/audit');
  const query = await readAdminTableQuery(searchParams);
  const [view, audit] = await Promise.all([
    getAdminOperationsView(),
    listAdminAudit({ limit: 200 }),
  ]);
  return (
    <AdminAuditOperationsPage
      lang={lang}
      snapshot={view.snapshot}
      auditLogs={audit.items}
      applyAuditRetentionAction={applyAuditRetentionAction}
      query={query}
    />
  );
}
