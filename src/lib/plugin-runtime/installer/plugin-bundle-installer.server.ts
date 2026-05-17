import 'server-only';

import { getPluginRuntimeMapEntry, getRuntimeAppBundle } from '@/lib/plugin-runtime/loader';
import { pluginQueryService } from '@/lib/plugins/plugin-query.server';
import { syncRuntimeCatalog } from '@/lib/plugin-runtime/catalog/runtime-catalog-sync.server';
import { pluginRuntimeInstallerService } from './plugin-runtime-installer.server';
import { handleInternalServiceBindingAction } from '@/lib/plugin-runtime/admin/internal-services.server';
import { pluginRuntimeRegistry } from '@/lib/plugin-runtime/registry';

export interface PluginBundleApplyOptions {
  productId?: string;
  bundleId: string;
  environment?: string;
  enable?: boolean;
  seedInternalServices?: boolean;
  dryRun?: boolean;
  userId?: string;
}

export interface PluginBundleApplyStep {
  type: 'catalog' | 'install' | 'enable' | 'seedInternalService' | 'skip';
  pluginId?: string;
  serviceName?: string;
  ownerType?: string;
  ownerId?: string;
  status: 'planned' | 'applied' | 'skipped';
  message: string;
}

export interface PluginBundleApplyResult {
  productId: string;
  bundleId: string;
  dryRun: boolean;
  steps: PluginBundleApplyStep[];
}

function readSeedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function resolveEnvRef(ref: string | undefined): string | undefined {
  if (!ref) {
    return undefined;
  }
  if (!ref.startsWith('env:')) {
    return ref;
  }
  // Bundle seed refs are host-owned installer inputs, not plugin runtime code.
  // eslint-disable-next-line no-restricted-syntax
  return process.env[ref.slice('env:'.length)];
}

function seedOwnerType(value: unknown): 'plugin' | 'suite' | 'product' {
  return value === 'suite' || value === 'product' ? value : 'plugin';
}

async function findSeedPluginId(
  bundlePlugins: readonly { pluginId: string }[],
  serviceName: string
): Promise<string | undefined> {
  for (const plugin of bundlePlugins) {
    const entry = getPluginRuntimeMapEntry(plugin.pluginId);
    const contract = await pluginRuntimeRegistry.getOrLoad(plugin.pluginId, entry);
    if (contract.services.some((service) => service.name === serviceName)) {
      return plugin.pluginId;
    }
  }

  return bundlePlugins[0]?.pluginId;
}

export class PluginBundleInstallerService {
  async planBundle(options: PluginBundleApplyOptions): Promise<PluginBundleApplyResult> {
    const bundle = getRuntimeAppBundle(options.bundleId);
    if (!bundle) {
      throw new Error(`Bundle "${options.bundleId}" is not declared in the runtime map.`);
    }
    const productId = options.productId ?? bundle.productId;
    if (bundle.productId !== productId) {
      throw new Error(
        `Bundle "${bundle.id}" belongs to product "${bundle.productId}", not "${productId}".`
      );
    }

    const steps: PluginBundleApplyStep[] = [
      {
        type: 'catalog',
        status: 'planned',
        message: 'Synchronize runtime product/suite/bundle catalog.',
      },
    ];

    for (const plugin of bundle.plugins) {
      const installation = await pluginQueryService.getInstallation(plugin.pluginId, { productId });
      steps.push({
        type: installation ? 'skip' : 'install',
        pluginId: plugin.pluginId,
        status: 'planned',
        message: installation
          ? `Plugin "${plugin.pluginId}" is already installed for product "${productId}".`
          : `Install plugin "${plugin.pluginId}".`,
      });
    }

    for (const seed of bundle.seeds?.internalServices ?? []) {
      const serviceName = readSeedString(seed.serviceName);
      if (!serviceName) {
        continue;
      }
      const baseUrl = resolveEnvRef(
        readSeedString(seed.baseUrlRef) ?? readSeedString(seed.baseUrl)
      );
      steps.push({
        type: 'seedInternalService',
        serviceName,
        ownerType: readSeedString(seed.ownerType) ?? 'plugin',
        ownerId: readSeedString(seed.ownerId),
        status: 'planned',
        message: baseUrl
          ? `Seed internal service "${serviceName}".`
          : `Internal service "${serviceName}" seed is missing baseUrl/baseUrlRef.`,
      });
    }

    for (const plugin of bundle.plugins) {
      const installation = await pluginQueryService.getInstallation(plugin.pluginId, { productId });
      if ((options.enable ?? plugin.enableByDefault) && !installation?.enabled) {
        steps.push({
          type: 'enable',
          pluginId: plugin.pluginId,
          status: 'planned',
          message: `Enable plugin "${plugin.pluginId}".`,
        });
      }
    }

    return { productId, bundleId: bundle.id, dryRun: Boolean(options.dryRun), steps };
  }

  async applyBundle(options: PluginBundleApplyOptions): Promise<PluginBundleApplyResult> {
    const bundle = getRuntimeAppBundle(options.bundleId);
    if (!bundle) {
      throw new Error(`Bundle "${options.bundleId}" is not declared in the runtime map.`);
    }
    const productId = options.productId ?? bundle.productId;
    if (options.dryRun) {
      return this.planBundle({ ...options, productId });
    }

    const result: PluginBundleApplyResult = {
      productId,
      bundleId: bundle.id,
      dryRun: false,
      steps: [],
    };

    await syncRuntimeCatalog();
    result.steps.push({
      type: 'catalog',
      status: 'applied',
      message: 'Runtime product/suite/bundle catalog synchronized.',
    });

    const installations = new Map<
      string,
      Awaited<ReturnType<typeof pluginQueryService.getInstallation>>
    >();

    for (const plugin of bundle.plugins) {
      let installation = await pluginQueryService.getInstallation(plugin.pluginId, { productId });
      if (!installation) {
        await pluginRuntimeInstallerService.installPlugin(plugin.pluginId, options.userId, {
          productId,
          bundleId: bundle.id,
        });
        installation = await pluginQueryService.getInstallation(plugin.pluginId, { productId });
        result.steps.push({
          type: 'install',
          pluginId: plugin.pluginId,
          status: 'applied',
          message: `Installed plugin "${plugin.pluginId}".`,
        });
      } else {
        result.steps.push({
          type: 'skip',
          pluginId: plugin.pluginId,
          status: 'skipped',
          message: `Plugin "${plugin.pluginId}" is already installed for product "${productId}".`,
        });
      }
      installations.set(plugin.pluginId, installation);
    }

    if (options.seedInternalServices ?? true) {
      for (const seed of bundle.seeds?.internalServices ?? []) {
        const serviceName = readSeedString(seed.serviceName);
        if (!serviceName) {
          continue;
        }
        const baseUrl = resolveEnvRef(
          readSeedString(seed.baseUrlRef) ?? readSeedString(seed.baseUrl)
        );
        if (!baseUrl) {
          throw new Error(`Internal service seed "${serviceName}" is missing baseUrl/baseUrlRef.`);
        }

        const ownerType = seedOwnerType(seed.ownerType);
        const ownerId = readSeedString(seed.ownerId);
        const pluginId =
          readSeedString(seed.pluginId) ?? (await findSeedPluginId(bundle.plugins, serviceName));
        if (!pluginId) {
          throw new Error(
            `Internal service seed "${serviceName}" has no plugin to validate against.`
          );
        }

        await handleInternalServiceBindingAction(
          {
            action: 'upsert',
            productId,
            pluginId,
            ownerType,
            ownerId,
            serviceName,
            scopeType: 'global',
            scopeId: null,
            environment: options.environment ?? null,
            baseUrl,
            authType: 'none',
            actorClaimsEnabled: Boolean(seed.actorClaimsSecretRef),
            actorClaimsType: 'hmac',
            actorClaimsSecretRef: readSeedString(seed.actorClaimsSecretRef),
            actorClaimsTtlSeconds: 60,
            timeoutMs: 30000,
            retryAttempts: 0,
            retryBackoffMs: 250,
            maxResponseBytes: 10485760,
            healthMethod: 'GET',
            healthExpectedStatus: Number(seed.healthExpectedStatus ?? 200),
            status: 'active',
            metadata: { source: 'bundle-seed', bundleId: bundle.id },
          },
          options.userId
        );
        result.steps.push({
          type: 'seedInternalService',
          serviceName,
          ownerType,
          ownerId,
          status: 'applied',
          message: `Seeded internal service "${serviceName}".`,
        });
      }
    }

    for (const plugin of bundle.plugins) {
      const installation = installations.get(plugin.pluginId);
      if ((options.enable ?? plugin.enableByDefault) && !installation?.enabled) {
        await pluginRuntimeInstallerService.enablePlugin(plugin.pluginId, options.userId, {
          productId,
        });
        result.steps.push({
          type: 'enable',
          pluginId: plugin.pluginId,
          status: 'applied',
          message: `Enabled plugin "${plugin.pluginId}".`,
        });
      } else if (options.enable ?? plugin.enableByDefault) {
        result.steps.push({
          type: 'skip',
          pluginId: plugin.pluginId,
          status: 'skipped',
          message: `Plugin "${plugin.pluginId}" is already enabled for product "${productId}".`,
        });
      }
    }

    return result;
  }
}

export const pluginBundleInstallerService = new PluginBundleInstallerService();
