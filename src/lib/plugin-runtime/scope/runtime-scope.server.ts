import 'server-only';

import { cache } from 'react';
import { validateDatabaseConfig } from '@/lib/db/config.server';
import { logger } from '@/lib/_core/logger';
import { pluginQueryService } from '@/lib/plugins/plugin-query.server';
import { pluginRuntimeRegistry } from '@/lib/plugin-runtime/registry';
import type { PluginRuntimeContract } from '@/lib/plugin-runtime/contract';
import {
  getPluginRuntimeMapEntry,
  listPluginRuntimeIdsForProduct,
  type PluginRuntimeMapEntry,
} from '@/lib/plugin-runtime/loader';
import { getCurrentRuntimeProductId } from '@/lib/plugin-runtime/product-context.server';

export type RuntimeSurfaceType =
  | 'navigation'
  | 'theme'
  | 'hook'
  | 'slot'
  | 'hostPageOverride'
  | 'i18n'
  | 'seo'
  | 'sitemap'
  | 'route'
  | 'api'
  | 'job'
  | 'event'
  | 'webhook';

export interface RuntimeScopeInput {
  productId?: string;
  suiteId?: string;
  surface?: RuntimeSurfaceType;
  includeDisabled?: boolean;
}

export interface RuntimePluginRef {
  productId: string;
  suiteId: string;
  bundleIds: readonly string[];
  pluginId: string;
  installationId?: string;
  version?: string;
  enabled: boolean;
  runtimeMapEntry: PluginRuntimeMapEntry;
  contract: PluginRuntimeContract;
}

function contractSupportsSurface(
  contract: PluginRuntimeContract,
  entry: PluginRuntimeMapEntry,
  surface?: RuntimeSurfaceType
): boolean {
  if (!surface) {
    return true;
  }

  switch (surface) {
    case 'navigation':
      return contract.menu.length > 0;
    case 'theme':
      return Boolean(contract.theme);
    case 'hook':
      return Boolean(contract.hooks.renderHead || contract.hooks.sitemap);
    case 'slot':
      return Object.keys(contract.slots ?? {}).length > 0 || (contract.hostPages?.slots.length ?? 0) > 0;
    case 'hostPageOverride':
      return (contract.hostPages?.overrides.length ?? 0) > 0;
    case 'i18n':
      return Object.keys(contract.resources.locales ?? {}).length > 0;
    case 'seo':
      return (
        Boolean(contract.hooks.renderHead) ||
        contract.routes.pages.some((route) => route.publicAliases.length > 0 || route.tool?.seo) ||
        (contract.hostPages?.overrides.length ?? 0) > 0
      );
    case 'sitemap':
      return (
        Boolean(contract.hooks.sitemap) ||
        contract.routes.pages.some(
          (route) => route.publicAliases.length > 0 || route.tool?.sitemap?.include !== false
        )
      );
    case 'route':
      return contract.routes.pages.length > 0;
    case 'api':
      return contract.routes.apis.length > 0 || Boolean(entry.apis && Object.keys(entry.apis).length > 0);
    case 'job':
      return Object.keys(contract.jobs).length > 0;
    case 'event':
      return Boolean(
        contract.events.publishes?.length || Object.keys(contract.events.subscribes ?? {}).length
      );
    case 'webhook':
      return Object.keys(contract.webhooks).length > 0;
  }
}

export class RuntimeScopeService {
  async getEnabledRuntimePlugins(input: RuntimeScopeInput = {}): Promise<RuntimePluginRef[]> {
    const productId = getCurrentRuntimeProductId(input);
    const runtimePluginIds = listPluginRuntimeIdsForProduct(productId);
    const runtimeIdSet = new Set(runtimePluginIds);
    const dbConfig = validateDatabaseConfig();

    if (!dbConfig.valid && !input.includeDisabled) {
      logger.debug(
        { productId, errors: dbConfig.errors },
        'Runtime plugin lookup skipped without database configuration'
      );
      return [];
    }

    const installations = dbConfig.valid
      ? await pluginQueryService.listInstalledPlugins({ productId })
      : [];
    const installationsByPluginId = new Map(
      installations.map((installation) => [installation.pluginId, installation])
    );
    const candidatePluginIds = input.includeDisabled
      ? runtimePluginIds
      : installations
          .filter((installation) => installation.enabled && installation.installStatus === 'installed')
          .map((installation) => installation.pluginId);

    const refs: RuntimePluginRef[] = [];
    for (const pluginId of candidatePluginIds) {
      if (!runtimeIdSet.has(pluginId)) {
        continue;
      }

      const entry = getPluginRuntimeMapEntry(pluginId);
      if (!entry || (entry.productId ?? productId) !== productId) {
        continue;
      }
      if (input.suiteId && entry.suiteId !== input.suiteId) {
        continue;
      }

      const installation = installationsByPluginId.get(pluginId);
      if (!input.includeDisabled && !installation?.enabled) {
        continue;
      }

      let contract: PluginRuntimeContract;
      try {
        contract = await pluginRuntimeRegistry.getOrLoad(pluginId, entry);
      } catch (error) {
        logger.warn({ pluginId, productId, error }, 'Failed to load runtime plugin contract');
        continue;
      }

      if (!contractSupportsSurface(contract, entry, input.surface)) {
        continue;
      }

      refs.push({
        productId,
        suiteId: entry.suiteId ?? 'default',
        bundleIds: entry.bundleIds ?? [],
        pluginId,
        installationId: installation?.id,
        version: installation?.version,
        enabled: installation?.enabled ?? false,
        runtimeMapEntry: entry,
        contract,
      });
    }

    return refs;
  }

  async listRuntimePluginIds(input: RuntimeScopeInput = {}): Promise<string[]> {
    const refs = await this.getEnabledRuntimePlugins(input);
    return refs.map((ref) => ref.pluginId);
  }

  async isRuntimePluginEnabled(pluginId: string, input: Omit<RuntimeScopeInput, 'surface'> = {}) {
    const productId = getCurrentRuntimeProductId(input);
    const entry = getPluginRuntimeMapEntry(pluginId);
    if (!entry || (entry.productId ?? productId) !== productId) {
      return false;
    }
    if (input.suiteId && entry.suiteId !== input.suiteId) {
      return false;
    }
    const installation = await pluginQueryService.getInstallation(pluginId, { productId });
    return installation?.enabled === true && installation.installStatus === 'installed';
  }
}

export const runtimeScopeService = new RuntimeScopeService();

export const listEnabledRuntimePluginIds = cache(
  async (input: RuntimeScopeInput = {}): Promise<string[]> =>
    runtimeScopeService.listRuntimePluginIds(input)
);
