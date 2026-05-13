import { randomUUID } from 'crypto';
import { Permission, type PluginAudit } from '@ploykit/plugin-sdk';
import { getAuditPort, type AuditPort } from '@/lib/audit/audit-port.server';
import {
  assertJsonSerializable,
  assertPluginNamespaced,
  enforceCapabilityPermission,
  type PluginCapabilityScope,
} from './guards.server';

export interface CreatePluginAuditOptions {
  auditPort?: AuditPort;
}

export function createPluginAuditCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginAuditOptions = {}
): PluginAudit {
  const auditPort = options.auditPort ?? getAuditPort();

  return {
    async record(action, details = {}) {
      enforceCapabilityPermission(scope, Permission.AuditWrite, 'ctx.audit.record');
      assertPluginNamespaced(scope, action, 'Audit action');
      assertJsonSerializable(details, 'Audit details');

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
    },
  };
}
