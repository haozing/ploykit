import 'server-only';

import { and, eq } from 'drizzle-orm';
import { createHash } from 'crypto';
import { logger } from '@/lib/_core/logger';
import { db } from '@/lib/db/client.server';
import { pluginHostPageOverrides, type PluginHostPageOverride } from '@/lib/db/schema/plugins';
import { getEnabledPlugins } from '@/lib/bus/hook-helpers.server';
import { pluginRuntimeRegistry } from '@/lib/plugin-runtime/registry';
import type { PluginRuntimeContract } from '@/lib/plugin-runtime/contract';
import type { RuntimeHostPageOverride } from '@/lib/plugin-runtime/contract';
import {
  getHostPageDefinition,
  listHostPageDefinitions,
  type HostPageDefinition,
  type HostPagePath,
} from './registry';
import { listHostPageOverrideCandidatesForContracts } from './surface.server';

export interface HostPageOverrideCandidate {
  page: HostPageDefinition;
  pluginId: string;
  component: string;
  priority: number;
  override: RuntimeHostPageOverride;
  active: boolean;
  activatedAt: Date | null;
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function loadEnabledRuntimeContracts() {
  const pluginIds = await getEnabledPlugins();
  const contracts: PluginRuntimeContract[] = [];

  for (const pluginId of pluginIds) {
    try {
      contracts.push(await pluginRuntimeRegistry.getOrLoad(pluginId));
    } catch (error) {
      logger.warn({ pluginId, error }, 'Failed to load plugin contract for host page candidates');
    }
  }

  return contracts;
}

export async function listHostPageOverrideCandidates(
  input: {
    pagePath?: HostPagePath;
  } = {}
): Promise<HostPageOverrideCandidate[]> {
  const contracts = await loadEnabledRuntimeContracts();
  const pages = input.pagePath
    ? [getHostPageDefinition(input.pagePath)].filter(Boolean)
    : listHostPageDefinitions();
  const activeRows = await db.select().from(pluginHostPageOverrides);
  const activeByPage = new Map(
    activeRows.filter((row) => row.status === 'active').map((row) => [row.pagePath, row] as const)
  );

  return (pages as HostPageDefinition[]).flatMap((page) =>
    listHostPageOverrideCandidatesForContracts(page, contracts).map(({ contract, override }) => {
      const active = activeByPage.get(page.path);
      const isActive =
        active?.pluginId === contract.id && active.componentPath === override.component;

      return {
        page,
        pluginId: contract.id,
        component: override.component,
        priority: override.priority,
        override,
        active: isActive,
        activatedAt: isActive ? active.activatedAt : null,
      };
    })
  );
}

export async function activateHostPageOverride(input: {
  pagePath: HostPagePath;
  pluginId: string;
  component: string;
  activatedBy?: string;
}): Promise<PluginHostPageOverride> {
  const page = getHostPageDefinition(input.pagePath);
  if (!page?.allowOverride) {
    throw new Error(`Host page "${input.pagePath}" cannot be overridden.`);
  }

  const enabledPluginIds = await getEnabledPlugins();
  if (!enabledPluginIds.includes(input.pluginId)) {
    throw new Error(
      `Plugin "${input.pluginId}" must be enabled before activating a host page override.`
    );
  }

  const contract = await pluginRuntimeRegistry.getOrLoad(input.pluginId);
  const override = (contract.hostPages?.overrides ?? []).find(
    (candidate) => candidate.page === page.path && candidate.component === input.component
  );

  if (!override) {
    throw new Error(
      `Plugin "${input.pluginId}" does not declare host page override "${input.component}" for "${page.path}".`
    );
  }

  const now = new Date();
  const [record] = await db.transaction(async (tx) => {
    await tx
      .update(pluginHostPageOverrides)
      .set({ status: 'inactive', updatedAt: now })
      .where(
        and(
          eq(pluginHostPageOverrides.pagePath, page.path),
          eq(pluginHostPageOverrides.status, 'active')
        )
      );

    return tx
      .insert(pluginHostPageOverrides)
      .values({
        pagePath: page.path,
        pluginId: input.pluginId,
        componentPath: input.component,
        mode: override.mode,
        status: 'active',
        priority: override.priority,
        seoHash: stableHash(override.seo),
        i18nHash: stableHash(override.i18n),
        activatedBy: input.activatedBy,
        activatedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [pluginHostPageOverrides.pluginId, pluginHostPageOverrides.pagePath],
        set: {
          componentPath: input.component,
          mode: override.mode,
          status: 'active',
          priority: override.priority,
          seoHash: stableHash(override.seo),
          i18nHash: stableHash(override.i18n),
          activatedBy: input.activatedBy,
          activatedAt: now,
          updatedAt: now,
        },
      })
      .returning();
  });

  return record;
}

export async function deactivateHostPageOverride(input: {
  pagePath: HostPagePath;
  pluginId?: string;
}): Promise<void> {
  const filters = [
    eq(pluginHostPageOverrides.pagePath, input.pagePath),
    eq(pluginHostPageOverrides.status, 'active'),
  ];

  if (input.pluginId) {
    filters.push(eq(pluginHostPageOverrides.pluginId, input.pluginId));
  }

  await db
    .update(pluginHostPageOverrides)
    .set({ status: 'inactive', updatedAt: new Date() })
    .where(and(...filters));
}
