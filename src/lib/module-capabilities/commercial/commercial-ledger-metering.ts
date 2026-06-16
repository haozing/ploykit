import {
  ModuleCreditsApi,
  type ModuleCreditsBalance,
  ModuleMeteringApi,
  ModuleUsageApi,
  type CommercialSubject,
} from '@ploykit/module-sdk';
import type { RuntimeStore } from '../../module-runtime/stores';
import { assertPositive, toMeteringAuthorization, toUsageRecord } from './commercial-ledger-utils';

interface CreateCommercialLedgerMeteringInput {
  store: RuntimeStore;
  scope: {
    productId: string;
    workspaceId?: string | null;
  };
  moduleId: string;
  credits: ModuleCreditsApi;
  creditBalance(input: {
    subject: CommercialSubject;
    unit?: string;
  }): Promise<ModuleCreditsBalance>;
}

export function createCommercialLedgerMetering({
  store,
  scope,
  moduleId,
  credits,
  creditBalance,
}: CreateCommercialLedgerMeteringInput): {
  usage: ModuleUsageApi;
  metering: ModuleMeteringApi;
} {
  const recordUsage: ModuleUsageApi['record'] = async (input) => {
    const record = await store.recordUsage({
      ...scope,
      moduleId,
      meter: input.meter,
      quantity: input.quantity,
      unit: input.unit,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    });
    return toUsageRecord(record);
  };

  const usage: ModuleUsageApi = {
    record: recordUsage,
    increment: recordUsage,
  };

  const metering: ModuleMeteringApi = {
    async authorize(input) {
      const record = await store.recordMetering({
        ...scope,
        moduleId,
        meter: input.meter,
        quantity: input.quantity,
        unit: input.unit,
        idempotencyKey: input.idempotencyKey,
      });
      return toMeteringAuthorization(record);
    },
    async commit(id) {
      return toMeteringAuthorization(await store.updateMeteringStatus(id, 'committed'));
    },
    async refund(id) {
      return toMeteringAuthorization(await store.updateMeteringStatus(id, 'refunded'));
    },
    async void(id) {
      return toMeteringAuthorization(await store.updateMeteringStatus(id, 'voided'));
    },
    async reconcile() {
      return {
        checked: (await store.listMetering({ productId: scope.productId })).length,
      };
    },
    async charge(input) {
      const quantity = input.quantity ?? 1;
      assertPositive(quantity, 'metering.charge.quantity');
      if (input.credits) {
        assertPositive(input.credits.amount, 'metering.charge.credits');
      }
      if (input.credits && !input.reservationId) {
        const currentBalance = await creditBalance({
          subject: input.subject,
          unit: input.credits.unit,
        });
        if (currentBalance.balance < input.credits.amount) {
          throw new Error('MODULE_CREDITS_INSUFFICIENT');
        }
      }
      const usageRecord = await store.recordUsage({
        ...scope,
        moduleId,
        meter: input.meter,
        quantity,
        unit: input.unit,
        idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:usage` : undefined,
        metadata: {
          ...(input.metadata ?? {}),
          subject: input.subject,
        },
      });
      const meteringRecord = await store.recordMetering({
        ...scope,
        moduleId,
        meter: input.meter,
        quantity,
        unit: input.unit,
        idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:metering` : undefined,
        metadata: {
          ...(input.metadata ?? {}),
          subject: input.subject,
          usageId: usageRecord.id,
        },
      });
      let balance;
      try {
        balance = input.credits
          ? input.reservationId
            ? await credits.commitReservation({
                reservationId: input.reservationId,
                finalAmount: input.credits.amount,
                idempotencyKey: input.idempotencyKey
                  ? `${input.idempotencyKey}:reservation`
                  : undefined,
                metadata: {
                  ...(input.metadata ?? {}),
                  meter: input.meter,
                  usageId: usageRecord.id,
                  meteringId: meteringRecord.id,
                },
              })
            : await credits.consume({
                subject: input.subject,
                amount: input.credits.amount,
                unit: input.credits.unit,
                reason: 'metering.charge',
                source: 'metering',
                sourceId: meteringRecord.id,
                idempotencyKey: input.idempotencyKey
                  ? `${input.idempotencyKey}:credits`
                  : undefined,
                metadata: {
                  ...(input.metadata ?? {}),
                  meter: input.meter,
                  usageId: usageRecord.id,
                  meteringId: meteringRecord.id,
                  reservationId: input.reservationId,
                },
              })
          : undefined;
      } catch (error) {
        await store.updateMeteringStatus(meteringRecord.id, 'voided', {
          chargeFailed: true,
          chargeFailure: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      await store.updateMeteringStatus(meteringRecord.id, 'committed', {
        chargedAt: new Date().toISOString(),
      });
      return {
        id: `charge_${meteringRecord.id}`,
        moduleId,
        subject: input.subject,
        meter: input.meter,
        quantity,
        unit: input.unit,
        credits: input.credits
          ? { amount: input.credits.amount, unit: input.credits.unit ?? 'credit' }
          : undefined,
        usageId: usageRecord.id,
        meteringId: meteringRecord.id,
        balance,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        createdAt: usageRecord.createdAt,
      };
    },
  };

  return {
    usage,
    metering,
  };
}
