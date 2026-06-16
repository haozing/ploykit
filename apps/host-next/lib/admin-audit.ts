import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import { assertAdminSession } from './admin-session';
import { getHostRuntime } from './create-host';
import { DEFAULT_HOST_PRODUCT_ID } from './default-scope';

const DEMO_PRODUCT_ID = DEFAULT_HOST_PRODUCT_ID;

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), min), max) : fallback;
}

export async function applyAdminAuditRetention(
  session: ModuleHostSession,
  input: {
    retentionDays?: number;
    mode?: 'archive' | 'delete' | 'hide-before-cutoff';
    reason?: string;
  } = {}
) {
  assertAdminSession(session);
  const retentionDays = clampInteger(input.retentionDays, 90, 0, 3650);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const mode = input.mode ?? 'archive';
  const hostRuntime = await getHostRuntime();
  const auditLogs = await hostRuntime.runtimeStore.store.listAudit({
    productId: DEMO_PRODUCT_ID,
  });
  const matched = auditLogs.filter((record) => record.createdAt <= cutoff).length;
  return hostRuntime.runtimeStore.store.recordAudit({
    productId: DEMO_PRODUCT_ID,
    workspaceId: session.workspaceId ?? null,
    actorId: session.actorId ?? session.user?.id,
    type: 'admin.audit.retention_applied',
    metadata: {
      retentionDays,
      cutoff,
      mode,
      matched,
      reason: input.reason ?? 'Admin audit retention policy applied',
    },
  });
}
