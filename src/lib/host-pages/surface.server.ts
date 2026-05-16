import 'server-only';

import { and, eq } from 'drizzle-orm';
import { cache } from 'react';
import { logger } from '@/lib/_core/logger';
import { db } from '@/lib/db/client.server';
import { pluginHostPageOverrides } from '@/lib/db/schema/plugins';
import type { PluginHostPageOverride as PluginHostPageOverrideRow } from '@/lib/db/schema/plugins';
import { pluginRuntimeRegistry } from '@/lib/plugin-runtime/registry';
import {
  getPluginRuntimeMapEntry,
  resolvePluginPageModule,
  resolvePluginSlotModule,
  type PluginModuleLoader,
} from '@/lib/plugin-runtime/loader';
import type {
  PluginRuntimeContract,
  RuntimeHostPageOverride,
  RuntimeHostPageSlot,
} from '@/lib/plugin-runtime/contract';
import { getHostPageDefinition, hostPageSlotName, type HostPageDefinition } from './registry';
import { getCurrentRuntimeProductId } from '@/lib/plugin-runtime/product-context.server';
import { runtimeScopeService } from '@/lib/plugin-runtime/scope';

export interface HostPageSlotRegistration extends RuntimeHostPageSlot {
  pluginId: string;
  contract: PluginRuntimeContract;
  load: PluginModuleLoader;
}

export interface HostPageOverrideRegistration extends RuntimeHostPageOverride {
  pluginId: string;
  contract: PluginRuntimeContract;
  load: PluginModuleLoader;
  activatedAt?: Date;
}

export interface HostPageSurface {
  page: HostPageDefinition;
  slots: HostPageSlotRegistration[];
  override: HostPageOverrideRegistration | null;
}

async function loadEnabledContracts(): Promise<PluginRuntimeContract[]> {
  const slotRefs = await runtimeScopeService.getEnabledRuntimePlugins({ surface: 'slot' });
  const overrideRefs = await runtimeScopeService.getEnabledRuntimePlugins({
    surface: 'hostPageOverride',
  });
  return [...new Map([...slotRefs, ...overrideRefs].map((ref) => [ref.pluginId, ref.contract])).values()];
}

function resolveSlotLoader(pluginId: string, component: string): PluginModuleLoader | null {
  const entry = getPluginRuntimeMapEntry(pluginId) ?? pluginRuntimeRegistry.getEntry(pluginId);
  return entry ? resolvePluginSlotModule(entry, component) : null;
}

function resolveOverrideLoader(pluginId: string, component: string): PluginModuleLoader | null {
  const entry = getPluginRuntimeMapEntry(pluginId) ?? pluginRuntimeRegistry.getEntry(pluginId);
  return entry ? resolvePluginPageModule(entry, component) : null;
}

function contractSlotsForPage(
  contract: PluginRuntimeContract,
  page: HostPageDefinition
): HostPageSlotRegistration[] {
  return (contract.hostPages?.slots ?? [])
    .filter((slot) => slot.page === page.path && page.allowedSlots.includes(slot.position))
    .flatMap((slot) => {
      const load = resolveSlotLoader(contract.id, slot.component);
      if (!load) {
        logger.warn(
          { pluginId: contract.id, component: slot.component, page: page.path },
          'Host page slot component is missing from plugin map'
        );
        return [];
      }

      return [{ ...slot, pluginId: contract.id, contract, load }];
    });
}

async function getActiveOverrideRecord(page: HostPageDefinition) {
  const productId = getCurrentRuntimeProductId();
  const rows = await db
    .select()
    .from(pluginHostPageOverrides)
    .where(
      and(
        eq(pluginHostPageOverrides.productId, productId),
        eq(pluginHostPageOverrides.pagePath, page.path),
        eq(pluginHostPageOverrides.status, 'active')
      )
    )
    .limit(1);

  return rows[0] ?? null;
}

export function listHostPageOverrideCandidatesForContracts(
  page: HostPageDefinition,
  contracts: readonly PluginRuntimeContract[]
) {
  if (!page.allowOverride) {
    return [];
  }

  return contracts
    .flatMap((contract) =>
      (contract.hostPages?.overrides ?? [])
        .filter((override) => override.page === page.path)
        .map((override) => ({ contract, override }))
    )
    .sort((left, right) => left.override.priority - right.override.priority);
}

async function resolveActiveOverride(
  page: HostPageDefinition,
  contracts: readonly PluginRuntimeContract[]
): Promise<HostPageOverrideRegistration | null> {
  if (!page.allowOverride) {
    return null;
  }

  let activeRecord: PluginHostPageOverrideRow | null = null;
  try {
    activeRecord = await getActiveOverrideRecord(page);
  } catch (error) {
    logger.warn({ page: page.path, error }, 'Failed to load active host page override');
  }

  const candidates = listHostPageOverrideCandidatesForContracts(page, contracts);

  if (!activeRecord) {
    return null;
  }

  const selected = candidates.find(
    (candidate) =>
      candidate.contract.id === activeRecord.pluginId &&
      candidate.override.component === activeRecord.componentPath
  );

  if (!selected) {
    return null;
  }

  const load = resolveOverrideLoader(selected.contract.id, selected.override.component);
  if (!load) {
    logger.warn(
      {
        pluginId: selected.contract.id,
        component: selected.override.component,
        page: page.path,
      },
      'Host page override component is missing from plugin map'
    );
    return null;
  }

  return {
    ...selected.override,
    pluginId: selected.contract.id,
    contract: selected.contract,
    load,
    activatedAt: activeRecord.activatedAt,
  };
}

export const resolveHostPageSurface = cache(
  async (pathname: string): Promise<HostPageSurface | null> => {
    const page = getHostPageDefinition(pathname);
    if (!page) {
      return null;
    }

    const contracts = await loadEnabledContracts();
    const slots = contracts
      .flatMap((contract) => contractSlotsForPage(contract, page))
      .sort((left, right) => left.priority - right.priority);
    const override = await resolveActiveOverride(page, contracts);

    return {
      page,
      slots,
      override,
    };
  }
);

export function hostPageSlotKey(
  page: HostPageDefinition,
  position: RuntimeHostPageSlot['position']
): string {
  return hostPageSlotName(page, position);
}
