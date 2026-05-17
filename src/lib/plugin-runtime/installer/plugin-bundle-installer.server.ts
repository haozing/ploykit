import 'server-only';

import { asc, and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client.server';
import {
  appBundleMembers,
  appBundles,
  pluginInstallations,
  type AppBundle,
  type AppBundleMember,
} from '@/lib/db/schema/plugins';
import {
  getPluginRuntimeMapEntry,
  getRuntimeAppBundle,
  type RuntimeAppBundle,
} from '@/lib/plugin-runtime/loader';
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
  type: 'catalog' | 'install' | 'attach' | 'enable' | 'seedInternalService' | 'skip';
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function recordArray(value: unknown): Array<Record<string, unknown>> | undefined {
  return Array.isArray(value)
    ? value.filter((item) => Object.keys(asRecord(item)).length > 0).map(asRecord)
    : undefined;
}

function bundleMetadata(bundle: AppBundle) {
  return asRecord(bundle.metadata);
}

function toRuntimeBundle(bundle: AppBundle, members: AppBundleMember[]): RuntimeAppBundle {
  const metadata = bundleMetadata(bundle);
  const seeds = asRecord(metadata.seeds);

  return {
    id: bundle.id,
    productId: bundle.productId,
    suiteId: bundle.suiteId ?? undefined,
    name: bundle.name,
    version: bundle.version,
    sourceType: bundle.sourceType,
    sourceRef: bundle.sourceRef ?? undefined,
    plugins: members.map((member) => ({
      pluginId: member.pluginId,
      enableByDefault: member.enableByDefault,
      required: member.required,
    })),
    seeds:
      Object.keys(seeds).length > 0
        ? {
            internalServices: recordArray(seeds.internalServices),
            resourceBindings: recordArray(seeds.resourceBindings),
          }
        : undefined,
    healthChecks: recordArray(metadata.healthChecks),
    dependencies: asRecord(metadata.dependencies),
    metadata,
  };
}

type InstalledPlugin = NonNullable<Awaited<ReturnType<typeof pluginQueryService.getInstallation>>>;

function resolveCatalogAttachment(
  installation: InstalledPlugin,
  bundle: RuntimeAppBundle
): { suiteId: string | null; bundleId: string } | null {
  if (bundle.suiteId && installation.suiteId && installation.suiteId !== bundle.suiteId) {
    throw new Error(
      `Plugin "${installation.pluginId}" is already attached to suite "${installation.suiteId}", not "${bundle.suiteId}".`
    );
  }

  const suiteId = bundle.suiteId ?? installation.suiteId ?? null;
  const bundleId = bundle.id;
  const needsSuiteAttach = Boolean(bundle.suiteId && installation.suiteId !== bundle.suiteId);
  const needsBundleAttach = installation.bundleId !== bundleId;

  return needsSuiteAttach || needsBundleAttach ? { suiteId, bundleId } : null;
}

async function getCatalogBundle(
  bundleId: string,
  productId?: string
): Promise<RuntimeAppBundle | null> {
  const conditions = [eq(appBundles.id, bundleId)];
  if (productId) {
    conditions.push(eq(appBundles.productId, productId));
  }

  const [bundle] = await db
    .select()
    .from(appBundles)
    .where(and(...conditions))
    .limit(1);
  if (!bundle) {
    const runtimeBundle = getRuntimeAppBundle(bundleId);
    if (runtimeBundle && (!productId || runtimeBundle.productId === productId)) {
      return runtimeBundle;
    }
    return null;
  }

  const members = await db
    .select()
    .from(appBundleMembers)
    .where(eq(appBundleMembers.bundleId, bundle.id))
    .orderBy(asc(appBundleMembers.sortOrder));

  return toRuntimeBundle(bundle, members);
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
    const bundle = await getCatalogBundle(options.bundleId, options.productId);
    if (!bundle) {
      throw new Error(`Bundle "${options.bundleId}" is not declared in the runtime catalog.`);
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
      const attachment = installation ? resolveCatalogAttachment(installation, bundle) : null;
      steps.push({
        type: installation ? (attachment ? 'attach' : 'skip') : 'install',
        pluginId: plugin.pluginId,
        status: 'planned',
        message: installation
          ? attachment
            ? `Attach installed plugin "${plugin.pluginId}" to bundle "${bundle.id}".`
            : `Plugin "${plugin.pluginId}" is already installed for product "${productId}".`
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
    if (options.dryRun) {
      return this.planBundle(options);
    }

    const bundle = await getCatalogBundle(options.bundleId, options.productId);
    if (!bundle) {
      throw new Error(`Bundle "${options.bundleId}" is not declared in the runtime catalog.`);
    }
    const productId = options.productId ?? bundle.productId;

    const result: PluginBundleApplyResult = {
      productId,
      bundleId: bundle.id,
      dryRun: false,
      steps: [],
    };

    await syncRuntimeCatalog(db, { productIds: [productId] });
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
          suiteId: bundle.suiteId ?? null,
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
        const attachment = resolveCatalogAttachment(installation, bundle);
        if (attachment) {
          await db
            .update(pluginInstallations)
            .set({ ...attachment, updatedAt: new Date() })
            .where(
              and(
                eq(pluginInstallations.productId, productId),
                eq(pluginInstallations.pluginId, plugin.pluginId)
              )
            );
          installation = await pluginQueryService.getInstallation(plugin.pluginId, { productId });
          result.steps.push({
            type: 'attach',
            pluginId: plugin.pluginId,
            status: 'applied',
            message: `Attached installed plugin "${plugin.pluginId}" to bundle "${bundle.id}".`,
          });
        } else {
          result.steps.push({
            type: 'skip',
            pluginId: plugin.pluginId,
            status: 'skipped',
            message: `Plugin "${plugin.pluginId}" is already installed for product "${productId}".`,
          });
        }
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
