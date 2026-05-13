import { beforeEach, describe, expect, it } from 'vitest';
import {
  definePlugin,
  type PluginContext,
  type PluginRenderHeadPayload,
  type PluginSitemapPayload,
} from '@ploykit/plugin-sdk';
import { unifiedHookSystem } from '@/lib/bus/hooks/unified-system';
import { normalizePluginRuntimeContract } from '../../contract';
import type { PluginRuntimeMapEntry } from '../../loader';
import { pluginRuntimeRegistry } from '../../registry';
import {
  registerPluginRuntimeHooks,
  unregisterPluginRuntimeHooks,
} from '../plugin-hook-runtime.server';

function createEntry(overrides: Partial<PluginRuntimeMapEntry> = {}): PluginRuntimeMapEntry {
  const contract = normalizePluginRuntimeContract(
    definePlugin({
      id: 'runtime-seo',
      name: 'Runtime SEO',
      version: '1.0.0',
      trustLevel: 'trusted',
      hooks: {
        renderHead: {
          handler: './hooks/render-head',
          priority: 10,
        },
        sitemap: {
          handler: './hooks/sitemap',
        },
      },
    })
  );

  return {
    runtimeContract: contract,
    ...overrides,
  };
}

describe('plugin hook runtime', () => {
  beforeEach(() => {
    unifiedHookSystem.clear();
    pluginRuntimeRegistry.clear();
  });

  it('registers renderHead and sitemap hooks and runs them with plugin context', async () => {
    const handled: unknown[] = [];
    const entry = createEntry({
      hookModules: {
        'hooks/render-head': async () => ({
          default: async (
            ctx: PluginContext,
            payload: PluginRenderHeadPayload,
            metadata: { key: string; hook: string }
          ) => {
            handled.push({
              pluginId: ctx.plugin.id,
              payload,
              metadata,
            });
            return [{ tag: 'meta', attrs: { name: 'description', content: payload.pathname } }];
          },
        }),
        'hooks/sitemap': async () => ({
          handler: async (ctx: PluginContext, payload: PluginSitemapPayload) => {
            handled.push({
              pluginId: ctx.plugin.id,
              baseUrl: payload.baseUrl,
            });
            return [{ url: `${payload.baseUrl}/plugins/runtime-seo`, priority: 0.7 }];
          },
        }),
      },
    });

    const registered = await registerPluginRuntimeHooks('runtime-seo', entry);

    expect(registered).toEqual([
      {
        hook: 'onRenderHead',
        key: 'renderHead',
        handler: './hooks/render-head',
        priority: 10,
      },
      {
        hook: 'onSitemap',
        key: 'sitemap',
        handler: './hooks/sitemap',
        priority: 100,
      },
    ]);

    const headResults = await unifiedHookSystem.execute(
      'onRenderHead',
      {},
      { url: 'https://example.test/page', pathname: '/page' }
    );
    const sitemapEntries = await unifiedHookSystem.executeAndMerge(
      'onSitemap',
      {},
      { baseUrl: 'https://example.test' }
    );

    expect(headResults[0]).toMatchObject({
      success: true,
      pluginId: 'runtime-seo',
      data: [{ tag: 'meta', attrs: { name: 'description', content: '/page' } }],
    });
    expect(sitemapEntries).toEqual([
      { url: 'https://example.test/plugins/runtime-seo', priority: 0.7 },
    ]);
    expect(handled).toEqual([
      {
        pluginId: 'runtime-seo',
        payload: { url: 'https://example.test/page', pathname: '/page' },
        metadata: { key: 'renderHead', hook: 'onRenderHead' },
      },
      {
        pluginId: 'runtime-seo',
        baseUrl: 'https://example.test',
      },
    ]);
  });

  it('unregisters hooks by plugin id', async () => {
    const entry = createEntry({
      hookModules: {
        'hooks/render-head': async () => ({ default: async () => [] }),
        'hooks/sitemap': async () => ({ default: async () => [] }),
      },
    });

    await registerPluginRuntimeHooks('runtime-seo', entry);

    expect(unregisterPluginRuntimeHooks('runtime-seo')).toBe(2);
    expect(unifiedHookSystem.getPluginHooks('runtime-seo')).toEqual([]);
  });

  it('fails when a declared hook handler is missing from the runtime map', async () => {
    await expect(registerPluginRuntimeHooks('runtime-seo', createEntry())).rejects.toMatchObject({
      code: 'PLUGIN_HOOK_HANDLER_NOT_FOUND',
      details: {
        hook: 'renderHead',
        handler: './hooks/render-head',
      },
    });
  });
});
