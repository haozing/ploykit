import {
  Permission,
  PluginError,
  type PluginBilling,
  type PluginBillingGrantPlanInput,
  type PluginBillingGrantPlanResult,
  type PluginBillingPlan,
  type PluginBillingRedeemCodeInput,
  type PluginBillingRedeemCodeResult,
} from '@ploykit/plugin-sdk';
import {
  assertJsonSerializable,
  assertName,
  enforceCapabilityPermission,
  type PluginCapabilityScope,
} from './guards.server';

export interface PluginBillingHostScope {
  pluginId: string;
  userId?: string;
  userRole?: 'admin' | 'user';
  requestId: string;
  system: boolean;
}

export type PluginBillingGrantPlanHostInput = PluginBillingGrantPlanInput & { userId: string };
export type PluginBillingRedeemCodeHostInput = PluginBillingRedeemCodeInput & { userId: string };

export interface PluginBillingHost {
  getCurrentPlan(scope: PluginBillingHostScope): Promise<PluginBillingPlan | null>;
  hasEntitlement(scope: PluginBillingHostScope, feature: string): Promise<boolean>;
  grantPlan(
    scope: PluginBillingHostScope,
    input: PluginBillingGrantPlanHostInput
  ): Promise<PluginBillingGrantPlanResult>;
  redeemCode(
    scope: PluginBillingHostScope,
    input: PluginBillingRedeemCodeHostInput
  ): Promise<PluginBillingRedeemCodeResult>;
}

export interface CreatePluginBillingOptions {
  host?: Partial<PluginBillingHost>;
}

const defaultBillingHost: PluginBillingHost = {
  async getCurrentPlan(scope) {
    if (!scope.userId) {
      return null;
    }

    const { getUserEntitlement } = await import('@/lib/services/user/user-entitlement-service');
    const entitlement = await getUserEntitlement(scope.userId);
    if (!entitlement) {
      return null;
    }

    return {
      id: entitlement.plan.id,
      name: entitlement.plan.name,
      interval: entitlement.billingInterval ?? undefined,
      status: entitlement.status,
      metadata: {
        slug: entitlement.plan.slug,
        features: entitlement.plan.features,
        limits: entitlement.plan.limits,
      },
    };
  },
  async hasEntitlement(scope, feature) {
    if (!scope.userId) {
      return false;
    }

    const { hasFeature, hasRequiredPlanTier } =
      await import('@/lib/services/user/user-entitlement-service');
    const { hasDigitalEntitlement } =
      await import('@/lib/services/billing/digital-entitlement-service');

    if (feature.startsWith('plan:')) {
      return hasRequiredPlanTier(scope.userId, feature.slice('plan:'.length));
    }

    const hasPlanFeature = await hasFeature(scope.userId, feature).catch(() => false);
    if (hasPlanFeature) {
      return true;
    }

    return hasDigitalEntitlement({
      userId: scope.userId,
      pluginId: scope.pluginId,
      entitlementKey: feature,
    });
  },
  async grantPlan(scope, input) {
    if (!scope.system && scope.userRole !== 'admin') {
      throw new PluginError({
        code: 'PLUGIN_BILLING_ADMIN_REQUIRED',
        message: 'ctx.billing.grantPlan requires an admin or system context.',
        statusCode: 403,
        details: {
          pluginId: scope.pluginId,
          requestId: scope.requestId,
        },
      });
    }

    const { upgradeUserPlan } = await import('@/lib/services/user/user-entitlement-service');
    const entitlement = await upgradeUserPlan(input.userId, input.planId, undefined, undefined, {
      operatorId: scope.userId,
      reason: input.reason ?? `Granted by plugin ${scope.pluginId}`,
    });

    return {
      entitlementId: entitlement.id,
      userId: entitlement.userId,
      planId: entitlement.planId,
      status: entitlement.status,
    };
  },
  async redeemCode(scope) {
    throw new PluginError({
      code: 'PLUGIN_BILLING_REDEMPTION_UNAVAILABLE',
      message: `Plugin "${scope.pluginId}" cannot redeem billing codes because no redemption host is configured.`,
      statusCode: 501,
      fix: 'Provide a PluginBillingHost.redeemCode implementation before calling ctx.billing.redeemCode.',
      details: {
        pluginId: scope.pluginId,
        requestId: scope.requestId,
      },
    });
  },
};

function resolveHost(host?: Partial<PluginBillingHost>): PluginBillingHost {
  return {
    ...defaultBillingHost,
    ...host,
  };
}

function createHostScope(scope: PluginCapabilityScope): PluginBillingHostScope {
  return {
    pluginId: scope.contract.id,
    userId: scope.user?.id,
    userRole: scope.user?.role,
    requestId: scope.requestId,
    system: Boolean(scope.system),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createInvalidInputError(label: string, details?: Record<string, unknown>): PluginError {
  return new PluginError({
    code: 'PLUGIN_BILLING_INPUT_INVALID',
    message: `${label} is invalid.`,
    statusCode: 400,
    details,
  });
}

function readRequiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw createInvalidInputError(label, { label });
  }

  const normalized = value.trim();
  if (!normalized) {
    throw createInvalidInputError(label, { label });
  }

  if (normalized.length > maxLength) {
    throw createInvalidInputError(label, { label, maxLength });
  }

  return normalized;
}

function readOptionalString(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw createInvalidInputError(label, { label });
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.length > maxLength) {
    throw createInvalidInputError(label, { label, maxLength });
  }

  return normalized;
}

function assertMetadata(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw createInvalidInputError(label, { label });
  }

  assertJsonSerializable(value, label);
}

function resolveTargetUserId(
  scope: PluginCapabilityScope,
  rawUserId: unknown,
  capability: string
): string {
  const requestedUserId = readOptionalString(rawUserId, 'Billing target user ID', 256);
  const targetUserId = requestedUserId ?? scope.user?.id;

  if (!targetUserId) {
    throw new PluginError({
      code: 'PLUGIN_BILLING_USER_REQUIRED',
      message: `${capability} requires a target user.`,
      statusCode: 401,
      details: {
        pluginId: scope.contract.id,
        capability,
      },
    });
  }

  if (
    requestedUserId &&
    requestedUserId !== scope.user?.id &&
    !scope.system &&
    scope.user?.role !== 'admin'
  ) {
    throw new PluginError({
      code: 'PLUGIN_BILLING_TARGET_FORBIDDEN',
      message: `${capability} cannot target another user from this context.`,
      statusCode: 403,
      details: {
        pluginId: scope.contract.id,
        capability,
        targetUserId,
      },
    });
  }

  return targetUserId;
}

function normalizeGrantPlanInput(
  scope: PluginCapabilityScope,
  input: PluginBillingGrantPlanInput
): PluginBillingGrantPlanHostInput {
  if (!isRecord(input)) {
    throw createInvalidInputError('Billing grant input');
  }

  const metadata = input.metadata;
  if (metadata !== undefined) {
    assertMetadata(metadata, 'Billing grant metadata');
  }

  return {
    planId: readRequiredString(input.planId, 'Billing plan ID', 128),
    userId: resolveTargetUserId(scope, input.userId, 'ctx.billing.grantPlan'),
    reason: readOptionalString(input.reason, 'Billing grant reason', 500),
    metadata,
    idempotencyKey: readOptionalString(input.idempotencyKey, 'Billing idempotency key', 128),
  };
}

function normalizeRedeemCodeInput(
  scope: PluginCapabilityScope,
  input: PluginBillingRedeemCodeInput
): PluginBillingRedeemCodeHostInput {
  if (!isRecord(input)) {
    throw createInvalidInputError('Billing redemption input');
  }

  const metadata = input.metadata;
  if (metadata !== undefined) {
    assertMetadata(metadata, 'Billing redemption metadata');
  }

  return {
    code: readRequiredString(input.code, 'Billing redemption code', 128),
    userId: resolveTargetUserId(scope, input.userId, 'ctx.billing.redeemCode'),
    metadata,
    idempotencyKey: readOptionalString(input.idempotencyKey, 'Billing idempotency key', 128),
  };
}

export function createPluginBillingCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginBillingOptions = {}
): PluginBilling {
  const host = resolveHost(options.host);

  return {
    async getCurrentPlan() {
      enforceCapabilityPermission(scope, Permission.BillingRead, 'ctx.billing.getCurrentPlan');

      return host.getCurrentPlan(createHostScope(scope));
    },

    async hasEntitlement(feature) {
      enforceCapabilityPermission(scope, Permission.BillingRead, 'ctx.billing.hasEntitlement');
      assertName(feature, 'Billing entitlement');

      return host.hasEntitlement(createHostScope(scope), feature);
    },

    async grantPlan(input) {
      enforceCapabilityPermission(scope, Permission.BillingWrite, 'ctx.billing.grantPlan');

      return host.grantPlan(createHostScope(scope), normalizeGrantPlanInput(scope, input));
    },

    async redeemCode(input) {
      enforceCapabilityPermission(scope, Permission.BillingWrite, 'ctx.billing.redeemCode');

      return host.redeemCode(createHostScope(scope), normalizeRedeemCodeInput(scope, input));
    },
  };
}
