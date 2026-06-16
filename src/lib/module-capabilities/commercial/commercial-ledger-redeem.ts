import {
  type CommercialSubject,
  ModuleRedeemCodeRecord,
  ModuleRedeemCodesApi,
} from '@ploykit/module-sdk';
import { randomUUID } from 'node:crypto';
import type { RuntimeStore } from '../../module-runtime/stores';
import {
  assertPositive,
  hashRedeemCode,
  isExpired,
  maskRedeemCode,
  redeemAttemptEmailMetadata,
  redeemBindStatus,
  redeemRedemptionMetadata,
  subjectFromCommercialInput,
  subjectFromStoredUserId,
  subjectToStoredUserId,
  toRedeemCodeRecord,
  toRedeemCodeRedemption,
} from './commercial-ledger-utils';

type RecordCreditInput = {
  subject?: CommercialSubject;
  userId?: string;
  amount: number;
  unit?: string;
  reason: string;
  source?: string;
  sourceId?: string;
  idempotencyKey?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
};

interface CreateCommercialLedgerRedeemInput {
  store: RuntimeStore;
  scope: {
    productId: string;
    workspaceId?: string | null;
  };
  now: () => Date;
  recordCredit(input: RecordCreditInput): Promise<unknown>;
}

export function createCommercialLedgerRedeem({
  store,
  scope,
  now,
  recordCredit,
}: CreateCommercialLedgerRedeemInput): {
  redeemCode(code: string, userId: string): Promise<{ ok: boolean; entitlement?: string }>;
  redeemCodes: ModuleRedeemCodesApi;
} {
  async function redeemCodeForSubject(input: {
    code: string;
    subject: CommercialSubject;
    email?: string;
  }): Promise<{ ok: boolean; entitlement?: string; reason?: string }> {
    const codeHash = hashRedeemCode(input.code);
    const userId = subjectToStoredUserId(input.subject);
    const redeemCodeRecord = await store.getRedeemCode(scope.productId, codeHash);
    const status =
      typeof redeemCodeRecord?.metadata.status === 'string'
        ? redeemCodeRecord.metadata.status
        : 'active';
    if (!redeemCodeRecord || status !== 'active' || isExpired(redeemCodeRecord.expiresAt, now)) {
      return { ok: false, reason: 'invalid_or_unavailable' };
    }

    const bindStatus = redeemBindStatus(redeemCodeRecord.metadata.bind, {
      subject: input.subject,
      email: input.email,
    });
    if (!bindStatus.ok) {
      return bindStatus;
    }

    const existingForUser = await store.listRedeemRedemptions({
      productId: scope.productId,
      code: codeHash,
      userId,
    });
    const redemptions = await store.listRedeemRedemptions({
      productId: scope.productId,
      code: codeHash,
    });
    if (existingForUser.length === 0 && redemptions.length >= redeemCodeRecord.maxRedemptions) {
      return { ok: false, reason: 'redemption_limit_exceeded' };
    }

    const idempotencyKey = `redeem:${codeHash}:${userId}`;
    await store.recordRedeemRedemption({
      ...scope,
      code: codeHash,
      userId,
      entitlement: redeemCodeRecord.entitlement,
      creditsAmount: redeemCodeRecord.creditsAmount,
      creditsUnit: redeemCodeRecord.creditsUnit,
      idempotencyKey,
      metadata: redeemRedemptionMetadata(redeemCodeRecord.metadata),
    });

    if (redeemCodeRecord.entitlement) {
      await store.grantEntitlement({
        ...scope,
        userId,
        entitlement: redeemCodeRecord.entitlement,
        source: 'redeem',
        idempotencyKey,
        metadata: { codeHash, maskedCode: redeemCodeRecord.metadata.maskedCode },
      });
    }
    if (redeemCodeRecord.creditsAmount) {
      await recordCredit({
        subject: input.subject,
        amount: redeemCodeRecord.creditsAmount,
        unit: redeemCodeRecord.creditsUnit,
        reason: 'redeem',
        idempotencyKey,
        expiresAt: redeemCodeRecord.expiresAt,
        metadata: { codeHash, maskedCode: redeemCodeRecord.metadata.maskedCode },
      });
    }

    return { ok: true, entitlement: redeemCodeRecord.entitlement };
  }

  async function redeemCode(
    code: string,
    userId: string
  ): Promise<{ ok: boolean; entitlement?: string }> {
    const result = await redeemCodeForSubject({
      code,
      subject: subjectFromStoredUserId(userId),
    });
    return { ok: result.ok, entitlement: result.entitlement };
  }

  const redeemCodes: ModuleRedeemCodesApi = {
    async createBatch(input) {
      if (!Number.isInteger(input.count) || input.count < 1 || input.count > 1000) {
        throw new Error('MODULE_REDEEM_CODES_INVALID_COUNT');
      }
      if (!Number.isInteger(input.maxRedemptions) || input.maxRedemptions < 1) {
        throw new Error('MODULE_REDEEM_CODES_INVALID_MAX_REDEMPTIONS');
      }
      if (input.credits) {
        assertPositive(input.credits.amount, 'redeemCodes.createBatch.credits');
      }
      const batchId = `redeem_batch_${randomUUID()}`;
      const codes: ModuleRedeemCodeRecord[] = [];
      for (let index = 0; index < input.count; index += 1) {
        const code = `${input.prefix ? `${input.prefix}_` : ''}${randomUUID().replace(/-/g, '').slice(0, 20)}`;
        const codeHash = hashRedeemCode(code);
        const record = await store.upsertRedeemCode({
          productId: scope.productId,
          code: codeHash,
          entitlement: input.entitlement,
          creditsAmount: input.credits?.amount,
          creditsUnit: input.credits?.unit ?? 'credit',
          maxRedemptions: input.maxRedemptions,
          expiresAt: input.expiresAt,
          metadata: {
            ...(input.metadata ?? {}),
            bind: input.bind,
            batchId,
            prefix: input.prefix,
            maskedCode: maskRedeemCode(code),
            status: 'active',
          },
        });
        codes.push({
          ...toRedeemCodeRecord(record, now),
          batchId,
          metadata: { ...record.metadata, rawCode: code },
        });
      }
      return { batchId, codes };
    },
    async redeem(input) {
      const subject = subjectFromCommercialInput(input);
      const userId = subjectToStoredUserId(subject);
      const codeHash = hashRedeemCode(input.code);
      const result = await redeemCodeForSubject({
        code: input.code,
        subject,
        email: input.email,
      });
      const [redemption] = await store.listRedeemRedemptions({
        productId: scope.productId,
        code: codeHash,
        userId,
      });
      await store.recordAudit({
        ...scope,
        actorId: userId,
        type: 'commercial.redeem_code.attempt',
        metadata: {
          codeHash,
          subject,
          ok: result.ok,
          reason: result.ok ? undefined : result.reason,
          redemptionId: redemption?.id,
          idempotencyKey: input.idempotencyKey,
          ...redeemAttemptEmailMetadata(input.email),
        },
      });
      return {
        ok: result.ok,
        entitlement: result.entitlement,
        credits: redemption?.creditsAmount
          ? { amount: redemption.creditsAmount, unit: redemption.creditsUnit }
          : undefined,
        redemption: redemption ? toRedeemCodeRedemption(redemption) : undefined,
      };
    },
    async freeze(input) {
      const records = await store.listRedeemCodes({
        productId: scope.productId,
        batchId: input.batchId,
        status: 'active',
      });
      let frozen = 0;
      for (const record of records) {
        if (isExpired(record.expiresAt, now)) {
          continue;
        }
        const redemptions = await store.listRedeemRedemptions({
          productId: scope.productId,
          code: record.code,
        });
        if (redemptions.length >= record.maxRedemptions) {
          continue;
        }
        await store.updateRedeemCodeStatus({
          productId: scope.productId,
          code: record.code,
          status: 'frozen',
          metadata: { reason: input.reason },
        });
        frozen += 1;
      }
      return { frozen };
    },
    async revoke(input) {
      const [, codeHash = input.codeId] = input.codeId.split(':');
      const record = await store.updateRedeemCodeStatus({
        productId: scope.productId,
        code: codeHash,
        status: 'revoked',
        metadata: { reason: input.reason },
      });
      return toRedeemCodeRecord(record, now);
    },
    async list(input = {}) {
      const records = await store.listRedeemCodes({
        productId: scope.productId,
        batchId: input.batchId,
        status: input.status === 'expired' ? undefined : input.status,
      });
      const mapped = records.map((record) => {
        const mapped = toRedeemCodeRecord(record, now);
        return {
          ...mapped,
          batchId:
            typeof record.metadata.batchId === 'string' ? record.metadata.batchId : undefined,
        };
      });
      return input.status ? mapped.filter((record) => record.status === input.status) : mapped;
    },
    async listRedemptions(input = {}) {
      const subject = subjectFromCommercialInput(input);
      const codeHash = input.codeId ? input.codeId.split(':').at(-1) : undefined;
      const records = await store.listRedeemRedemptions({
        productId: scope.productId,
        code: codeHash,
        userId: input.subject || input.userId ? subjectToStoredUserId(subject) : undefined,
      });
      return records.map(toRedeemCodeRedemption);
    },
  };

  return { redeemCode, redeemCodes };
}
