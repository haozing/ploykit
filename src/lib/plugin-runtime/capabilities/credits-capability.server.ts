import { randomUUID } from 'crypto';
import {
  Permission,
  PluginError,
  type PluginCreditAdjustInput,
  type PluginCreditBalance,
  type PluginCreditBalanceInput,
  type PluginCreditChangeInput,
  type PluginCreditChangeResult,
  type PluginCreditConsumeInput,
  type PluginCreditConsumeResult,
  type PluginCreditScope,
  type PluginCredits,
} from '@ploykit/plugin-sdk';
import {
  applyCreditChange,
  CreditIdempotencyConflictError,
  getCreditAccountBalance,
  InsufficientCreditsError,
  type CreditAccountScope,
} from '@/lib/services/billing/credit-account-service';
import { getProductPrimaryCreditMetric } from '@/lib/billing/product-billing.server';
import { getCurrentRuntimeProductId } from '@/lib/plugin-runtime/product-context.server';
import {
  assertJsonSerializable,
  assertName,
  assertPluginNamespaced,
  assertResourceScopeAccess,
  enforceCapabilityPermission,
  type PluginCapabilityScope,
} from './guards.server';

export function getDefaultCreditMetric(): string {
  return getProductPrimaryCreditMetric();
}

export interface PluginCreditsHostScope {
  pluginId: string;
  userId?: string;
  userRole?: 'admin' | 'user';
  requestId: string;
  productId: string;
  system: boolean;
}

export interface PluginCreditsConsumeHostInput extends PluginCreditConsumeInput {
  accountScope: CreditAccountScope;
  metric: string;
  amount: number;
  idempotencyKey: string;
}

export interface PluginCreditsChangeHostInput extends PluginCreditChangeInput {
  accountScope: CreditAccountScope;
  metric: string;
  amount: number;
  idempotencyKey?: string;
}

export interface PluginCreditsAdjustHostInput extends PluginCreditAdjustInput {
  accountScope: CreditAccountScope;
  metric: string;
  amount: number;
  idempotencyKey?: string;
}

export interface PluginCreditsHost {
  getBalance(
    scope: PluginCreditsHostScope,
    input: { accountScope: CreditAccountScope; metric: string }
  ): Promise<PluginCreditBalance>;
  consume(
    scope: PluginCreditsHostScope,
    input: PluginCreditsConsumeHostInput
  ): Promise<PluginCreditConsumeResult>;
  grant(
    scope: PluginCreditsHostScope,
    input: PluginCreditsChangeHostInput
  ): Promise<PluginCreditChangeResult>;
  adjust(
    scope: PluginCreditsHostScope,
    input: PluginCreditsAdjustHostInput
  ): Promise<PluginCreditChangeResult>;
  refund(
    scope: PluginCreditsHostScope,
    input: PluginCreditsChangeHostInput
  ): Promise<PluginCreditChangeResult>;
}

export interface CreatePluginCreditsOptions {
  host?: Partial<PluginCreditsHost>;
  balanceMetric?: string;
  productId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createInputError(label: string, details?: Record<string, unknown>): PluginError {
  return new PluginError({
    code: 'PLUGIN_CREDITS_INPUT_INVALID',
    message: `${label} is invalid.`,
    statusCode: 400,
    details,
  });
}

function readOptionalString(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw createInputError(label, { label });
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.length > maxLength) {
    throw createInputError(label, { label, maxLength });
  }

  return normalized;
}

function readPositiveAmount(value: unknown, label = 'Credit amount'): number {
  if (value === undefined || value === null) {
    return 1;
  }

  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw createInputError(label, { amount: value });
  }

  return value;
}

function readAdjustAmount(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value === 0
  ) {
    throw createInputError('Credit adjustment amount', { amount: value });
  }

  return value;
}

function assertMetadata(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw createInputError(label, { label });
  }

  assertJsonSerializable(value, label);
}

function createHostScope(scope: PluginCapabilityScope, productId: string): PluginCreditsHostScope {
  return {
    pluginId: scope.contract.id,
    userId: scope.user?.id,
    userRole: scope.user?.role,
    requestId: scope.requestId,
    productId,
    system: Boolean(scope.system),
  };
}

function normalizeMetric(
  scope: PluginCapabilityScope,
  metric: string | undefined,
  balanceMetric: string,
  label: string
) {
  const normalized = readOptionalString(metric, label, 120) ?? balanceMetric;
  if (normalized !== balanceMetric) {
    assertPluginNamespaced(scope, normalized, label);
  }
  return normalized;
}

function requireAdminOrSystem(scope: PluginCapabilityScope, capability: string): void {
  if (scope.system || scope.user?.role === 'admin') {
    return;
  }

  throw new PluginError({
    code: 'PLUGIN_CREDITS_SCOPE_FORBIDDEN',
    message: `${capability} requires an admin or system context for this credit scope.`,
    statusCode: 403,
    details: {
      pluginId: scope.contract.id,
      capability,
    },
  });
}

async function resolveCreditScope(
  scope: PluginCapabilityScope,
  inputScope: PluginCreditScope | undefined,
  rawUserId: unknown,
  capability: string,
  access: 'read' | 'write'
): Promise<CreditAccountScope> {
  const requestedUserId = readOptionalString(rawUserId, 'Credit target user ID', 256);
  const requestedScope =
    inputScope ?? (requestedUserId ? { type: 'user', id: requestedUserId } : undefined);

  if (!requestedScope || requestedScope.type === 'user') {
    const targetUserId = requestedScope?.type === 'user' ? requestedScope.id?.trim() : undefined;
    const resolvedUserId = targetUserId || requestedUserId || scope.user?.id;

    if (!resolvedUserId) {
      throw new PluginError({
        code: 'PLUGIN_CREDITS_USER_REQUIRED',
        message: `${capability} requires a target user.`,
        statusCode: 401,
        details: {
          pluginId: scope.contract.id,
          capability,
        },
      });
    }

    assertName(resolvedUserId, 'Credit user scope id');
    await assertResourceScopeAccess(
      scope,
      { type: 'user', id: resolvedUserId },
      access,
      capability
    );
    return { type: 'user', id: resolvedUserId };
  }

  if (requestedScope.type === 'workspace') {
    const workspaceId = requestedScope.id.trim();
    if (!workspaceId) {
      throw createInputError('Credit workspace scope', { scope: requestedScope });
    }
    assertName(workspaceId, 'Credit workspace scope id');
    await assertResourceScopeAccess(
      scope,
      { type: 'workspace', id: workspaceId },
      access,
      capability
    );
    return { type: 'workspace', id: workspaceId };
  }

  if (requestedScope.type === 'product') {
    requireAdminOrSystem(scope, capability);
    const productId = requestedScope.id?.trim() || getCurrentRuntimeProductId();
    assertName(productId, 'Credit product scope id');
    return { type: 'product', id: productId };
  }

  if (requestedScope.type === 'plugin') {
    requireAdminOrSystem(scope, capability);
    const pluginId = requestedScope.id?.trim() || scope.contract.id;
    assertName(pluginId, 'Credit plugin scope id');
    return { type: 'plugin', id: pluginId };
  }

  throw createInputError('Credit scope', { scope: requestedScope });
}

function mapBalance(
  accountScope: CreditAccountScope,
  result: Awaited<ReturnType<typeof getCreditAccountBalance>>
): PluginCreditBalance {
  return {
    balance: result.balance,
    metric: result.metric,
    scope: accountScope,
    userId: accountScope.type === 'user' ? accountScope.id : undefined,
    unlimited: result.unlimited,
    metadata: result.metadata,
  };
}

function mapChangeResult(
  operation: PluginCreditChangeResult['operation'],
  result: Awaited<ReturnType<typeof applyCreditChange>>,
  metadata?: Record<string, unknown>
): PluginCreditChangeResult {
  return {
    changed: true,
    operation,
    amount: Math.abs(result.amount),
    balanceBefore: result.balanceBefore,
    balanceAfter: result.balanceAfter,
    metric: result.metric,
    scope: result.scope,
    userId: result.scope.type === 'user' ? result.scope.id : undefined,
    idempotencyKey: result.idempotencyKey,
    metadata,
  };
}

function createIdempotencyConflictPluginError(
  scope: PluginCreditsHostScope,
  error: CreditIdempotencyConflictError
): PluginError {
  return new PluginError({
    code: 'PLUGIN_CREDITS_IDEMPOTENCY_CONFLICT',
    message: `Credit idempotency key "${error.idempotencyKey}" was already used for a different request.`,
    statusCode: 409,
    details: {
      pluginId: scope.pluginId,
      idempotencyKey: error.idempotencyKey,
    },
  });
}

function mapCreditServiceError(
  scope: PluginCreditsHostScope,
  error: unknown,
  insufficientDetails?: Record<string, unknown>
): never {
  if (error instanceof CreditIdempotencyConflictError) {
    throw createIdempotencyConflictPluginError(scope, error);
  }

  if (error instanceof InsufficientCreditsError) {
    throw new PluginError({
      code: 'PLUGIN_CREDITS_INSUFFICIENT',
      message: `Not enough credits for "${error.metric}".`,
      statusCode: 402,
      details: {
        pluginId: scope.pluginId,
        scope: error.scope,
        metric: error.metric,
        amount: error.amount,
        ...insufficientDetails,
      },
    });
  }

  throw error;
}

export function createDefaultPluginCreditsHost(
  balanceMetric: string = getDefaultCreditMetric()
): PluginCreditsHost {
  return {
    async getBalance(_scope, input) {
      return mapBalance(
        input.accountScope,
        await getCreditAccountBalance(input.accountScope, input.metric)
      );
    },

    async consume(scope, input) {
      try {
        const result = await applyCreditChange({
          scope: input.accountScope,
          metric: input.metric || balanceMetric,
          operation: 'consume',
          amount: -input.amount,
          pluginId: scope.pluginId,
          userId: input.accountScope.type === 'user' ? input.accountScope.id : scope.userId,
          idempotencyKey: input.idempotencyKey,
          reason: `Consumed by ${input.meter}`,
          metadata: {
            pluginId: scope.pluginId,
            requestId: scope.requestId,
            meter: input.meter,
            ...input.metadata,
          },
        });

        return {
          consumed: true,
          amount: input.amount,
          balanceBefore: result.balanceBefore,
          balanceAfter: result.balanceAfter,
          meter: input.meter,
          metric: result.metric,
          scope: result.scope,
          userId: result.scope.type === 'user' ? result.scope.id : undefined,
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata,
        };
      } catch (error) {
        mapCreditServiceError(scope, error, { meter: input.meter });
      }
    },

    async grant(scope, input) {
      try {
        const result = await applyCreditChange({
          scope: input.accountScope,
          metric: input.metric || balanceMetric,
          operation: 'grant',
          amount: input.amount,
          pluginId: scope.pluginId,
          userId: input.accountScope.type === 'user' ? input.accountScope.id : scope.userId,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason ?? `Granted by plugin ${scope.pluginId}`,
          metadata: input.metadata,
          visibleInCreditLog: true,
        });
        return mapChangeResult('grant', result, input.metadata);
      } catch (error) {
        mapCreditServiceError(scope, error);
      }
    },

    async adjust(scope, input) {
      try {
        const result = await applyCreditChange({
          scope: input.accountScope,
          metric: input.metric || balanceMetric,
          operation: 'adjust',
          amount: input.amount,
          mode: input.mode ?? 'delta',
          pluginId: scope.pluginId,
          userId: input.accountScope.type === 'user' ? input.accountScope.id : scope.userId,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason ?? `Adjusted by plugin ${scope.pluginId}`,
          metadata: input.metadata,
          visibleInCreditLog: true,
        });
        return mapChangeResult('adjust', result, input.metadata);
      } catch (error) {
        mapCreditServiceError(scope, error);
      }
    },

    async refund(scope, input) {
      try {
        const result = await applyCreditChange({
          scope: input.accountScope,
          metric: input.metric || balanceMetric,
          operation: 'refund',
          amount: input.amount,
          pluginId: scope.pluginId,
          userId: input.accountScope.type === 'user' ? input.accountScope.id : scope.userId,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason ?? `Refunded by plugin ${scope.pluginId}`,
          metadata: input.metadata,
          visibleInCreditLog: true,
        });
        return mapChangeResult('refund', result, input.metadata);
      } catch (error) {
        mapCreditServiceError(scope, error);
      }
    },
  };
}

function resolveHost(
  host: Partial<PluginCreditsHost> | undefined,
  balanceMetric?: string
): PluginCreditsHost {
  return {
    ...createDefaultPluginCreditsHost(balanceMetric),
    ...host,
  };
}

function normalizeBalanceInput(
  input: string | PluginCreditBalanceInput | undefined
): PluginCreditBalanceInput {
  if (typeof input === 'string') {
    return { metric: input };
  }

  if (input === undefined) {
    return {};
  }

  if (!isRecord(input)) {
    throw createInputError('Credit balance input');
  }

  return input as PluginCreditBalanceInput;
}

export function createPluginCreditsCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginCreditsOptions = {}
): PluginCredits {
  const balanceMetric = options.balanceMetric ?? getDefaultCreditMetric();
  const productId = options.productId ?? getCurrentRuntimeProductId();
  const host = resolveHost(options.host, balanceMetric);

  return {
    async getBalance(rawInput) {
      enforceCapabilityPermission(scope, Permission.CreditsRead, 'ctx.credits.getBalance');
      const input = normalizeBalanceInput(rawInput);
      const metric = normalizeMetric(scope, input.metric, balanceMetric, 'Credit balance metric');
      const accountScope = await resolveCreditScope(
        scope,
        input.scope,
        undefined,
        'ctx.credits.getBalance',
        'read'
      );

      return host.getBalance(createHostScope(scope, productId), { accountScope, metric });
    },

    async consume(input) {
      enforceCapabilityPermission(scope, Permission.CreditsConsume, 'ctx.credits.consume');

      if (!isRecord(input)) {
        throw createInputError('Credit consume input');
      }

      const meter = readOptionalString(input.meter, 'Credit meter', 120);
      if (!meter) {
        throw createInputError('Credit meter');
      }

      assertPluginNamespaced(scope, meter, 'Credit meter');
      const metadata = input.metadata;
      if (metadata !== undefined) {
        assertMetadata(metadata, 'Credit consume metadata');
      }

      const metric = normalizeMetric(scope, input.metric, balanceMetric, 'Credit metric');
      const accountScope = await resolveCreditScope(
        scope,
        input.scope,
        input.userId,
        'ctx.credits.consume',
        'write'
      );

      return host.consume(createHostScope(scope, productId), {
        ...input,
        meter,
        metric,
        accountScope,
        amount: readPositiveAmount(input.amount),
        userId: accountScope.type === 'user' ? accountScope.id : input.userId,
        idempotencyKey:
          readOptionalString(input.idempotencyKey, 'Credit idempotency key', 160) ??
          `${scope.requestId}:credits:${meter}:${randomUUID()}`,
        metadata,
      });
    },

    async grant(input) {
      enforceCapabilityPermission(scope, Permission.CreditsWrite, 'ctx.credits.grant');
      const normalized = await normalizeChangeInput(
        scope,
        input,
        balanceMetric,
        'ctx.credits.grant'
      );
      return host.grant(createHostScope(scope, productId), normalized);
    },

    async adjust(input) {
      enforceCapabilityPermission(scope, Permission.CreditsWrite, 'ctx.credits.adjust');
      const normalized = await normalizeAdjustInput(
        scope,
        input,
        balanceMetric,
        'ctx.credits.adjust'
      );
      return host.adjust(createHostScope(scope, productId), normalized);
    },

    async refund(input) {
      enforceCapabilityPermission(scope, Permission.CreditsWrite, 'ctx.credits.refund');
      const normalized = await normalizeChangeInput(
        scope,
        input,
        balanceMetric,
        'ctx.credits.refund'
      );
      return host.refund(createHostScope(scope, productId), normalized);
    },
  };
}

async function normalizeChangeInput(
  scope: PluginCapabilityScope,
  input: PluginCreditChangeInput,
  balanceMetric: string,
  capability: string
): Promise<PluginCreditsChangeHostInput> {
  if (!isRecord(input)) {
    throw createInputError('Credit change input');
  }

  const metadata = input.metadata;
  if (metadata !== undefined) {
    assertMetadata(metadata, 'Credit change metadata');
  }
  const accountScope = await resolveCreditScope(
    scope,
    input.scope,
    input.userId,
    capability,
    'write'
  );

  return {
    ...input,
    metric: normalizeMetric(scope, input.metric, balanceMetric, 'Credit metric'),
    accountScope,
    amount: readPositiveAmount(input.amount),
    userId: accountScope.type === 'user' ? accountScope.id : input.userId,
    reason: readOptionalString(input.reason, 'Credit change reason', 500),
    idempotencyKey: readOptionalString(input.idempotencyKey, 'Credit idempotency key', 160),
    metadata,
  };
}

async function normalizeAdjustInput(
  scope: PluginCapabilityScope,
  input: PluginCreditAdjustInput,
  balanceMetric: string,
  capability: string
): Promise<PluginCreditsAdjustHostInput> {
  if (!isRecord(input)) {
    throw createInputError('Credit adjustment input');
  }

  const metadata = input.metadata;
  if (metadata !== undefined) {
    assertMetadata(metadata, 'Credit adjustment metadata');
  }
  const accountScope = await resolveCreditScope(
    scope,
    input.scope,
    input.userId,
    capability,
    'write'
  );

  return {
    ...input,
    metric: normalizeMetric(scope, input.metric, balanceMetric, 'Credit metric'),
    accountScope,
    amount: readAdjustAmount(input.amount),
    userId: accountScope.type === 'user' ? accountScope.id : input.userId,
    mode: input.mode === 'set' ? 'set' : 'delta',
    reason: readOptionalString(input.reason, 'Credit adjustment reason', 500),
    idempotencyKey: readOptionalString(input.idempotencyKey, 'Credit idempotency key', 160),
    metadata,
  };
}
