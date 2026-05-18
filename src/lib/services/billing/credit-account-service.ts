import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { invalidateUserEntitlementCache } from '@/lib/cache';
import { withSystemContext, type Database } from '@/lib/db';
import {
  creditAccounts,
  creditLedgerEntries,
  creditLogs,
  userEntitlements,
  type CreditAccountScopeType,
  type CreditLedgerOperation,
  type CreditLogType,
} from '@/lib/db/schema';
import { PLATFORM_PRIMARY_CREDIT_METRIC } from '@/lib/billing/billing-metrics';

export interface CreditAccountScope {
  type: CreditAccountScopeType;
  id: string;
}

export interface ApplyCreditChangeInput {
  scope: CreditAccountScope;
  metric?: string;
  operation: CreditLedgerOperation;
  amount: number;
  mode?: 'delta' | 'set';
  pluginId?: string;
  userId?: string;
  idempotencyKey?: string;
  relatedOrderId?: string;
  relatedUsageId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  allowNegative?: boolean;
  visibleInCreditLog?: boolean;
  creditLogType?: CreditLogType;
}

export interface CreditChangeResult {
  accountId: string;
  ledgerEntryId: string;
  scope: CreditAccountScope;
  metric: string;
  operation: CreditLedgerOperation;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  idempotencyKey?: string;
  idempotentReplay: boolean;
  metadata?: Record<string, unknown>;
}

export class InsufficientCreditsError extends Error {
  constructor(
    readonly scope: CreditAccountScope,
    readonly metric: string,
    readonly amount: number
  ) {
    super(`Not enough credits in ${scope.type}:${scope.id} for metric "${metric}".`);
    this.name = 'InsufficientCreditsError';
  }
}

export class CreditIdempotencyConflictError extends Error {
  constructor(
    readonly idempotencyKey: string,
    readonly existingFingerprint: string | null,
    readonly requestedFingerprint: string
  ) {
    super(`Credit idempotency key "${idempotencyKey}" was reused with a different request.`);
    this.name = 'CreditIdempotencyConflictError';
  }
}

function normalizeMetric(metric?: string): string {
  const normalized = metric?.trim();
  const result = normalized || PLATFORM_PRIMARY_CREDIT_METRIC;
  if (!/^[a-zA-Z0-9._:-]+$/.test(result)) {
    throw new Error(`Credit metric "${result}" is invalid.`);
  }
  return result;
}

function readBalance(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
  }

  return 0;
}

function stableStringify(value: unknown): string {
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`;
}

function hashStableJson(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function buildChecksum(input: {
  accountId: string;
  scope: CreditAccountScope;
  metric: string;
  operation: CreditLedgerOperation;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  idempotencyKey?: string;
  relatedOrderId?: string;
}): string {
  return hashStableJson(input);
}

function toCreditLogType(operation: CreditLedgerOperation): CreditLogType | null {
  if (operation === 'grant') return 'grant';
  if (operation === 'reset') return 'reset';
  if (operation === 'revoke') return 'refund_revoke';
  if (operation === 'adjust') return 'manual_adjust';
  if (operation === 'refund') return 'refund';
  return null;
}

function buildIdempotencyFingerprint(input: {
  scope: CreditAccountScope;
  metric: string;
  operation: CreditLedgerOperation;
  amount: number;
  mode: 'delta' | 'set';
  pluginId?: string;
  userId?: string;
  relatedOrderId?: string;
  relatedUsageId?: string;
  reason?: string;
  metadata: Record<string, unknown>;
  allowNegative: boolean;
  visibleInCreditLog: boolean;
  creditLogType?: CreditLogType;
}): string {
  return hashStableJson({
    scope: input.scope,
    metric: input.metric,
    operation: input.operation,
    amount: input.amount,
    mode: input.mode,
    pluginId: input.pluginId ?? null,
    userId: input.userId ?? null,
    relatedOrderId: input.relatedOrderId ?? null,
    relatedUsageId: input.relatedUsageId ?? null,
    reason: input.reason ?? null,
    metadata: input.metadata,
    allowNegative: input.allowNegative,
    visibleInCreditLog: input.visibleInCreditLog,
    creditLogType: input.creditLogType ?? null,
  });
}

async function syncUserEntitlementBalance(
  database: Database,
  userId: string,
  metric: string,
  balance: number
) {
  await database
    .update(userEntitlements)
    .set({
      usageMetrics: sql`
        jsonb_set(
          jsonb_set(
            COALESCE(${userEntitlements.usageMetrics}, '{}'::jsonb),
            ${sql.raw(`'{${metric}}'`)},
            to_jsonb(${balance}::int)
          ),
          '{lastCreditBalanceSyncedAt}',
          to_jsonb(${new Date().toISOString()}::text)
        )
      `,
      usageUpdatedAt: new Date(),
    })
    .where(and(eq(userEntitlements.userId, userId), eq(userEntitlements.status, 'active')));

  invalidateUserEntitlementCache(userId);
}

async function ensureAccount(
  database: Database,
  scope: CreditAccountScope,
  metric: string,
  metadata?: Record<string, unknown>
) {
  await database
    .insert(creditAccounts)
    .values({
      scopeType: scope.type,
      scopeId: scope.id,
      metric,
      metadata: metadata ?? {},
    })
    .onConflictDoNothing({
      target: [creditAccounts.scopeType, creditAccounts.scopeId, creditAccounts.metric],
    });

  const [account] = await database
    .select()
    .from(creditAccounts)
    .where(
      and(
        eq(creditAccounts.scopeType, scope.type),
        eq(creditAccounts.scopeId, scope.id),
        eq(creditAccounts.metric, metric)
      )
    )
    .for('update')
    .limit(1);

  if (!account) {
    throw new Error(`Credit account was not created for ${scope.type}:${scope.id}:${metric}.`);
  }

  return account;
}

export async function getCreditAccountBalance(
  scope: CreditAccountScope,
  metricInput?: string
): Promise<{
  balance: number;
  metric: string;
  unlimited: boolean;
  metadata: Record<string, unknown>;
}> {
  const metric = normalizeMetric(metricInput);

  return withSystemContext(async (database) => {
    const [account] = await database
      .select()
      .from(creditAccounts)
      .where(
        and(
          eq(creditAccounts.scopeType, scope.type),
          eq(creditAccounts.scopeId, scope.id),
          eq(creditAccounts.metric, metric)
        )
      )
      .limit(1);

    return {
      balance: readBalance(account?.balance),
      metric,
      unlimited: Boolean(account?.unlimited),
      metadata: (account?.metadata as Record<string, unknown> | undefined) ?? {},
    };
  });
}

export async function applyCreditChange(
  input: ApplyCreditChangeInput
): Promise<CreditChangeResult> {
  const metric = normalizeMetric(input.metric);
  const metadata = input.metadata ?? {};
  const resolvedUserId = input.userId ?? (input.scope.type === 'user' ? input.scope.id : undefined);
  const requestedCreditLogType =
    input.creditLogType ?? toCreditLogType(input.operation) ?? undefined;
  const idempotencyFingerprint = input.idempotencyKey
    ? buildIdempotencyFingerprint({
        scope: input.scope,
        metric,
        operation: input.operation,
        amount: input.amount,
        mode: input.mode ?? 'delta',
        pluginId: input.pluginId,
        userId: resolvedUserId,
        relatedOrderId: input.relatedOrderId,
        relatedUsageId: input.relatedUsageId,
        reason: input.reason,
        metadata,
        allowNegative: Boolean(input.allowNegative),
        visibleInCreditLog: Boolean(input.visibleInCreditLog),
        creditLogType: requestedCreditLogType,
      })
    : undefined;

  return withSystemContext(async (database) => {
    if (input.idempotencyKey) {
      const existing = await database.query.creditLedgerEntries.findFirst({
        where: eq(creditLedgerEntries.idempotencyKey, input.idempotencyKey),
      });

      if (existing) {
        if (existing.idempotencyFingerprint !== idempotencyFingerprint) {
          throw new CreditIdempotencyConflictError(
            input.idempotencyKey,
            existing.idempotencyFingerprint,
            idempotencyFingerprint!
          );
        }

        return {
          accountId: existing.accountId,
          ledgerEntryId: existing.id,
          scope: {
            type: existing.scopeType,
            id: existing.scopeId,
          },
          metric: existing.metric,
          operation: existing.operation,
          amount: existing.amount,
          balanceBefore: existing.balanceBefore,
          balanceAfter: existing.balanceAfter,
          idempotencyKey: existing.idempotencyKey ?? undefined,
          idempotentReplay: true,
          metadata: (existing.metadata as Record<string, unknown> | undefined) ?? {},
        };
      }
    }

    const account = await ensureAccount(database, input.scope, metric, metadata);
    const balanceBefore = readBalance(account.balance);
    const ledgerAmount = input.mode === 'set' ? input.amount - balanceBefore : input.amount;
    const balanceAfter = account.unlimited ? balanceBefore : balanceBefore + ledgerAmount;

    if (!input.allowNegative && !account.unlimited && balanceAfter < 0) {
      throw new InsufficientCreditsError(input.scope, metric, Math.abs(ledgerAmount));
    }

    const [updatedAccount] = await database
      .update(creditAccounts)
      .set({
        balance: balanceAfter,
        metadata: {
          ...(account.metadata as Record<string, unknown> | undefined),
          ...metadata,
          lastOperation: input.operation,
          lastChangedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(creditAccounts.id, account.id))
      .returning();

    const checksum = buildChecksum({
      accountId: account.id,
      scope: input.scope,
      metric,
      operation: input.operation,
      amount: ledgerAmount,
      balanceBefore,
      balanceAfter,
      idempotencyKey: input.idempotencyKey,
      relatedOrderId: input.relatedOrderId,
    });

    const [entry] = await database
      .insert(creditLedgerEntries)
      .values({
        accountId: account.id,
        scopeType: input.scope.type,
        scopeId: input.scope.id,
        metric,
        pluginId: input.pluginId,
        userId: resolvedUserId,
        operation: input.operation,
        amount: ledgerAmount,
        balanceBefore,
        balanceAfter,
        idempotencyKey: input.idempotencyKey,
        idempotencyFingerprint,
        relatedOrderId: input.relatedOrderId,
        relatedUsageId: input.relatedUsageId,
        reason: input.reason,
        metadata,
        checksum,
      })
      .returning();

    if (input.scope.type === 'user') {
      await syncUserEntitlementBalance(database, input.scope.id, metric, balanceAfter);
    }

    const logType = input.visibleInCreditLog
      ? (input.creditLogType ?? toCreditLogType(input.operation))
      : null;
    if (logType && input.scope.type === 'user') {
      await database.insert(creditLogs).values({
        userId: input.scope.id,
        logType,
        changeAmount: ledgerAmount,
        balanceBefore: { [metric]: balanceBefore },
        balanceAfter: { [metric]: balanceAfter },
        balanceDelta: { [metric]: ledgerAmount },
        reason: input.reason,
        relatedOrderId: input.relatedOrderId,
        metadata,
        checksum,
      });
    }

    return {
      accountId: updatedAccount.id,
      ledgerEntryId: entry.id,
      scope: input.scope,
      metric,
      operation: input.operation,
      amount: ledgerAmount,
      balanceBefore,
      balanceAfter,
      idempotencyKey: input.idempotencyKey,
      idempotentReplay: false,
      metadata,
    };
  });
}

export async function getUserCreditLedgerBalance(
  userId: string,
  metric = PLATFORM_PRIMARY_CREDIT_METRIC
): Promise<number> {
  const result = await getCreditAccountBalance({ type: 'user', id: userId }, metric);
  return result.balance;
}
