import {
  type CommercialSubject,
  ModuleCreditsApi,
  ModuleCreditsBalance,
} from '@ploykit/module-sdk';
import type { RuntimeStore } from '../../module-runtime/stores';
import {
  assertNonNegativeIntegerAmount,
  assertPositiveIntegerAmount,
  assertIntegerAmount,
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
  const now = () => new Date();

  function isReservationExpired(reservation: { expiresAt?: string }): boolean {
    return Boolean(reservation.expiresAt && new Date(reservation.expiresAt).getTime() <= now().getTime());
  }

  async function releaseExpiredReservations(input: {
    subject: CommercialSubject;
    unit: string;
  }): Promise<void> {
    const userId = subjectToStoredUserId(input.subject);
    const expired = await store.listCreditReservations({
      productId: scope.productId,
      workspaceId: scope.workspaceId,
      userId,
      unit: input.unit,
      status: 'reserved',
      expiresBefore: now().toISOString(),
    });
    for (const reservation of expired) {
      const releasable = reservation.amountReserved - reservation.amountCommitted;
      if (releasable > 0) {
        await store.recordCreditLedger({
          ...scope,
          userId: reservation.userId,
          amount: releasable,
          unit: reservation.unit,
          reason: 'reserve.expired',
          idempotencyKey: `reserve:expired:${reservation.id}`,
          metadata: {
            subject: subjectFromStoredUserId(reservation.userId),
            source: reservation.source,
            sourceId: reservation.sourceId,
            reservationId: reservation.id,
            expiredAt: reservation.expiresAt,
          },
        });
      }
      await store.updateCreditReservation(reservation.id, {
        status: 'released',
        metadata: {
          expiredAt: reservation.expiresAt,
          releaseReason: 'reserve.expired',
        },
      });
    }
  }

  async function creditBalance(
    input: string | { subject: CommercialSubject; unit?: string },
    unit = 'credit'
  ): Promise<ModuleCreditsBalance> {
    const subject = typeof input === 'string' ? userSubject(input) : input.subject;
    const resolvedUnit = typeof input === 'string' ? unit : (input.unit ?? unit);
    await releaseExpiredReservations({ subject, unit: resolvedUnit });
    const balance = await store.getCreditBalance({
      productId: scope.productId,
      workspaceId: scope.workspaceId,
      userId: subjectToStoredUserId(subject),
      unit: resolvedUnit,
    });
    return toCreditBalance(balance);
  }

  async function recordCredit(input: RecordCreditInput): Promise<ModuleCreditsBalance> {
    assertIntegerAmount(input.amount, input.reason);
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
      assertPositiveIntegerAmount(input.amount, 'credits.grant');
      return recordCredit({ ...input, reason: 'grant' });
    },
    async consume(input) {
      assertPositiveIntegerAmount(input.amount, 'credits.consume');
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
      assertPositiveIntegerAmount(input.amount, 'credits.refund');
      return recordCredit({ ...input, reason: 'refund' });
    },
    async reserve(input) {
      assertPositiveIntegerAmount(input.amount, 'credits.reserve');
      const subject = subjectFromCommercialInput(input);
      await releaseExpiredReservations({ subject, unit: input.unit ?? 'credit' });
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
        expiresAt: input.expiresAt,
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
      if (isReservationExpired(reservation)) {
        await releaseExpiredReservations({
          subject: subjectFromStoredUserId(reservation.userId),
          unit: reservation.unit,
        });
        throw new Error(`MODULE_CREDITS_RESERVATION_EXPIRED: ${input.reservationId}`);
      }
      const finalAmount = input.finalAmount ?? reservation.amountReserved;
      assertNonNegativeIntegerAmount(finalAmount, 'credits.commitReservation.finalAmount');
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
    async refundRevoke(input) {
      if (!input.grantLedgerId && (!input.source || !input.sourceId)) {
        throw new Error('MODULE_CREDITS_REFUND_REVOKE_TARGET_REQUIRED');
      }
      if (input.amount !== undefined) {
        assertPositiveIntegerAmount(input.amount, 'credits.refundRevoke.amount');
      }
      const requestedSubject =
        input.subject || input.userId ? subjectFromCommercialInput(input) : undefined;
      const requestedUserId = requestedSubject ? subjectToStoredUserId(requestedSubject) : undefined;
      const entries = await store.listCreditLedger({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
        userId: requestedUserId,
        unit: input.unit,
      });
      const replay = input.idempotencyKey
        ? entries.find(
            (entry) =>
              entry.idempotencyKey === input.idempotencyKey &&
              entry.reason.includes('refund_revoke')
          )
        : undefined;
      if (replay) {
        const subject = subjectFromStoredUserId(replay.userId);
        return {
          revoked: Math.abs(replay.amount),
          unrecovered: Number(replay.metadata.unrecoveredAmount ?? 0),
          balance: await creditBalance({ subject, unit: replay.unit }),
          relatedLedgerIds: Array.isArray(replay.metadata.relatedLedgerIds)
            ? (replay.metadata.relatedLedgerIds.filter(
                (value): value is string => typeof value === 'string'
              ) as readonly string[])
            : [],
        };
      }

      const matching = entries.filter((entry) => {
        if (entry.amount <= 0 || entry.status !== 'available') {
          return false;
        }
        if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= now().getTime()) {
          return false;
        }
        if (input.grantLedgerId) {
          return entry.id === input.grantLedgerId;
        }
        return entry.metadata.source === input.source && entry.metadata.sourceId === input.sourceId;
      });
      const first = matching[0];
      if (!first) {
        if (!requestedSubject) {
          throw new Error('MODULE_CREDITS_REFUND_REVOKE_TARGET_NOT_FOUND');
        }
        const balance = await creditBalance({ subject: requestedSubject, unit: input.unit });
        return {
          revoked: 0,
          unrecovered: input.amount ?? 0,
          balance,
          relatedLedgerIds: [],
        };
      }

      const subject = subjectFromStoredUserId(first.userId);
      const unit = input.unit ?? first.unit;
      await releaseExpiredReservations({ subject, unit });
      const relatedLedgerIds = matching.map((entry) => entry.id);
      const eligibleAmount = matching.reduce((sum, entry) => sum + entry.amount, 0);
      const targetAmount = input.amount ?? eligibleAmount;
      const cappedTargetAmount = Math.min(targetAmount, eligibleAmount);
      const currentBalance = await creditBalance({ subject, unit });
      const revoked = Math.min(cappedTargetAmount, Math.max(0, currentBalance.balance));
      const unrecovered = targetAmount - revoked;

      if (revoked > 0) {
        await store.consumeCreditLedger({
          ...scope,
          userId: first.userId,
          amount: revoked,
          unit,
          reason: input.reason ?? 'refund_revoke',
          idempotencyKey: input.idempotencyKey,
          metadata: {
            ...(input.metadata ?? {}),
            subject,
            source: input.source ?? first.metadata.source,
            sourceId: input.sourceId ?? first.metadata.sourceId,
            relatedLedgerId: relatedLedgerIds[0],
            relatedLedgerIds,
            refundRevoke: true,
            requestedAmount: targetAmount,
            eligibleAmount,
            unrecoveredAmount: unrecovered,
          },
        });
      }

      return {
        revoked,
        unrecovered,
        balance: await creditBalance({ subject, unit }),
        relatedLedgerIds,
      };
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
