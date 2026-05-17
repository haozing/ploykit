import { PluginError, type PluginUser } from '@ploykit/plugin-sdk';
import type { PluginRuntimeContract, RuntimeRoute } from '../contract';

export async function enforcePluginCommercialGate(
  contract: PluginRuntimeContract,
  route: RuntimeRoute,
  user: PluginUser | null
): Promise<void> {
  const commercial = route.commercial;
  if (!commercial) {
    return;
  }

  if (!user) {
    throw new PluginError({
      code: 'PLUGIN_AUTH_REQUIRED',
      message: 'Authentication required to access this commercial plugin route.',
      statusCode: 401,
      details: {
        pluginId: contract.id,
        route: route.path,
      },
    });
  }

  if (commercial.plan) {
    const { hasRequiredPlanTier } = await import('@/lib/services/user/user-entitlement-service');
    const allowed = await hasRequiredPlanTier(user.id, commercial.plan);
    if (!allowed) {
      throw new PluginError({
        code: 'PLUGIN_PLAN_REQUIRED',
        message: `Plugin route "${route.path}" requires plan "${commercial.plan}".`,
        statusCode: 402,
        details: {
          pluginId: contract.id,
          route: route.path,
          plan: commercial.plan,
          purchaseUrl: commercial.purchaseUrl,
        },
      });
    }
  }

  if (commercial.license) {
    const { hasFeature } = await import('@/lib/services/user/user-entitlement-service');
    const { hasDigitalEntitlement } =
      await import('@/lib/services/billing/digital-entitlement-service');
    const hasPlanFeature = await hasFeature(user.id, commercial.license).catch(() => false);
    const hasDigitalKey = await hasDigitalEntitlement({
      userId: user.id,
      entitlementKey: commercial.license,
      pluginId: contract.id,
    });

    if (!hasPlanFeature && !hasDigitalKey) {
      throw new PluginError({
        code: 'PLUGIN_LICENSE_REQUIRED',
        message: `Plugin route "${route.path}" requires license "${commercial.license}".`,
        statusCode: 402,
        details: {
          pluginId: contract.id,
          route: route.path,
          license: commercial.license,
          purchaseUrl: commercial.purchaseUrl,
        },
      });
    }
  }
}
