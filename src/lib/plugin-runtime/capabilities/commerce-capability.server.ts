import { randomUUID } from 'crypto';
import {
  Permission,
  PluginError,
  type PluginCommerce,
  type PluginCommerceCheckoutInput,
  type PluginCommerceCheckoutResult,
  type PluginCommerceCreateOrderInput,
  type PluginCommerceOrder,
  type PluginCreditScope,
} from '@ploykit/plugin-sdk';
import { getProductPrimaryCreditMetric } from '@/lib/billing/product-billing.server';
import { getCurrentRuntimeProductId } from '@/lib/plugin-runtime/product-context.server';
import { checkoutService } from '@/lib/stripe/checkout-service';
import {
  applyCreditChange,
  type CreditAccountScope,
} from '@/lib/services/billing/credit-account-service';
import {
  createOrder,
  getOrderByProviderId,
  getUserOrderById,
  getUserOrders,
} from '@/lib/services/billing/order-service';
import { grantDigitalEntitlement } from '@/lib/services/billing/digital-entitlement-service';
import {
  assertJsonSerializable,
  assertName,
  assertResourceScopeAccess,
  enforceCapabilityPermission,
  type PluginCapabilityScope,
} from './guards.server';

export interface PluginCommerceHostScope {
  pluginId: string;
  userId?: string;
  userEmail?: string;
  userRole?: 'admin' | 'user';
  requestId: string;
  productId: string;
  system: boolean;
}

export interface PluginCommerceHost {
  createCheckout(
    scope: PluginCommerceHostScope,
    input: PluginCommerceCheckoutInput & { metadata: Record<string, unknown> }
  ): Promise<PluginCommerceCheckoutResult>;
  createOrder(
    scope: PluginCommerceHostScope,
    input: PluginCommerceCreateOrderInput & { metadata: Record<string, unknown> }
  ): Promise<PluginCommerceOrder>;
  getOrder(scope: PluginCommerceHostScope, id: string): Promise<PluginCommerceOrder | null>;
  listOrders(
    scope: PluginCommerceHostScope,
    input?: { limit?: number; offset?: number }
  ): Promise<PluginCommerceOrder[]>;
}

export interface CreatePluginCommerceOptions {
  host?: Partial<PluginCommerceHost>;
}

type OrderLike = {
  id: string;
  userId: string;
  orderType: string;
  provider: string;
  providerOrderId: string;
  amount: string | null;
  currency: string | null;
  status: string;
  planId: string | null;
  relatedOrderId: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function createInputError(label: string, details?: Record<string, unknown>): PluginError {
  return new PluginError({
    code: 'PLUGIN_COMMERCE_INPUT_INVALID',
    message: `${label} is invalid.`,
    statusCode: 400,
    details,
  });
}

function createIdempotencyConflictError(details: Record<string, unknown>): PluginError {
  return new PluginError({
    code: 'PLUGIN_COMMERCE_IDEMPOTENCY_CONFLICT',
    message: 'ctx.commerce.createOrder idempotency key was reused with a different order request.',
    statusCode: 409,
    details,
  });
}

function readOptionalString(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw createInputError(label, { label });
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) throw createInputError(label, { label, maxLength });
  return normalized;
}

function readPositiveNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw createInputError(label, { value });
  }
  return value;
}

function assertMetadata(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw createInputError(label, { label });
  assertJsonSerializable(value, label);
}

function requireUser(scope: PluginCommerceHostScope, capability: string): string {
  if (scope.userId) return scope.userId;
  throw new PluginError({
    code: 'PLUGIN_COMMERCE_USER_REQUIRED',
    message: `${capability} requires an authenticated user.`,
    statusCode: 401,
    details: {
      pluginId: scope.pluginId,
    },
  });
}

function requireEmail(scope: PluginCommerceHostScope): string {
  if (scope.userEmail) return scope.userEmail;
  throw new PluginError({
    code: 'PLUGIN_COMMERCE_EMAIL_REQUIRED',
    message: 'ctx.commerce.createCheckout requires the current user email.',
    statusCode: 400,
    details: {
      pluginId: scope.pluginId,
    },
  });
}

function createHostScope(scope: PluginCapabilityScope): PluginCommerceHostScope {
  return {
    pluginId: scope.contract.id,
    userId: scope.user?.id,
    userEmail: scope.user?.email,
    userRole: scope.user?.role,
    requestId: scope.requestId,
    productId: getCurrentRuntimeProductId(),
    system: Boolean(scope.system),
  };
}

function mapOrder(order: OrderLike): PluginCommerceOrder {
  return {
    id: order.id,
    orderType: order.orderType,
    provider: order.provider,
    providerOrderId: order.providerOrderId,
    amount: order.amount,
    currency: order.currency,
    status: order.status,
    planId: order.planId,
    relatedOrderId: order.relatedOrderId,
    metadata: order.metadata as Record<string, unknown> | null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

function assertOrderReplayMatches(
  scope: PluginCommerceHostScope,
  order: OrderLike,
  input: PluginCommerceCreateOrderInput & { metadata: Record<string, unknown> },
  expected: {
    userId: string;
    provider: string;
    providerOrderId: string;
    orderType: string;
    amount: string | null;
    currency: string;
    status: string;
  }
) {
  const mismatches: string[] = [];

  if (order.userId !== expected.userId) mismatches.push('userId');
  if (order.provider !== expected.provider) mismatches.push('provider');
  if (order.providerOrderId !== expected.providerOrderId) mismatches.push('providerOrderId');
  if (order.orderType !== expected.orderType) mismatches.push('orderType');
  if ((order.amount ?? null) !== expected.amount) mismatches.push('amount');
  if ((order.currency ?? null) !== expected.currency) mismatches.push('currency');
  if (order.status !== expected.status) mismatches.push('status');
  if (stableStringify(order.metadata ?? {}) !== stableStringify(input.metadata)) {
    mismatches.push('metadata');
  }

  if (mismatches.length > 0) {
    throw createIdempotencyConflictError({
      pluginId: scope.pluginId,
      orderId: order.id,
      provider: expected.provider,
      providerOrderId: expected.providerOrderId,
      mismatches,
    });
  }
}

async function resolveCreditScope(
  capabilityScope: PluginCapabilityScope,
  requestedScope: PluginCreditScope | undefined,
  capability: string
): Promise<CreditAccountScope> {
  if (!requestedScope || requestedScope.type === 'user') {
    const userId = requestedScope?.type === 'user' ? requestedScope.id?.trim() : undefined;
    const resolvedUserId = userId || capabilityScope.user?.id;
    if (!resolvedUserId) throw createInputError('Commerce credit user scope');
    assertName(resolvedUserId, 'Commerce credit user scope id');
    await assertResourceScopeAccess(
      capabilityScope,
      { type: 'user', id: resolvedUserId },
      'write',
      capability
    );
    return { type: 'user', id: resolvedUserId };
  }

  if (requestedScope.type === 'workspace') {
    const workspaceId = requestedScope.id.trim();
    assertName(workspaceId, 'Commerce credit workspace scope id');
    await assertResourceScopeAccess(
      capabilityScope,
      { type: 'workspace', id: workspaceId },
      'write',
      capability
    );
    return { type: 'workspace', id: workspaceId };
  }

  if (!capabilityScope.system && capabilityScope.user?.role !== 'admin') {
    throw new PluginError({
      code: 'PLUGIN_COMMERCE_SCOPE_FORBIDDEN',
      message: `${capability} requires admin or system context for product/plugin credit scopes.`,
      statusCode: 403,
      details: {
        pluginId: capabilityScope.contract.id,
      },
    });
  }

  if (requestedScope.type === 'product') {
    const productId = requestedScope.id?.trim() || getCurrentRuntimeProductId();
    assertName(productId, 'Commerce credit product scope id');
    return { type: 'product', id: productId };
  }

  const pluginId = requestedScope.id?.trim() || capabilityScope.contract.id;
  assertName(pluginId, 'Commerce credit plugin scope id');
  return { type: 'plugin', id: pluginId };
}

function addCommerceMetadata(
  scope: PluginCommerceHostScope,
  metadata: Record<string, unknown>,
  input: {
    entitlementKey?: string;
    creditAmount?: number;
    creditMetric?: string;
    creditScope?: CreditAccountScope;
  }
) {
  const enriched = {
    ...metadata,
    pluginId: scope.pluginId,
    productId: scope.productId,
    entitlementKey: input.entitlementKey,
    creditAmount: input.creditAmount,
    creditMetric: input.creditMetric,
    creditScopeType: input.creditScope?.type,
    creditScopeId: input.creditScope?.id,
  };
  return Object.fromEntries(
    Object.entries(enriched).filter((entry) => entry[1] !== undefined)
  ) as Record<string, unknown>;
}

const defaultCommerceHost: PluginCommerceHost = {
  async createCheckout(scope, input) {
    const userId = requireUser(scope, 'ctx.commerce.createCheckout');
    const email = requireEmail(scope);

    if (input.mode && input.mode !== 'payment') {
      throw new PluginError({
        code: 'PLUGIN_COMMERCE_CHECKOUT_MODE_UNSUPPORTED',
        message: 'ctx.commerce.createCheckout currently supports one-time payment checkout.',
        statusCode: 400,
      });
    }

    const result = await checkoutService.createOneTimeCheckoutSession({
      userId,
      userEmail: email,
      priceId: input.priceId,
      amount: input.amount,
      currency: input.currency,
      quantity: input.quantity,
      name: input.name,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    });

    return {
      id: result.session.id,
      provider: input.provider ?? 'stripe',
      mode: 'payment',
      url: result.session.url,
      orderId: result.orderId,
      metadata: input.metadata,
    };
  },

  async createOrder(scope, input) {
    const userId = requireUser(scope, 'ctx.commerce.createOrder');
    const provider = input.provider ?? 'local';
    const providerOrderId =
      input.providerOrderId ?? input.idempotencyKey ?? `local:${randomUUID()}`;
    const orderType = input.orderType ?? 'one_time_purchase';
    const amount =
      input.amount === undefined || input.amount === null ? null : String(input.amount);
    const currency = input.currency ?? 'USD';
    const status = input.status ?? 'succeeded';
    const existingOrder = await getOrderByProviderId(provider, providerOrderId);
    if (existingOrder) {
      assertOrderReplayMatches(scope, existingOrder, input, {
        userId,
        provider,
        providerOrderId,
        orderType,
        amount,
        currency,
        status,
      });
    }
    const order =
      existingOrder ??
      (await createOrder({
        userId,
        orderType,
        provider,
        providerOrderId,
        amount: input.amount,
        currency,
        status,
        metadata: input.metadata,
      }));

    if (order.status === 'succeeded' && input.creditAmount && input.creditAmount > 0) {
      const creditScope = {
        type: String(input.metadata.creditScopeType ?? 'user') as CreditAccountScope['type'],
        id: String(input.metadata.creditScopeId ?? userId),
      };
      await applyCreditChange({
        scope: creditScope,
        metric: input.creditMetric ?? getProductPrimaryCreditMetric(),
        operation: 'grant',
        amount: Math.trunc(input.creditAmount),
        pluginId: scope.pluginId,
        userId,
        relatedOrderId: order.id,
        idempotencyKey: `${order.provider}:${order.providerOrderId}:credits`,
        reason: `One-time order ${order.id}`,
        metadata: input.metadata,
        visibleInCreditLog: true,
      });
    }

    if (order.status === 'succeeded' && input.entitlementKey) {
      await grantDigitalEntitlement({
        userId,
        pluginId: scope.pluginId,
        entitlementKey: input.entitlementKey,
        orderId: order.id,
        sourceType: 'one_time_purchase',
        metadata: input.metadata,
        operatorId: scope.userId ?? 'system',
      });
    }

    return mapOrder(order);
  },

  async getOrder(scope, id) {
    const userId = requireUser(scope, 'ctx.commerce.getOrder');
    const order = await getUserOrderById(userId, id);
    return order ? mapOrder(order) : null;
  },

  async listOrders(scope, input) {
    const userId = requireUser(scope, 'ctx.commerce.listOrders');
    const orders = await getUserOrders(userId, input?.limit ?? 50, input?.offset ?? 0);
    return orders.map((order) => mapOrder(order));
  },
};

function resolveHost(host?: Partial<PluginCommerceHost>): PluginCommerceHost {
  return {
    ...defaultCommerceHost,
    ...host,
  };
}

export function createPluginCommerceCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginCommerceOptions = {}
): PluginCommerce {
  const host = resolveHost(options.host);
  const hostScope = createHostScope(scope);

  return {
    async createCheckout(input) {
      enforceCapabilityPermission(scope, Permission.CommerceWrite, 'ctx.commerce.createCheckout');
      if (!isRecord(input)) throw createInputError('Commerce checkout input');
      const checkoutInput = input as PluginCommerceCheckoutInput;
      const metadata = checkoutInput.metadata;
      if (metadata !== undefined) assertMetadata(metadata, 'Commerce checkout metadata');
      const creditAmount = readPositiveNumber(
        checkoutInput.creditAmount,
        'Commerce checkout credit amount'
      );
      const creditMetric = checkoutInput.creditMetric ?? getProductPrimaryCreditMetric();
      const entitlementKey = readOptionalString(
        checkoutInput.entitlementKey,
        'Commerce entitlement key',
        160
      );
      const creditScope = creditAmount
        ? await resolveCreditScope(scope, checkoutInput.scope, 'ctx.commerce.createCheckout')
        : undefined;

      return host.createCheckout(hostScope, {
        ...checkoutInput,
        provider: checkoutInput.provider ?? 'stripe',
        priceId: readOptionalString(checkoutInput.priceId, 'Commerce checkout price ID', 256),
        currency: readOptionalString(checkoutInput.currency, 'Commerce checkout currency', 12),
        name: readOptionalString(checkoutInput.name, 'Commerce checkout name', 160),
        idempotencyKey: readOptionalString(
          checkoutInput.idempotencyKey,
          'Commerce checkout idempotency key',
          200
        ),
        creditAmount,
        creditMetric,
        entitlementKey,
        metadata: addCommerceMetadata(hostScope, metadata ?? {}, {
          entitlementKey,
          creditAmount,
          creditMetric,
          creditScope,
        }),
      });
    },

    async createOrder(input) {
      enforceCapabilityPermission(scope, Permission.CommerceWrite, 'ctx.commerce.createOrder');
      if (!isRecord(input)) throw createInputError('Commerce order input');
      const orderInput = input as PluginCommerceCreateOrderInput;
      const metadata = orderInput.metadata;
      if (metadata !== undefined) assertMetadata(metadata, 'Commerce order metadata');
      const creditAmount = readPositiveNumber(
        orderInput.creditAmount,
        'Commerce order credit amount'
      );
      const creditMetric = orderInput.creditMetric ?? getProductPrimaryCreditMetric();
      const entitlementKey = readOptionalString(
        orderInput.entitlementKey,
        'Commerce entitlement key',
        160
      );
      const creditScope = creditAmount
        ? await resolveCreditScope(scope, orderInput.scope, 'ctx.commerce.createOrder')
        : undefined;

      return host.createOrder(hostScope, {
        ...orderInput,
        entitlementKey,
        creditAmount,
        creditMetric,
        metadata: addCommerceMetadata(hostScope, metadata ?? {}, {
          entitlementKey,
          creditAmount,
          creditMetric,
          creditScope,
        }),
      });
    },

    async getOrder(id) {
      enforceCapabilityPermission(scope, Permission.CommerceRead, 'ctx.commerce.getOrder');
      const orderId = readOptionalString(id, 'Commerce order ID', 160);
      if (!orderId) throw createInputError('Commerce order ID');
      return host.getOrder(hostScope, orderId);
    },

    async listOrders(input) {
      enforceCapabilityPermission(scope, Permission.CommerceRead, 'ctx.commerce.listOrders');
      return host.listOrders(hostScope, {
        limit: input?.limit,
        offset: input?.offset,
      });
    },
  };
}
