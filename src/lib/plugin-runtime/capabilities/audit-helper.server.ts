import { randomUUID } from 'crypto';
import { getAuditPort, type AuditPort } from '@/lib/audit/audit-port.server';
import type { PluginCapabilityScope } from './guards.server';

export async function recordCapabilityAudit(
  scope: PluginCapabilityScope,
  action: string,
  details: Record<string, unknown> = {},
  auditPort: AuditPort = getAuditPort()
): Promise<void> {
  await auditPort.log({
    id: randomUUID(),
    type: 'admin.action',
    action,
    actorId: scope.user?.id ?? scope.contract.id,
    actorType: scope.user ? 'user' : 'plugin',
    targetId: scope.contract.id,
    targetType: 'plugin',
    details: {
      pluginId: scope.contract.id,
      requestId: scope.requestId,
      apiKeyId: scope.apiKey?.id,
      apiKeyScope: scope.apiKey?.scope,
      ...details,
    },
    timestamp: new Date(),
  });
}
