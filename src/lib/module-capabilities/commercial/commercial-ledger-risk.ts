import { ModuleRiskApi } from '@ploykit/module-sdk';
import type { RuntimeStore } from '../../module-runtime/stores';

interface CreateCommercialLedgerRiskInput {
  store: RuntimeStore;
  scope: {
    productId: string;
    workspaceId?: string | null;
  };
  moduleId: string;
  now: () => Date;
}

export function createCommercialLedgerRisk({
  store,
  scope,
  moduleId,
  now,
}: CreateCommercialLedgerRiskInput): ModuleRiskApi {
  return {
    async record(input) {
      const event = await store.recordRiskEvent({
        ...scope,
        moduleId,
        subjectType: input.subject?.type,
        subjectId: input.subject?.id,
        type: input.type,
        severity: input.severity ?? 'medium',
        source: input.source,
        sourceId: input.sourceId,
        metadata: input.metadata ?? {},
      });
      await store.recordAudit({
        ...scope,
        moduleId,
        type: `risk.${event.type}`,
        metadata: {
          riskEventId: event.id,
          subject: input.subject,
          type: event.type,
          severity: event.severity,
          source: event.source,
          sourceId: event.sourceId,
        },
      });
      return {
        id: event.id,
        subject: input.subject,
        type: event.type,
        severity: event.severity,
        source: event.source,
        sourceId: event.sourceId,
        metadata: event.metadata,
        createdAt: event.createdAt,
      };
    },
    async block(input) {
      await store.upsertRiskBlock({
        ...scope,
        subjectType: input.subject.type,
        subjectId: input.subject.id,
        scope: input.scope,
        reason: input.reason,
        expiresAt: input.expiresAt,
        idempotencyKey: input.idempotencyKey,
      });
      await store.recordAudit({
        ...scope,
        moduleId,
        type: 'risk.subject.blocked',
        metadata: {
          subject: input.subject,
          riskScope: input.scope,
          reason: input.reason,
          expiresAt: input.expiresAt,
          idempotencyKey: input.idempotencyKey,
        },
      });
      return { blocked: true };
    },
    async check(input) {
      if (!input.subject) {
        return { ok: true };
      }
      const blocks = await store.listRiskBlocks({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
        subjectType: input.subject.type,
        subjectId: input.subject.id,
      });
      for (const block of blocks) {
        if (block.scope && input.scope && block.scope !== input.scope) {
          continue;
        }
        if (block.scope && !input.scope) {
          continue;
        }
        if (block.expiresAt && new Date(block.expiresAt).getTime() <= now().getTime()) {
          continue;
        }
        return { ok: false, reason: block.reason };
      }
      return { ok: true };
    },
  };
}
