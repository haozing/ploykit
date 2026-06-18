import { createHash, randomUUID } from 'node:crypto';
import type {
  CommercialSubject,
  ModuleBillingApi,
  ModuleBillingPlan,
  ModuleCommerceApi,
  ModuleCommerceCheckout,
  ModuleCreditsApi,
  ModuleCreditsBalance,
  ModuleCreditsLedgerEntry,
  ModuleCreditsReservation,
  ModuleEntitlementGrant,
  ModuleEntitlementsApi,
  ModuleMeteringApi,
  ModuleMeteringAuthorization,
  ModuleMeteringCharge,
  ModuleRedeemCodeRecord,
  ModuleRedeemCodeRedemption,
  ModuleRedeemCodesApi,
  ModuleRiskApi,
  ModuleUsageApi,
  ModuleUsageRecord,
} from '@ploykit/module-sdk';
import { normalizeCreditAmount } from './commercial-ledger-utils';

export interface ModuleCommercialRuntime {
  forModule(moduleId: string): {
    usage: ModuleUsageApi;
    metering: ModuleMeteringApi;
    credits: ModuleCreditsApi;
    billing: ModuleBillingApi;
    entitlements: ModuleEntitlementsApi;
    commerce: ModuleCommerceApi;
    redeemCodes: ModuleRedeemCodesApi;
    risk: ModuleRiskApi;
  };
  listUsage(): ModuleUsageRecord[];
  listMetering(): ModuleMeteringAuthorization[];
  listCheckouts(): ModuleCommerceCheckout[];
}

export interface CreateInMemoryModuleCommercialRuntimeOptions {
  now?: () => Date;
  plansByUser?: Record<string, ModuleBillingPlan>;
  redeemCodes?: Record<string, string>;
}

function toIso(now: () => Date): string {
  return now().toISOString();
}

function balanceKey(userId: string, unit = 'credit'): string {
  return `${userId}:${unit}`;
}

function userSubject(userId: string): CommercialSubject {
  return { type: 'user', id: userId };
}

function subjectToUserId(subject: CommercialSubject): string {
  return subject.type === 'user' ? subject.id : `${subject.type}:${subject.id}`;
}

function subjectFromUserId(userId: string): CommercialSubject {
  const [type, ...idParts] = userId.split(':');
  if (
    (type === 'workspace' || type === 'organization' || type === 'apiKey') &&
    idParts.length > 0
  ) {
    return { type, id: idParts.join(':') };
  }

  return userSubject(userId);
}

function subjectFromInput(input: { subject?: CommercialSubject; userId?: string }): CommercialSubject {
  return input.subject ?? userSubject(input.userId ?? 'test-user');
}

function hashRedeemCode(code: string): string {
  return createHash('sha256').update(code.trim()).digest('hex');
}

function maskRedeemCode(code: string): string {
  return code.length > 8 ? `${code.slice(0, 4)}****${code.slice(-4)}` : `${code.slice(0, 2)}****`;
}

function assertPositive(amount: number, operation: string): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`MODULE_COMMERCIAL_INVALID_AMOUNT: ${operation}`);
  }
}

function assertNonNegative(amount: number, operation: string): void {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`MODULE_COMMERCIAL_INVALID_AMOUNT: ${operation}`);
  }
}

function assertIntegerAmount(amount: number, operation: string): void {
  if (!Number.isSafeInteger(amount)) {
    throw new Error(`MODULE_COMMERCIAL_INVALID_AMOUNT: ${operation} must be a safe integer`);
  }
}

function assertPositiveIntegerAmount(amount: number, operation: string): void {
  assertPositive(amount, operation);
  assertIntegerAmount(amount, operation);
}

function assertNonNegativeIntegerAmount(amount: number, operation: string): void {
  assertNonNegative(amount, operation);
  assertIntegerAmount(amount, operation);
}

function creditLedgerDirection(input: {
  amount: number;
  reason: string;
  multiplier: 1 | -1;
}): ModuleCreditsLedgerEntry['direction'] {
  if (input.reason.includes('refund_revoke')) {
    return 'revoke';
  }
  if (input.reason.includes('expired')) {
    return 'release';
  }
  if (input.reason.includes('release')) {
    return 'release';
  }
  if (input.reason.includes('overage')) {
    return input.amount * input.multiplier < 0 ? 'consume' : 'grant';
  }
  if (input.reason.includes('refund')) {
    return 'refund';
  }
  if (input.reason.includes('adjust')) {
    return 'adjust';
  }
  if (input.reason.includes('revoke')) {
    return 'revoke';
  }
  if (input.reason.includes('reserve')) {
    return 'reserve';
  }
  return input.multiplier === -1 ? 'consume' : 'grant';
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizedEmail(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : undefined;
}

function sameSubject(left: CommercialSubject, right: CommercialSubject): boolean {
  return left.type === right.type && left.id === right.id;
}

function subjectFromMetadata(value: unknown): CommercialSubject | null {
  const record = metadataRecord(value);
  const type = record.type;
  const id = record.id;
  if (
    (type === 'user' || type === 'workspace' || type === 'organization' || type === 'apiKey') &&
    typeof id === 'string' &&
    id.length > 0
  ) {
    return { type, id };
  }
  return null;
}

function redeemBindAllows(
  bind: unknown,
  input: { subject: CommercialSubject; email?: string }
): boolean {
  const record = metadataRecord(bind);
  const expectedEmail = normalizedEmail(record.email);
  if (expectedEmail && normalizedEmail(input.email) !== expectedEmail) {
    return false;
  }
  const expectedSubject = subjectFromMetadata(record.subject);
  if (expectedSubject && !sameSubject(expectedSubject, input.subject)) {
    return false;
  }
  const subjectType = record.subjectType;
  const subjectId = record.subjectId;
  if (
    (subjectType === 'user' ||
      subjectType === 'workspace' ||
      subjectType === 'organization' ||
      subjectType === 'apiKey') &&
    typeof subjectId === 'string' &&
    !sameSubject({ type: subjectType, id: subjectId }, input.subject)
  ) {
    return false;
  }
  if (
    typeof record.userId === 'string' &&
    (input.subject.type !== 'user' || input.subject.id !== record.userId)
  ) {
    return false;
  }
  if (
    typeof record.workspaceId === 'string' &&
    (input.subject.type !== 'workspace' || input.subject.id !== record.workspaceId)
  ) {
    return false;
  }
  if (
    typeof record.organizationId === 'string' &&
    (input.subject.type !== 'organization' || input.subject.id !== record.organizationId)
  ) {
    return false;
  }
  return true;
}

export function createInMemoryModuleCommercialRuntime(
  options: CreateInMemoryModuleCommercialRuntimeOptions = {}
): ModuleCommercialRuntime {
  const now = options.now ?? (() => new Date());
  const usageRecords = new Map<string, ModuleUsageRecord>();
  const usageIdempotency = new Map<string, string>();
  const metering = new Map<string, ModuleMeteringAuthorization>();
  const meteringIdempotency = new Map<string, string>();
  const chargeIdempotency = new Map<string, ModuleMeteringCharge>();
  const creditBalances = new Map<string, ModuleCreditsBalance>();
  const creditIdempotency = new Map<string, ModuleCreditsBalance>();
  const creditLedger: ModuleCreditsLedgerEntry[] = [];
  const reservations = new Map<string, ModuleCreditsReservation>();
  const entitlementGrants = new Map<string, ModuleEntitlementGrant>();
  const checkouts = new Map<string, ModuleCommerceCheckout>();
  const checkoutIdempotency = new Map<string, string>();
  const redeemCodeRecords = new Map<string, ModuleRedeemCodeRecord>();
  const redeemCodeRawToHash = new Map<string, string>();
  const redemptions: ModuleRedeemCodeRedemption[] = [];
  const riskBlocks = new Map<string, { reason: string; expiresAt?: string }>();

  function currentBalance(userId: string, unit = 'credit'): ModuleCreditsBalance {
    const subject = subjectFromUserId(userId);
    return (
      creditBalances.get(balanceKey(userId, unit)) ?? {
        subject,
        userId: subject.type === 'user' ? subject.id : userId,
        unit,
        balance: 0,
      }
    );
  }

  function setBalance(balance: ModuleCreditsBalance): ModuleCreditsBalance {
    const subject = balance.subject ?? userSubject(balance.userId ?? 'test-user');
    creditBalances.set(balanceKey(subjectToUserId(subject), balance.unit), balance);
    return { ...balance };
  }

  function adjustBalance(input: {
    subject?: CommercialSubject;
    userId?: string;
    amount: number;
    unit?: string;
    idempotencyKey?: string;
    multiplier: 1 | -1;
    reason?: string;
    source?: string;
    sourceId?: string;
    metadata?: Record<string, unknown>;
  }): ModuleCreditsBalance {
    assertIntegerAmount(input.amount, input.reason ?? 'credits.adjust');
    if (input.idempotencyKey) {
      const existing = creditIdempotency.get(input.idempotencyKey);
      if (existing) {
        return { ...existing };
      }
    }

    const unit = input.unit ?? 'credit';
    const subject = subjectFromInput(input);
    const storedUserId = subjectToUserId(subject);
    const current = currentBalance(storedUserId, unit);
    const reason = input.reason ?? (input.multiplier === -1 ? 'consume' : 'grant');
    const next = setBalance({
      ...current,
      balance: current.balance + input.amount * input.multiplier,
    });
    creditLedger.push({
      id: `credit_${randomUUID()}`,
      subject,
      amount: input.amount * input.multiplier,
      unit,
      direction: creditLedgerDirection({ amount: input.amount, reason, multiplier: input.multiplier }),
      status: 'available',
      reason,
      source: input.source,
      sourceId: input.sourceId,
      reservationId:
        typeof input.metadata?.reservationId === 'string' ? input.metadata.reservationId : undefined,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata ?? {},
      createdAt: toIso(now),
    });
    if (input.idempotencyKey) {
      creditIdempotency.set(input.idempotencyKey, next);
    }
    return next;
  }

  function forModule(moduleId: string) {
    const recordUsage: ModuleUsageApi['record'] = async (input) => {
      if (input.idempotencyKey) {
        const existingId = usageIdempotency.get(input.idempotencyKey);
        if (existingId) {
          return { ...(usageRecords.get(existingId) as ModuleUsageRecord) };
        }
      }

      const record: ModuleUsageRecord = {
        id: `usage_${randomUUID()}`,
        moduleId,
        meter: input.meter,
        quantity: input.quantity ?? 1,
        unit: input.unit,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        createdAt: toIso(now),
      };
      usageRecords.set(record.id, record);
      if (input.idempotencyKey) {
        usageIdempotency.set(input.idempotencyKey, record.id);
      }
      return { ...record, metadata: { ...record.metadata } };
    };
    const usage: ModuleUsageApi = {
      record: recordUsage,
      increment: recordUsage,
    };

    const meteringApi: ModuleMeteringApi = {
      async authorize(input) {
        if (input.idempotencyKey) {
          const existingId = meteringIdempotency.get(input.idempotencyKey);
          if (existingId) {
            return { ...(metering.get(existingId) as ModuleMeteringAuthorization) };
          }
        }

        const timestamp = toIso(now);
        const authorization: ModuleMeteringAuthorization = {
          id: `meter_${randomUUID()}`,
          moduleId,
          meter: input.meter,
          quantity: input.quantity ?? 1,
          unit: input.unit,
          status: 'authorized',
          idempotencyKey: input.idempotencyKey,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        metering.set(authorization.id, authorization);
        if (input.idempotencyKey) {
          meteringIdempotency.set(input.idempotencyKey, authorization.id);
        }
        return { ...authorization };
      },
      async commit(id) {
        return updateMetering(id, 'committed');
      },
      async refund(id) {
        return updateMetering(id, 'refunded');
      },
      async void(id) {
        return updateMetering(id, 'voided');
      },
      async reconcile() {
        return { checked: metering.size };
      },
      async charge(input) {
        if (input.idempotencyKey) {
          const existing = chargeIdempotency.get(input.idempotencyKey);
          if (existing) {
            return { ...existing, metadata: { ...existing.metadata } };
          }
        }
        const quantity = input.quantity ?? 1;
        assertPositive(quantity, 'metering.charge.quantity');
        if (input.credits) {
          assertPositiveIntegerAmount(input.credits.amount, 'metering.charge.credits');
        }
        if (input.credits && !input.reservationId) {
          const current = currentBalance(
            subjectToUserId(input.subject),
            input.credits.unit ?? 'credit'
          );
          if (current.balance < input.credits.amount) {
            throw new Error('MODULE_CREDITS_INSUFFICIENT');
          }
        }
        const usage = await recordUsage({
          meter: input.meter,
          quantity,
          unit: input.unit,
          idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:usage` : undefined,
          metadata: { ...(input.metadata ?? {}), subject: input.subject },
        });
        const authorization = await meteringApi.authorize({
          meter: input.meter,
          quantity,
          unit: input.unit,
          idempotencyKey: input.idempotencyKey
            ? `${input.idempotencyKey}:metering`
            : undefined,
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
                  metadata: input.metadata,
                })
              : await credits.consume({
                  subject: input.subject,
                  amount: input.credits.amount,
                  unit: input.credits.unit,
                  reason: 'metering.charge',
                  source: 'metering',
                  sourceId: authorization.id,
                  idempotencyKey: input.idempotencyKey
                    ? `${input.idempotencyKey}:credits`
                    : undefined,
                  metadata: input.metadata,
                })
            : undefined;
          await meteringApi.commit(authorization.id);
        } catch (error) {
          await meteringApi.void(authorization.id);
          throw error;
        }
        const charge: ModuleMeteringCharge = {
          id: `charge_${authorization.id}`,
          moduleId,
          subject: input.subject,
          meter: input.meter,
          quantity,
          unit: input.unit,
          credits: input.credits
            ? { amount: input.credits.amount, unit: input.credits.unit ?? 'credit' }
            : undefined,
          usageId: usage.id,
          meteringId: authorization.id,
          balance,
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata ?? {},
          createdAt: usage.createdAt,
        };
        if (input.idempotencyKey) {
          chargeIdempotency.set(input.idempotencyKey, charge);
        }
        return { ...charge, metadata: { ...charge.metadata } };
      },
    };

    function isReservationExpired(reservation: ModuleCreditsReservation): boolean {
      return Boolean(
        reservation.expiresAt && new Date(reservation.expiresAt).getTime() <= now().getTime()
      );
    }

    function releaseExpiredReservations(subject: CommercialSubject, unit: string): void {
      for (const reservation of reservations.values()) {
        if (
          reservation.status !== 'reserved' ||
          reservation.unit !== unit ||
          subjectToUserId(reservation.subject) !== subjectToUserId(subject) ||
          !isReservationExpired(reservation)
        ) {
          continue;
        }
        const releasable = reservation.amountReserved - reservation.amountCommitted;
        if (releasable > 0) {
          adjustBalance({
            subject: reservation.subject,
            amount: releasable,
            unit: reservation.unit,
            multiplier: 1,
            reason: 'reserve.expired',
            idempotencyKey: `reserve:expired:${reservation.id}`,
            metadata: { reservationId: reservation.id, expiredAt: reservation.expiresAt },
          });
        }
        reservations.set(reservation.id, {
          ...reservation,
          status: 'released',
          metadata: {
            ...reservation.metadata,
            expiredAt: reservation.expiresAt,
            releaseReason: 'reserve.expired',
          },
          updatedAt: toIso(now),
        });
      }
    }

    const credits: ModuleCreditsApi = {
      async balance(input, unit = 'credit') {
        const subject = typeof input === 'string' ? userSubject(input) : input.subject;
        const resolvedUnit = typeof input === 'string' ? unit : (input.unit ?? unit);
        releaseExpiredReservations(subject, resolvedUnit);
        return { ...currentBalance(subjectToUserId(subject), resolvedUnit) };
      },
      async grant(input) {
        const amount = normalizeCreditAmount(input.amount, 'credits.grant');
        assertPositiveIntegerAmount(amount, 'credits.grant');
        return adjustBalance({ ...input, amount, multiplier: 1, reason: input.reason ?? 'grant' });
      },
      async consume(input) {
        const amount = normalizeCreditAmount(input.amount, 'credits.consume');
        assertPositiveIntegerAmount(amount, 'credits.consume');
        const subject = subjectFromInput(input);
        const current = currentBalance(subjectToUserId(subject), input.unit ?? 'credit');
        if (current.balance < amount) {
          throw new Error('MODULE_CREDITS_INSUFFICIENT');
        }
        return adjustBalance({
          ...input,
          amount,
          subject,
          multiplier: -1,
          reason: input.reason ?? 'consume',
        });
      },
      async adjust(input) {
        const amount = normalizeCreditAmount(input.amount, 'credits.adjust');
        return adjustBalance({ ...input, amount, multiplier: 1, reason: input.reason ?? 'adjust' });
      },
      async refund(input) {
        const amount = normalizeCreditAmount(input.amount, 'credits.refund');
        assertPositiveIntegerAmount(amount, 'credits.refund');
        return adjustBalance({ ...input, amount, multiplier: 1, reason: input.reason ?? 'refund' });
      },
      async reserve(input) {
        const amount = normalizeCreditAmount(input.amount, 'credits.reserve');
        assertPositiveIntegerAmount(amount, 'credits.reserve');
        if (input.idempotencyKey) {
          const existing = [...reservations.values()].find(
            (reservation) => reservation.idempotencyKey === input.idempotencyKey
          );
          if (existing) {
            return { ...existing, metadata: { ...existing.metadata } };
          }
        }
        const subject = subjectFromInput(input);
        releaseExpiredReservations(subject, input.unit ?? 'credit');
        const current = currentBalance(subjectToUserId(subject), input.unit ?? 'credit');
        if (current.balance < amount) {
          throw new Error('MODULE_CREDITS_INSUFFICIENT');
        }
        const reservation: ModuleCreditsReservation = {
          id: `reservation_${randomUUID()}`,
          subject,
          amountReserved: amount,
          amountCommitted: 0,
          unit: input.unit ?? 'credit',
          status: 'reserved',
          source: input.source,
          sourceId: input.sourceId,
          idempotencyKey: input.idempotencyKey,
          expiresAt: input.expiresAt,
          metadata: input.metadata ?? {},
          createdAt: toIso(now),
          updatedAt: toIso(now),
        };
        reservations.set(reservation.id, reservation);
        adjustBalance({
          ...input,
          amount,
          subject,
          multiplier: -1,
          reason: input.reason ?? 'reserve',
          metadata: { ...(input.metadata ?? {}), reservationId: reservation.id },
        });
        return reservation;
      },
      async commitReservation(input) {
        const reservation = reservations.get(input.reservationId);
        if (!reservation) {
          throw new Error(`MODULE_CREDITS_RESERVATION_NOT_FOUND: ${input.reservationId}`);
        }
        if (reservation.status === 'committed') {
          return currentBalance(subjectToUserId(reservation.subject), reservation.unit);
        }
        if (reservation.status === 'released') {
          throw new Error(`MODULE_CREDITS_RESERVATION_RELEASED: ${input.reservationId}`);
        }
        if (isReservationExpired(reservation)) {
          releaseExpiredReservations(reservation.subject, reservation.unit);
          throw new Error(`MODULE_CREDITS_RESERVATION_EXPIRED: ${input.reservationId}`);
        }
        const finalAmount =
          input.finalAmount === undefined
            ? reservation.amountReserved
            : normalizeCreditAmount(input.finalAmount, 'credits.commitReservation.finalAmount');
        assertNonNegativeIntegerAmount(finalAmount, 'credits.commitReservation.finalAmount');
        if (finalAmount < reservation.amountReserved) {
          adjustBalance({
            subject: reservation.subject,
            amount: reservation.amountReserved - finalAmount,
            unit: reservation.unit,
            multiplier: 1,
            reason: 'reserve.release',
            metadata: { ...(input.metadata ?? {}), reservationId: reservation.id },
          });
        } else if (finalAmount > reservation.amountReserved) {
          const current = currentBalance(subjectToUserId(reservation.subject), reservation.unit);
          const overage = finalAmount - reservation.amountReserved;
          if (current.balance < overage) {
            throw new Error('MODULE_CREDITS_INSUFFICIENT');
          }
          adjustBalance({
            subject: reservation.subject,
            amount: overage,
            unit: reservation.unit,
            multiplier: -1,
            reason: 'reserve.overage',
            metadata: { ...(input.metadata ?? {}), reservationId: reservation.id },
          });
        }
        reservations.set(reservation.id, {
          ...reservation,
          amountCommitted: finalAmount,
          status: 'committed',
          updatedAt: toIso(now),
        });
        return currentBalance(subjectToUserId(reservation.subject), reservation.unit);
      },
      async releaseReservation(input) {
        const reservation = reservations.get(input.reservationId);
        if (!reservation) {
          throw new Error(`MODULE_CREDITS_RESERVATION_NOT_FOUND: ${input.reservationId}`);
        }
        if (reservation.status === 'committed') {
          return currentBalance(subjectToUserId(reservation.subject), reservation.unit);
        }
        if (reservation.status !== 'released') {
          const releasable =
            reservation.amountReserved - reservation.amountCommitted;
          if (releasable > 0) {
            adjustBalance({
              subject: reservation.subject,
              amount: releasable,
              unit: reservation.unit,
              multiplier: 1,
              reason: input.reason ?? 'reserve.release',
              metadata: { ...(input.metadata ?? {}), reservationId: reservation.id },
            });
          }
        }
        reservations.set(reservation.id, {
          ...reservation,
          status: 'released',
          updatedAt: toIso(now),
        });
        return currentBalance(subjectToUserId(reservation.subject), reservation.unit);
      },
      async revokeBySource(input) {
        const matching = creditLedger.filter(
          (entry) => entry.source === input.source && entry.sourceId === input.sourceId
        );
        for (const entry of matching) {
          if (entry.amount > 0) {
            adjustBalance({
              subject: entry.subject,
              amount: entry.amount,
              unit: entry.unit,
              multiplier: -1,
              reason: input.reason ?? 'revoke',
              source: input.source,
              sourceId: input.sourceId,
              metadata: input.metadata,
            });
          }
        }
        return { revoked: matching.length };
      },
      async refundRevoke(input) {
        if (!input.grantLedgerId && (!input.source || !input.sourceId)) {
          throw new Error('MODULE_CREDITS_REFUND_REVOKE_TARGET_REQUIRED');
        }
        let requestedAmount: number | undefined;
        if (input.amount !== undefined) {
          const amount = normalizeCreditAmount(input.amount, 'credits.refundRevoke.amount');
          assertPositiveIntegerAmount(amount, 'credits.refundRevoke.amount');
          requestedAmount = amount;
        }
        const requestedSubject =
          input.subject || input.userId ? subjectFromInput(input) : undefined;
        const matching = creditLedger.filter((entry) => {
          if (entry.amount <= 0 || entry.status !== 'available') {
            return false;
          }
          if (input.unit && entry.unit !== input.unit) {
            return false;
          }
          if (
            requestedSubject &&
            subjectToUserId(entry.subject) !== subjectToUserId(requestedSubject)
          ) {
            return false;
          }
          if (input.grantLedgerId) {
            return entry.id === input.grantLedgerId;
          }
          return entry.source === input.source && entry.sourceId === input.sourceId;
        });
        const first = matching[0];
        if (!first) {
          if (!requestedSubject) {
            throw new Error('MODULE_CREDITS_REFUND_REVOKE_TARGET_NOT_FOUND');
          }
          return {
            revoked: 0,
            unrecovered: requestedAmount ?? 0,
            balance: currentBalance(subjectToUserId(requestedSubject), input.unit),
            relatedLedgerIds: [],
          };
        }
        const subject = first.subject;
        releaseExpiredReservations(subject, input.unit ?? first.unit);
        const relatedLedgerIds = matching.map((entry) => entry.id);
        const eligibleAmount = matching.reduce((sum, entry) => sum + entry.amount, 0);
        const targetAmount = requestedAmount ?? eligibleAmount;
        const cappedTargetAmount = Math.min(targetAmount, eligibleAmount);
        const current = currentBalance(subjectToUserId(subject), input.unit ?? first.unit);
        const revoked = Math.min(cappedTargetAmount, Math.max(0, current.balance));
        const unrecovered = targetAmount - revoked;
        if (revoked > 0) {
          adjustBalance({
            subject,
            amount: revoked,
            unit: input.unit ?? first.unit,
            multiplier: -1,
            reason: input.reason ?? 'refund_revoke',
            source: input.source ?? first.source,
            sourceId: input.sourceId ?? first.sourceId,
            idempotencyKey: input.idempotencyKey,
            metadata: {
              ...(input.metadata ?? {}),
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
          balance: currentBalance(subjectToUserId(subject), input.unit ?? first.unit),
          relatedLedgerIds,
        };
      },
      async listLedger(input = {}) {
        const subject = input.subject ?? (input.userId ? userSubject(input.userId) : undefined);
        return creditLedger
          .filter((entry) => !subject || subjectToUserId(entry.subject) === subjectToUserId(subject))
          .filter((entry) => !input.unit || entry.unit === input.unit)
          .filter((entry) => !input.source || entry.source === input.source)
          .filter((entry) => !input.sourceId || entry.sourceId === input.sourceId)
          .filter((entry) => !input.status || entry.status === input.status)
          .map((entry) => ({ ...entry, metadata: { ...entry.metadata } }));
      },
    };

    const billing: ModuleBillingApi = {
      async getPlan(userId) {
        return options.plansByUser?.[userId] ?? null;
      },
      async getCurrentPlan(userId) {
        return options.plansByUser?.[userId] ?? null;
      },
      async hasEntitlement(userId, entitlement) {
        return (
          Boolean(options.plansByUser?.[userId]?.entitlements.includes(entitlement)) ||
          [...entitlementGrants.values()].some(
            (grant) =>
              grant.userId === userId &&
              grant.entitlement === entitlement &&
              grant.status === 'active'
          )
        );
      },
      async redeemCode(code, _userId) {
        const entitlement = options.redeemCodes?.[code];
        return entitlement ? { ok: true, entitlement } : { ok: false };
      },
    };

    const entitlements: ModuleEntitlementsApi = {
      async has(input, entitlement) {
        const subject = typeof input === 'string' ? userSubject(input) : input.subject;
        const resolvedEntitlement = typeof input === 'string' ? entitlement : input.entitlement;
        if (!resolvedEntitlement) {
          return false;
        }
        return billing.hasEntitlement(subjectToUserId(subject), resolvedEntitlement);
      },
      async list(input = {}) {
        const subject = input.subject ?? (input.userId ? userSubject(input.userId) : undefined);
        return [...entitlementGrants.values()]
          .filter((grant) => !subject || subjectToUserId(grant.subject) === subjectToUserId(subject))
          .filter((grant) => !input.entitlement || grant.entitlement === input.entitlement)
          .filter((grant) => !input.status || grant.status === input.status)
          .map((grant) => ({ ...grant, metadata: { ...grant.metadata } }));
      },
      async grant(input) {
        const subject = subjectFromInput(input);
        const timestamp = toIso(now);
        const grant: ModuleEntitlementGrant = {
          id: `entitlement_${randomUUID()}`,
          subject,
          userId: subject.type === 'user' ? subject.id : subjectToUserId(subject),
          entitlement: input.entitlement,
          planId: input.planId,
          source: input.source,
          sourceId: input.sourceId,
          status: 'active',
          idempotencyKey: input.idempotencyKey,
          expiresAt: input.expiresAt,
          metadata: input.metadata ?? {},
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        entitlementGrants.set(grant.id, grant);
        return { ...grant, metadata: { ...grant.metadata } };
      },
      async revoke(input) {
        const grant = entitlementGrants.get(input.id);
        if (!grant) {
          throw new Error(`MODULE_ENTITLEMENT_NOT_FOUND: ${input.id}`);
        }
        const next = {
          ...grant,
          status: 'revoked' as const,
          metadata: { ...grant.metadata, ...(input.metadata ?? {}), reason: input.reason },
          updatedAt: toIso(now),
        };
        entitlementGrants.set(next.id, next);
        return { ...next, metadata: { ...next.metadata } };
      },
      async override(input) {
        const grant = entitlementGrants.get(input.id);
        if (!grant) {
          throw new Error(`MODULE_ENTITLEMENT_NOT_FOUND: ${input.id}`);
        }
        const next = {
          ...grant,
          status: input.status,
          expiresAt: input.expiresAt === null ? undefined : (input.expiresAt ?? grant.expiresAt),
          metadata: { ...grant.metadata, ...(input.metadata ?? {}) },
          updatedAt: toIso(now),
        };
        entitlementGrants.set(next.id, next);
        return { ...next, metadata: { ...next.metadata } };
      },
      async expire(input = {}) {
        const cutoff = input.before ? new Date(input.before).getTime() : now().getTime();
        let expired = 0;
        for (const grant of entitlementGrants.values()) {
          if (input.limit && expired >= input.limit) {
            break;
          }
          if (grant.status === 'active' && grant.expiresAt && new Date(grant.expiresAt).getTime() <= cutoff) {
            entitlementGrants.set(grant.id, {
              ...grant,
              status: 'expired',
              updatedAt: toIso(now),
            });
            expired += 1;
          }
        }
        return { expired };
      },
    };

    const commerce: ModuleCommerceApi = {
      async createCheckout(input) {
        assertPositiveIntegerAmount(input.amount, 'commerce.createCheckout.amount');
        if (input.idempotencyKey) {
          const existingId = checkoutIdempotency.get(input.idempotencyKey);
          if (existingId) {
            return { ...(checkouts.get(existingId) as ModuleCommerceCheckout) };
          }
        }

        const beneficiary = input.beneficiary ?? input.buyer ?? subjectFromInput(input);
        const checkout: ModuleCommerceCheckout = {
          id: `checkout_${randomUUID()}`,
          userId: subjectToUserId(beneficiary),
          buyer: input.buyer,
          beneficiary,
          sku: input.sku,
          amount: input.amount,
          currency: input.currency,
          status: 'created',
          idempotencyKey: input.idempotencyKey,
          createdAt: toIso(now),
        };
        checkouts.set(checkout.id, checkout);
        if (input.idempotencyKey) {
          checkoutIdempotency.set(input.idempotencyKey, checkout.id);
        }
        return { ...checkout };
      },
      async getOrder(id) {
        const checkout = checkouts.get(id);
        return checkout ? { ...checkout } : null;
      },
      async applyCheckoutPaid(input) {
        assertPositiveIntegerAmount(input.amount, 'commerce.applyCheckoutPaid.amount');
        const checkout = await commerce.createCheckout(input);
        const paid = { ...checkout, status: 'paid' as const };
        checkouts.set(paid.id, paid);
        return { order: { ...paid }, credits: [], entitlements: [] };
      },
      async applyRefund(input) {
        const checkout = input.orderId ? checkouts.get(input.orderId) : undefined;
        if (!checkout) {
          throw new Error(`MODULE_COMMERCIAL_REFUND_ORDER_NOT_FOUND: ${input.providerRef}`);
        }
        const refunded = { ...checkout, status: 'refunded' as const };
        checkouts.set(refunded.id, refunded);
        return { order: { ...refunded }, credits: [], revokedEntitlements: [] };
      },
      async recordSubscriptionEvent(input) {
        const subject = subjectFromInput(input);
        return {
          id: `subscription_event_${randomUUID()}`,
          subject,
          planId: input.planId,
          type: input.type,
          status: input.status ?? (input.type === 'canceled' ? 'canceled' : 'active'),
        };
      },
      async reconcilePaidOrderBenefits() {
        return { checked: [...checkouts.values()].filter((order) => order.status === 'paid').length, repaired: 0 };
      },
    };

    const redeemCodes: ModuleRedeemCodesApi = {
      async createBatch(input) {
        if (!Number.isInteger(input.count) || input.count < 1 || input.count > 1000) {
          throw new Error('MODULE_REDEEM_CODES_INVALID_COUNT');
        }
        if (!Number.isInteger(input.maxRedemptions) || input.maxRedemptions < 1) {
          throw new Error('MODULE_REDEEM_CODES_INVALID_MAX_REDEMPTIONS');
        }
        if (input.credits) {
          assertPositiveIntegerAmount(input.credits.amount, 'redeemCodes.createBatch.credits');
        }
        const batchId = `redeem_batch_${randomUUID()}`;
        const codes: ModuleRedeemCodeRecord[] = [];
        for (let index = 0; index < input.count; index += 1) {
          const code = `${input.prefix ? `${input.prefix}_` : ''}${randomUUID().replace(/-/g, '').slice(0, 20)}`;
          const codeHash = hashRedeemCode(code);
          const record: ModuleRedeemCodeRecord = {
            id: `redeem:${codeHash}`,
            batchId,
            prefix: input.prefix,
            maskedCode: maskRedeemCode(code),
            entitlement: input.entitlement,
            credits: input.credits,
            maxRedemptions: input.maxRedemptions,
            status: 'active',
            expiresAt: input.expiresAt,
            metadata: { ...(input.metadata ?? {}), bind: input.bind, rawCode: code },
            createdAt: toIso(now),
            updatedAt: toIso(now),
          };
          redeemCodeRecords.set(codeHash, {
            ...record,
            metadata: { ...(input.metadata ?? {}), bind: input.bind },
          });
          redeemCodeRawToHash.set(code, codeHash);
          codes.push({ ...record, metadata: { ...record.metadata } });
        }
        return { batchId, codes };
      },
      async redeem(input) {
        const codeHash = redeemCodeRawToHash.get(input.code) ?? hashRedeemCode(input.code);
        const record = redeemCodeRecords.get(codeHash);
        const entitlement = record?.entitlement ?? options.redeemCodes?.[input.code];
        if (
          (!record && !entitlement) ||
          record?.status === 'frozen' ||
          record?.status === 'revoked' ||
          (record?.expiresAt && new Date(record.expiresAt).getTime() <= now().getTime())
        ) {
          return { ok: false };
        }
        const subject = subjectFromInput(input);
        const redemptionCodeId = record?.id ?? `legacy:${codeHash}`;
        if (record && !redeemBindAllows(record.metadata.bind, { subject, email: input.email })) {
          return { ok: false };
        }
        const existing = redemptions.find(
          (redemption) =>
            redemption.codeId === redemptionCodeId &&
            subjectToUserId(redemption.subject) === subjectToUserId(subject)
        );
        if (existing) {
          return {
            ok: true,
            entitlement: existing.entitlement,
            credits: existing.credits,
            redemption: { ...existing, metadata: { ...existing.metadata } },
          };
        }
        const usedCount = redemptions.filter(
          (redemption) => redemption.codeId === redemptionCodeId
        ).length;
        if (record && usedCount >= record.maxRedemptions) {
          return { ok: false };
        }
        if (entitlement) {
          await entitlements.grant({
            subject,
            entitlement,
            source: 'redeem',
            sourceId: codeHash,
            idempotencyKey: input.idempotencyKey,
          });
        }
        if (record?.credits) {
          await credits.grant({
            subject,
            amount: record.credits.amount,
            unit: record.credits.unit,
            reason: 'redeem',
            source: 'redeem',
            sourceId: codeHash,
            idempotencyKey: input.idempotencyKey,
          });
        }
        const redemption: ModuleRedeemCodeRedemption = {
          id: `redemption_${randomUUID()}`,
          codeId: redemptionCodeId,
          subject,
          entitlement,
          credits: record?.credits,
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata ?? {},
          createdAt: toIso(now),
        };
        redemptions.push(redemption);
        return { ok: true, entitlement, credits: record?.credits, redemption };
      },
      async freeze(input) {
        let frozen = 0;
        for (const record of redeemCodeRecords.values()) {
          if (record.batchId === input.batchId && record.status === 'active') {
            const usedCount = redemptions.filter((redemption) => redemption.codeId === record.id).length;
            if (usedCount >= record.maxRedemptions) {
              continue;
            }
            redeemCodeRecords.set(record.id.replace(/^redeem:/, ''), { ...record, status: 'frozen', updatedAt: toIso(now) });
            frozen += 1;
          }
        }
        return { frozen };
      },
      async revoke(input) {
        const record = [...redeemCodeRecords.values()].find((candidate) => candidate.id === input.codeId);
        if (!record) {
          throw new Error(`MODULE_REDEEM_CODE_NOT_FOUND: ${input.codeId}`);
        }
        const next = { ...record, status: 'revoked' as const, metadata: { ...record.metadata, reason: input.reason }, updatedAt: toIso(now) };
        redeemCodeRecords.set(next.id.replace(/^redeem:/, ''), next);
        return next;
      },
      async list(input = {}) {
        return [...redeemCodeRecords.values()]
          .filter((record) => !input.batchId || record.batchId === input.batchId)
          .map((record) => ({
            ...record,
            status:
              record.status === 'active' &&
              record.expiresAt &&
              new Date(record.expiresAt).getTime() <= now().getTime()
                ? 'expired' as const
                : record.status,
            metadata: { ...record.metadata },
          }))
          .filter((record) => !input.status || record.status === input.status);
      },
      async listRedemptions(input = {}) {
        const subject = input.subject ?? (input.userId ? userSubject(input.userId) : undefined);
        return redemptions
          .filter((redemption) => !input.codeId || redemption.codeId === input.codeId)
          .filter((redemption) => !subject || subjectToUserId(redemption.subject) === subjectToUserId(subject))
          .map((redemption) => ({ ...redemption, metadata: { ...redemption.metadata } }));
      },
    };

    const risk: ModuleRiskApi = {
      async record(input) {
        return {
          id: `risk_${randomUUID()}`,
          subject: input.subject,
          type: input.type,
          severity: input.severity ?? 'medium',
          status: input.status ?? 'open',
          source: input.source,
          sourceId: input.sourceId,
          metadata: input.metadata ?? {},
          createdAt: toIso(now),
        };
      },
      async block(input) {
        riskBlocks.set(`${input.subject.type}:${input.subject.id}:${input.scope ?? ''}`, {
          reason: input.reason,
          expiresAt: input.expiresAt,
        });
        return { blocked: true };
      },
      async check(input) {
        if (!input.subject) {
          return { ok: true };
        }
        const block =
          riskBlocks.get(`${input.subject.type}:${input.subject.id}:${input.scope ?? ''}`) ??
          riskBlocks.get(`${input.subject.type}:${input.subject.id}:`);
        if (!block) {
          return { ok: true };
        }
        if (block.expiresAt && new Date(block.expiresAt).getTime() <= now().getTime()) {
          return { ok: true };
        }
        return { ok: false, reason: block.reason };
      },
    };

    return { usage, metering: meteringApi, credits, billing, entitlements, commerce, redeemCodes, risk };
  }

  function updateMetering(
    id: string,
    status: ModuleMeteringAuthorization['status']
  ): ModuleMeteringAuthorization {
    const authorization = metering.get(id);
    if (!authorization) {
      throw new Error(`MODULE_METERING_AUTHORIZATION_NOT_FOUND: ${id}`);
    }
    const next = {
      ...authorization,
      status,
      updatedAt: toIso(now),
    };
    metering.set(id, next);
    return { ...next };
  }

  return {
    forModule,
    listUsage() {
      return [...usageRecords.values()].map((record) => ({
        ...record,
        metadata: { ...record.metadata },
      }));
    },
    listMetering() {
      return [...metering.values()].map((record) => ({ ...record }));
    },
    listCheckouts() {
      return [...checkouts.values()].map((record) => ({ ...record }));
    },
  };
}
