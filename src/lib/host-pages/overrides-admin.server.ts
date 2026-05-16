import 'server-only';

import { and, eq } from 'drizzle-orm';
import { createHash } from 'crypto';
import { db } from '@/lib/db/client.server';
import { pluginHostPageOverrides, type PluginHostPageOverride } from '@/lib/db/schema/plugins';
import { pluginRuntimeRegistry } from '@/lib/plugin-runtime/registry';
import type { RuntimeHostPageOverride } from '@/lib/plugin-runtime/contract';
import { getCurrentRuntimeProductId } from '@/lib/plugin-runtime/product-context.server';
import { runtimeScopeService } from '@/lib/plugin-runtime/scope';
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
  const refs = await runtimeScopeService.getEnabledRuntimePlugins({ surface: 'hostPageOverride' });
  return refs.map((ref) => ref.contract);
}

export async function listHostPageOverrideCandidates(
  input: {
    pagePath?: HostPagePath;
  } = {}
): Promise<HostPageOverrideCandidate[]> {
  const contracts = await loadEnabledRuntimeContracts();
  const productId = getCurrentRuntimeProductId();
  const pages = input.pagePath
    ? [getHostPageDefinition(input.pagePath)].filter(Boolean)
    : listHostPageDefinitions();
  const activeRows = await db
    .select()
    .from(pluginHostPageOverrides)
    .where(eq(pluginHostPageOverrides.productId, productId));
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

  const productId = getCurrentRuntimeProductId();
  const runtimeRefs = await runtimeScopeService.getEnabledRuntimePlugins({
    productId,
    surface: 'hostPageOverride',
  });
  const runtimeRef = runtimeRefs.find((ref) => ref.pluginId === input.pluginId);
  const enabledPluginIds = runtimeRefs.map((ref) => ref.pluginId);
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
          eq(pluginHostPageOverrides.productId, productId),
          eq(pluginHostPageOverrides.status, 'active')
        )
      );

    return tx
      .insert(pluginHostPageOverrides)
      .values({
        productId,
        suiteId: runtimeRef?.suiteId,
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
        target: [
          pluginHostPageOverrides.productId,
          pluginHostPageOverrides.pluginId,
          pluginHostPageOverrides.pagePath,
        ],
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
  const productId = getCurrentRuntimeProductId();
  const filters = [
    eq(pluginHostPageOverrides.productId, productId),
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
