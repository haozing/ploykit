import {
  type CommercialSubject,
  ModuleCreditsApi,
  ModuleCreditsBalance,
} from '@ploykit/module-sdk';
import type { RuntimeStore } from '../../module-runtime/stores';
import {
  assertNonNegative,
  assertPositive,
  subjectFromCommercialInput,
  subjectFromStoredUserId,
  subjectToStoredUserId,
  toCreditBalance,
  toCreditLedgerEntry,
  toCreditsReservation,
  userSubject,
} from './commercial-ledger-utils';

interface CreateCommercialLedgerCreditsInput {
  store: RuntimeStore;
  scope: {
    productId: string;
    workspaceId?: string | null;
  };
}

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

export function createCommercialLedgerCredits({
  store,
  scope,
}: CreateCommercialLedgerCreditsInput): {
  creditBalance(
    input: string | { subject: CommercialSubject; unit?: string },
    unit?: string
  ): Promise<ModuleCreditsBalance>;
  recordCredit(input: RecordCreditInput): Promise<ModuleCreditsBalance>;
  credits: ModuleCreditsApi;
} {
  async function creditBalance(
    input: string | { subject: CommercialSubject; unit?: string },
    unit = 'credit'
  ): Promise<ModuleCreditsBalance> {
    const subject = typeof input === 'string' ? userSubject(input) : input.subject;
    const resolvedUnit = typeof input === 'string' ? unit : (input.unit ?? unit);
    const balance = await store.getCreditBalance({
      productId: scope.productId,
      workspaceId: scope.workspaceId,
      userId: subjectToStoredUserId(subject),
      unit: resolvedUnit,
    });
    return toCreditBalance(balance);
  }

  async function recordCredit(input: RecordCreditInput): Promise<ModuleCreditsBalance> {
    const subject = subjectFromCommercialInput(input);
    const userId = subjectToStoredUserId(subject);
    await store.recordCreditLedger({
      ...scope,
      userId,
      amount: input.amount,
      unit: input.unit ?? 'credit',
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      expiresAt: input.expiresAt,
      metadata: {
        ...(input.metadata ?? {}),
        subject,
        source: input.source,
        sourceId: input.sourceId,
      },
    });
    return creditBalance({ subject, unit: input.unit });
  }

  const credits: ModuleCreditsApi = {
    balance: creditBalance,
    async grant(input) {
      assertPositive(input.amount, 'credits.grant');
      return recordCredit({ ...input, reason: 'grant' });
    },
    async consume(input) {
      assertPositive(input.amount, 'credits.consume');
      const subject = subjectFromCommercialInput(input);
      const userId = subjectToStoredUserId(subject);
      await store.consumeCreditLedger({
        ...scope,
        userId,
        amount: input.amount,
        unit: input.unit ?? 'credit',
        reason: input.reason ?? 'consume',
        idempotencyKey: input.idempotencyKey,
        metadata: {
          ...(input.metadata ?? {}),
          subject,
          source: input.source,
          sourceId: input.sourceId,
        },
      });
      return creditBalance({ subject, unit: input.unit });
    },
    async adjust(input) {
      return recordCredit({ ...input, reason: 'adjust' });
    },
    async refund(input) {
      assertPositive(input.amount, 'credits.refund');
      return recordCredit({ ...input, reason: 'refund' });
    },
    async reserve(input) {
      assertPositive(input.amount, 'credits.reserve');
      const subject = subjectFromCommercialInput(input);
      const currentBalance = await creditBalance({
        subject,
        unit: input.unit,
      });
      if (currentBalance.balance < input.amount) {
        throw new Error('MODULE_CREDITS_INSUFFICIENT');
      }
      const reservation = await store.createCreditReservation({
        ...scope,
        userId: subjectToStoredUserId(subject),
        amountReserved: input.amount,
        amountCommitted: 0,
        unit: input.unit ?? 'credit',
        status: 'reserved',
        reason: input.reason ?? 'reserve',
        source: input.source,
        sourceId: input.sourceId,
        idempotencyKey: input.idempotencyKey,
        metadata: {
          ...(input.metadata ?? {}),
          subject,
        },
      });
      try {
        await store.consumeCreditLedger({
          ...scope,
          userId: subjectToStoredUserId(subject),
          amount: input.amount,
          unit: input.unit ?? 'credit',
          reason: input.reason ?? 'reserve',
          idempotencyKey: input.idempotencyKey,
          metadata: {
            ...(input.metadata ?? {}),
            subject,
            source: input.source,
            sourceId: input.sourceId,
            reservationId: reservation.id,
          },
        });
      } catch (error) {
        await store.updateCreditReservation(reservation.id, {
          status: 'released',
          metadata: {
            reserveFailed: true,
            reserveFailure:
              error instanceof Error ? error.message : 'MODULE_CREDITS_RESERVE_FAILED',
          },
        });
        throw error;
      }
      return toCreditsReservation(reservation);
    },
    async commitReservation(input) {
      const reservation = await store.getCreditReservation(input.reservationId);
      if (!reservation) {
        throw new Error(`MODULE_CREDITS_RESERVATION_NOT_FOUND: ${input.reservationId}`);
      }
      if (reservation.status === 'committed') {
        return creditBalance({
          subject: subjectFromStoredUserId(reservation.userId),
          unit: reservation.unit,
        });
      }
      if (reservation.status === 'released') {
        throw new Error(`MODULE_CREDITS_RESERVATION_RELEASED: ${input.reservationId}`);
      }
      const finalAmount = input.finalAmount ?? reservation.amountReserved;
      assertNonNegative(finalAmount, 'credits.commitReservation.finalAmount');
      if (finalAmount < reservation.amountReserved) {
        await recordCredit({
          subject: subjectFromStoredUserId(reservation.userId),
          amount: reservation.amountReserved - finalAmount,
          unit: reservation.unit,
          reason: 'reserve.release',
          source: reservation.source,
          sourceId: reservation.sourceId,
          idempotencyKey: input.idempotencyKey,
          metadata: {
            ...(input.metadata ?? {}),
            reservationId: reservation.id,
          },
        });
      } else if (finalAmount > reservation.amountReserved) {
        await store.consumeCreditLedger({
          ...scope,
          userId: reservation.userId,
          amount: finalAmount - reservation.amountReserved,
          unit: reservation.unit,
          reason: 'reserve.overage',
          idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:overage` : undefined,
          metadata: {
            ...(input.metadata ?? {}),
            subject: subjectFromStoredUserId(reservation.userId),
            source: reservation.source,
            sourceId: reservation.sourceId,
            reservationId: reservation.id,
          },
        });
      }
      await store.updateCreditReservation(reservation.id, {
        amountCommitted: finalAmount,
        status: 'committed',
        metadata: input.metadata,
      });
      return creditBalance({
        subject: subjectFromStoredUserId(reservation.userId),
        unit: reservation.unit,
      });
    },
    async releaseReservation(input) {
      const reservation = await store.getCreditReservation(input.reservationId);
      if (!reservation) {
        throw new Error(`MODULE_CREDITS_RESERVATION_NOT_FOUND: ${input.reservationId}`);
      }
      if (reservation.status === 'committed') {
        return creditBalance({
          subject: subjectFromStoredUserId(reservation.userId),
          unit: reservation.unit,
        });
      }
      if (reservation.status !== 'released') {
        const releasable = reservation.amountReserved - reservation.amountCommitted;
        if (releasable > 0) {
          await recordCredit({
            subject: subjectFromStoredUserId(reservation.userId),
            amount: releasable,
            unit: reservation.unit,
            reason: input.reason ?? 'reserve.release',
            source: reservation.source,
            sourceId: reservation.sourceId,
            idempotencyKey: input.idempotencyKey,
            metadata: {
              ...(input.metadata ?? {}),
              reservationId: reservation.id,
            },
          });
        }
      }
      await store.updateCreditReservation(reservation.id, {
        status: 'released',
        metadata: input.metadata,
      });
      return creditBalance({
        subject: subjectFromStoredUserId(reservation.userId),
        unit: reservation.unit,
      });
    },
    async revokeBySource(input) {
      const entries = await store.listCreditLedger({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
      });
      const matching = entries.filter(
        (entry) =>
          entry.metadata.source === input.source && entry.metadata.sourceId === input.sourceId
      );
      for (const entry of matching) {
        if (entry.amount > 0) {
          await store.recordCreditLedger({
            ...scope,
            userId: entry.userId,
            amount: -entry.amount,
            unit: entry.unit,
            reason: input.reason ?? 'revoke',
            idempotencyKey: input.idempotencyKey
              ? `${input.idempotencyKey}:${entry.id}`
              : undefined,
            metadata: {
              ...(input.metadata ?? {}),
              source: input.source,
              sourceId: input.sourceId,
              revokedEntryId: entry.id,
            },
          });
        }
      }
      return { revoked: matching.length };
    },
    async listLedger(input = {}) {
      const subject = subjectFromCommercialInput(input);
      const records = await store.listCreditLedger({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
        userId: input.subject || input.userId ? subjectToStoredUserId(subject) : undefined,
        unit: input.unit,
        status:
          input.status === 'available' || input.status === 'pending' || input.status === 'expired'
            ? input.status
            : undefined,
      });
      return records
        .filter((record) => !input.source || record.metadata.source === input.source)
        .filter((record) => !input.sourceId || record.metadata.sourceId === input.sourceId)
        .map(toCreditLedgerEntry);
    },
  };

  return {
    creditBalance,
    recordCredit,
    credits,
  };
}
