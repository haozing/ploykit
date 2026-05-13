// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { definePlugin, type PluginDefinition } from '@ploykit/plugin-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { SlotManager } from '@/lib/ui/slots/slot-manager';
import { pluginRuntimeRegistry } from '../registry';
import { listPluginPublicAliasSitemapEntries } from '../public-routes/public-route-sitemap.server';
import {
  assertNoPluginPublicAliasConflicts,
  findPluginPublicAliasConflicts,
} from '../public-routes/public-route-conflicts.server';
import { resolvePluginPublicRouteAlias } from '../public-routes/public-route-resolver.server';
import { listPluginRuntimeAssets, readPluginAsset } from '../assets';
import type { PluginRuntimeMapEntry } from '../loader';

const PLUGIN_COUNT = 24;
const ALIASES_PER_PLUGIN = 3;
const ASSETS_PER_PLUGIN = 2;
const ROUTE_SLOT_TARGET = '/scale-plugin-007/alias-1';
const ROUTE_SLOT_NAME = 'route:/scale-plugin-007/alias-1:main.before';

const tempRoots: string[] = [];

interface SyntheticPluginFixture {
  pluginId: string;
  entry: PluginRuntimeMapEntry;
}

function createSlotComponent(label: string) {
  return function SyntheticSlotComponent() {
    return React.createElement('span', { 'data-slot': label }, label);
  };
}

function createSyntheticPlugin(index: number, tempRoot: string): SyntheticPluginFixture {
  const pluginId = `scale-plugin-${String(index).padStart(3, '0')}`;
  const pluginRoot = path.join(tempRoot, pluginId);
  fs.mkdirSync(path.join(pluginRoot, 'assets'), { recursive: true });

  for (let assetIndex = 0; assetIndex < ASSETS_PER_PLUGIN; assetIndex += 1) {
    fs.writeFileSync(
      path.join(pluginRoot, 'assets', `asset-${assetIndex}.json`),
      JSON.stringify({ pluginId, asset: assetIndex })
    );
  }

  const publicAliases = Array.from({ length: ALIASES_PER_PLUGIN }, (_, aliasIndex) => ({
    path: `/${pluginId}/alias-${aliasIndex}`,
    seo: {
      title: `Synthetic ${pluginId} alias ${aliasIndex}`,
      description: `Synthetic route ${aliasIndex} for ${pluginId}.`,
      canonical: `/${pluginId}/alias-${aliasIndex}`,
    },
    sitemap: {
      changeFrequency: 'weekly' as const,
      priority: 0.4 + aliasIndex / 10,
    },
  }));

  const definition = definePlugin({
    id: pluginId,
    name: `Synthetic ${pluginId}`,
    version: '1.0.0',
    trustLevel: 'trusted',
    routes: {
      pages: [
        {
          path: `/synthetic/${pluginId}`,
          component: './pages/MainPage',
          layout: 'site',
          auth: 'public',
          publicAliases,
        },
      ],
    },
    slots: {
      'header:extra': {
        component: './slots/HeaderBadge',
        priority: 100 + index,
      },
      [`route:/${pluginId}/alias-1:main.before`]: {
        component: './slots/RouteBanner',
        priority: index,
      },
    },
    resources: {
      assets: [
        {
          path: './assets/asset-0.json',
          contentType: 'application/json; charset=utf-8',
          maxBytes: 1024,
          cache: { strategy: 'public', maxAgeSeconds: 60 },
        },
        './assets/asset-1.json',
      ],
    },
  } satisfies PluginDefinition);
  const contract = pluginRuntimeRegistry.registerDefinition(definition, { replace: true });
  const entry: PluginRuntimeMapEntry = {
    rootDir: path.relative(process.cwd(), pluginRoot).replace(/\\/g, '/'),
    runtimeContract: contract,
    slotModules: {
      'slots/HeaderBadge': () => Promise.resolve({ default: createSlotComponent(pluginId) }),
      'slots/RouteBanner': () => Promise.resolve({ default: createSlotComponent(pluginId) }),
    },
  };
  pluginRuntimeRegistry.registerContract(contract, { replace: true, entry });

  return { pluginId, entry };
}

function createSyntheticPlugins(count = PLUGIN_COUNT): SyntheticPluginFixture[] {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ploykit-plugin-scale-'));
  tempRoots.push(tempRoot);
  return Array.from({ length: count }, (_, index) => createSyntheticPlugin(index, tempRoot));
}

function registerConflictPlugin(pluginId: string, aliasPath: string): void {
  pluginRuntimeRegistry.registerDefinition(
    definePlugin({
      id: pluginId,
      name: pluginId,
      version: '1.0.0',
      trustLevel: 'trusted',
      routes: {
        pages: [
          {
            path: `/synthetic/${pluginId}`,
            component: './pages/MainPage',
            layout: 'site',
            auth: 'public',
            publicAliases: [
              {
                path: aliasPath,
                seo: {
                  title: pluginId,
                  description: `Conflict fixture for ${pluginId}.`,
                  canonical: aliasPath,
                },
                sitemap: { include: true },
              },
            ],
          },
        ],
      },
    }),
    { replace: true }
  );
}

beforeEach(() => {
  pluginRuntimeRegistry.clear();
});

afterEach(() => {
  pluginRuntimeRegistry.clear();
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('synthetic plugin scale matrix', () => {
  it('keeps public alias sitemap entries deterministic across many plugins', async () => {
    const fixtures = createSyntheticPlugins();
    const entries = await listPluginPublicAliasSitemapEntries({
      pluginIds: fixtures.map((fixture) => fixture.pluginId),
      locale: 'zh',
    });

    expect(entries).toHaveLength(PLUGIN_COUNT * ALIASES_PER_PLUGIN);
    expect(new Set(entries.map((entry) => entry.url)).size).toBe(entries.length);
    expect(entries[0].url).toContain('/zh/scale-plugin-000/alias-0');
    expect(entries.at(-1)?.url).toContain('/zh/scale-plugin-023/alias-2');
    expect(entries.every((entry) => entry.alternates?.languages?.zh)).toBe(true);
  });

  it('resolves aliases and detects cross-plugin public alias conflicts', async () => {
    const fixtures = createSyntheticPlugins();
    const entries = Object.fromEntries(
      fixtures.map((fixture) => [fixture.pluginId, fixture.entry] as const)
    );

    const match = await resolvePluginPublicRouteAlias('/scale-plugin-007/alias-1', {
      entries,
      enforceInstallation: false,
    });
    expect(match).toMatchObject({
      pluginId: 'scale-plugin-007',
      aliasPath: '/scale-plugin-007/alias-1',
      requestPath: '/scale-plugin-007/alias-1',
    });

    await expect(
      assertNoPluginPublicAliasConflicts({
        pluginIds: fixtures.map((fixture) => fixture.pluginId),
      })
    ).resolves.toBeUndefined();

    registerConflictPlugin('scale-conflict-a', '/scale-conflict/:slug');
    registerConflictPlugin('scale-conflict-b', '/scale-conflict/demo');

    const conflicts = await findPluginPublicAliasConflicts({
      pluginIds: ['scale-conflict-a', 'scale-conflict-b'],
    });
    expect(conflicts).toEqual([
      expect.objectContaining({
        code: 'PLUGIN_PUBLIC_ALIAS_GLOBAL_CONFLICT',
        firstPluginId: 'scale-conflict-a',
        secondPluginId: 'scale-conflict-b',
        samplePath: '/scale-conflict/demo',
      }),
    ]);
  });

  it('registers and renders many global slots plus owned route-scoped slots', async () => {
    const fixtures = createSyntheticPlugins();
    const slotManager = new SlotManager();

    for (const fixture of fixtures) {
      await slotManager.registerFromContract(fixture.pluginId);
    }
    await slotManager.initializeWithPlugins(fixtures.map((fixture) => fixture.pluginId));

    expect(slotManager.getSlotCount('header:extra')).toBe(PLUGIN_COUNT);
    expect(slotManager.getSlotCount(ROUTE_SLOT_NAME)).toBe(1);

    const headerNodes = await slotManager.renderSlot('header:extra');
    const headerMarkup = headerNodes.map((node) => renderToStaticMarkup(node)).join('');
    const routeNodes = await slotManager.renderRouteSlot(ROUTE_SLOT_TARGET, 'main.before');
    const markup = routeNodes.map((node) => renderToStaticMarkup(node)).join('');

    expect(headerNodes).toHaveLength(PLUGIN_COUNT);
    expect(headerMarkup.indexOf('scale-plugin-000')).toBeLessThan(
      headerMarkup.indexOf('scale-plugin-023')
    );
    expect(routeNodes).toHaveLength(1);
    expect(markup).toContain('scale-plugin-007');
  });

  it('keeps declared plugin assets isolated and readable at scale', async () => {
    const fixtures = createSyntheticPlugins();

    for (const fixture of fixtures) {
      const contract = await pluginRuntimeRegistry.getOrLoad(fixture.pluginId);
      const assets = listPluginRuntimeAssets(contract);

      expect(assets).toHaveLength(ASSETS_PER_PLUGIN);
      expect(assets[0]).toMatchObject({
        path: 'assets/asset-0.json',
        contentType: 'application/json; charset=utf-8',
        cacheControl: 'public, max-age=60',
      });

      const read = await readPluginAsset(contract, fixture.entry, 'assets/asset-0.json');
      expect(JSON.parse(Buffer.from(read.body).toString('utf8'))).toEqual({
        pluginId: fixture.pluginId,
        asset: 0,
      });
    }
  });
});
