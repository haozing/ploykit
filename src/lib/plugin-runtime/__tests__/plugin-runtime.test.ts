import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineApi, definePlugin, Permission, type PluginApiHandler, z } from '@ploykit/plugin-sdk';
import { handlePluginApiRuntime } from '../adapters/api-adapter.server';
import { runPluginLifecycle } from '../adapters/lifecycle-adapter.server';
import {
  resolveAdminPluginPageRuntime,
  resolvePluginPageRuntime,
} from '../adapters/page-adapter.server';
import {
  normalizePluginRuntimeContract,
  type PluginRuntimeContract,
  type RuntimePluginDefinition,
} from '../contract';
import {
  createPluginToolMetadata,
  listPluginToolSitemapEntries,
  resolvePluginToolRoute,
} from '../tools';
import { clearAnonymousRateLimitStore } from '../anonymous';
import {
  createPluginPublicAliasStructuredDataScripts,
  findPluginPublicAliasConflicts,
  resolvePluginPublicRouteAlias,
} from '../public-routes';
import { pluginRuntimeRegistry } from '../registry';
import type { PluginRuntimeMapEntry } from '../loader';

const entitlementServiceMocks = vi.hoisted(() => ({
  hasRequiredPlanTier: vi.fn(async () => true),
  hasFeature: vi.fn(async () => false),
}));

const digitalEntitlementServiceMocks = vi.hoisted(() => ({
  hasDigitalEntitlement: vi.fn(async () => false),
}));

vi.mock('@/lib/auth/server', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  isAdmin: vi.fn(),
}));

vi.mock('@/lib/plugins/plugin-query.server', () => ({
  pluginQueryService: {
    isEnabled: vi.fn(),
  },
}));

vi.mock('@/lib/services/user/user-entitlement-service', () => entitlementServiceMocks);

vi.mock('@/lib/services/billing/digital-entitlement-service', () => digitalEntitlementServiceMocks);

vi.mock('@/lib/cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cache')>();
  const store = new Map<string, Record<string, unknown>>();

  return {
    ...actual,
    pluginContractCache: {
      get: vi.fn((key: string) => store.get(key)),
      set: vi.fn((key: string, value: Record<string, unknown>) => {
        store.set(key, value);
      }),
      delete: vi.fn((key: string) => store.delete(key)),
      clear: vi.fn(() => {
        store.clear();
      }),
    },
  };
});

import { isAdmin } from '@/lib/auth/permissions';
import { auth } from '@/lib/auth/server';
import { CACHE_KEYS, pluginContractCache } from '@/lib/cache';
import { pluginQueryService } from '@/lib/plugins/plugin-query.server';

function createRuntimeEntry(): PluginRuntimeMapEntry {
  const plugin = definePlugin({
    id: 'runtime-todo',
    name: 'Runtime Todo',
    version: '1.0.0',
    permissions: [Permission.StorageRead],
    data: {
      collections: {
        todos: {
          fields: {
            title: { type: 'string', required: true },
          },
        },
      },
    },
    routes: {
      pages: [
        {
          path: '/',
          component: './pages/Home',
          layout: 'site',
          auth: 'public',
          commercial: {
            plan: 'pro',
            purchaseUrl: '/pricing',
          },
        },
      ],
      apis: [
        {
          path: '/todos',
          handler: './api/todos',
          methods: ['POST'],
          auth: 'public',
          permissions: [Permission.StorageRead],
          commercial: {
            plan: 'pro',
          },
          anonymousPolicy: {
            rateLimit: { bucket: 'ip', limit: 10, window: '1m' },
            allowHighCostActions: false,
          },
        },
      ],
    },
    lifecycle: {
      install: './lifecycle/install',
    },
  });

  const api = defineApi({
    post: async (ctx) => {
      const body = await ctx.request.json(z.object({ title: z.string() }));

      return ctx.json({
        pluginId: ctx.plugin.id,
        title: body.title,
      });
    },
  });

  return {
    plugin: async () => ({ default: plugin }),
    pages: {
      'pages/Home': async () => ({ default: function RuntimeTodoHome() {} }),
    },
    apis: {
      'api/todos': async () => ({ default: api }),
    },
    lifecycleModules: {
      'lifecycle/install': async () => ({
        default: {
          install: vi.fn(),
        },
      }),
    },
  };
}

function createRoutePermissionRuntimeEntry(
  options: {
    apiHandler?: PluginApiHandler;
    contractPermissions?: PluginRuntimeContract['permissions'];
  } = {}
): PluginRuntimeMapEntry {
  const plugin = definePlugin({
    id: 'runtime-permission',
    name: 'Runtime Permission',
    version: '1.0.0',
    permissions: [Permission.StorageWrite],
    routes: {
      pages: [
        {
          path: '/secure',
          component: './pages/Secure',
          auth: 'public',
          permissions: [Permission.StorageWrite],
        },
      ],
      apis: [
        {
          path: '/secure',
          handler: './api/secure',
          auth: 'public',
          methods: ['GET'],
          permissions: [Permission.StorageWrite],
          anonymousPolicy: {
            rateLimit: { bucket: 'ip', limit: 10, window: '1m' },
            allowHighCostActions: false,
          },
        },
      ],
    },
  });
  const contract = normalizePluginRuntimeContract(plugin);
  const apiHandler = options.apiHandler ?? (async (ctx) => ctx.json({ ok: true }));

  return {
    runtimeContract: {
      ...contract,
      permissions: options.contractPermissions ?? [],
    },
    pages: {
      'pages/Secure': async () => ({ default: function RuntimeSecurePage() {} }),
    },
    apis: {
      'api/secure': async () => ({
        default: defineApi({
          get: apiHandler,
        }),
      }),
    },
  };
}

function createAuthApiRuntimeEntry(
  apiHandler: PluginApiHandler = async (ctx) => ctx.json({ ok: true })
): PluginRuntimeMapEntry {
  const plugin = definePlugin({
    id: 'runtime-auth',
    name: 'Runtime Auth',
    version: '1.0.0',
    routes: {
      apis: [
        {
          path: '/private',
          handler: './api/private',
          auth: 'auth',
          methods: ['GET'],
        },
      ],
    },
  });

  return {
    plugin: async () => ({ default: plugin }),
    apis: {
      'api/private': async () => ({
        default: defineApi({
          get: apiHandler,
        }),
      }),
    },
  };
}

function createAdminRuntimeEntry(): PluginRuntimeMapEntry {
  const plugin = definePlugin({
    id: 'runtime-admin',
    name: 'Runtime Admin',
    version: '1.0.0',
    routes: {
      pages: [
        {
          path: '/settings',
          component: './pages/AdminSettings',
          layout: 'dashboard-admin',
          auth: 'admin',
        },
      ],
    },
  });

  return {
    plugin: async () => ({ default: plugin }),
    pages: {
      'pages/AdminSettings': async () => ({ default: function RuntimeAdminSettings() {} }),
    },
  };
}

function createToolRuntimeEntry(): PluginRuntimeMapEntry {
  const plugin = definePlugin({
    id: 'runtime-tools',
    name: 'Runtime Tools',
    version: '1.0.0',
    kind: 'tool',
    routes: {
      tools: [
        {
          path: '/json-format',
          component: './pages/JsonFormatTool',
          seo: {
            title: 'JSON Format Tool',
            description: 'Format JSON online.',
            canonical: '/tools/json-format',
            robots: { index: true, follow: true },
            openGraph: { image: '/og/json-format.png' },
            structuredData: { '@type': 'SoftwareApplication', name: 'JSON Format Tool' },
            locales: {
              zh: {
                title: 'JSON 格式化工具',
                description: '在线格式化 JSON。',
                canonical: '/zh/tools/json-format',
              },
            },
          },
          sitemap: { changeFrequency: 'weekly', priority: 0.8 },
          publicAliases: [
            {
              path: '/json',
              seo: {
                title: 'JSON Format Tool',
                description: 'Format JSON through a plugin-owned alias.',
                canonical: '/json',
                structuredData: {
                  '@context': 'https://schema.org',
                  '@type': 'SoftwareApplication',
                  name: 'JSON Alias',
                },
              },
              sitemap: { changeFrequency: 'weekly', priority: 0.8 },
            },
          ],
          cache: { strategy: 'public', maxAgeSeconds: 3600 },
          anonymousPolicy: {
            rateLimit: { bucket: 'ip', limit: 20, window: '1m' },
            allowHighCostActions: false,
          },
        },
      ],
    },
    menu: {
      location: 'site.header',
      label: 'JSON',
      path: '/json',
    },
    slots: {
      'route:/json:main.before': './slots/JsonBanner',
    },
    theme: {
      tokens: {
        common: {
          colorPrimary: '#0ea5e9',
        },
      },
    },
  });

  return {
    plugin: async () => ({ default: plugin }),
    pages: {
      'pages/JsonFormatTool': async () => ({ default: function RuntimeJsonFormatTool() {} }),
    },
    components: {
      'slots/JsonBanner': async () => ({ default: function JsonBanner() {} }),
    },
  };
}

describe('plugin runtime', () => {
  beforeEach(() => {
    pluginRuntimeRegistry.clear();
    clearAnonymousRateLimitStore();
    vi.clearAllMocks();
    vi.mocked(auth.api.getSession).mockResolvedValue({
      session: { id: 'session-1' },
      user: { id: 'user-1', email: 'user@example.test' },
    } as Awaited<ReturnType<typeof auth.api.getSession>>);
    entitlementServiceMocks.hasRequiredPlanTier.mockResolvedValue(true);
    entitlementServiceMocks.hasFeature.mockResolvedValue(false);
    digitalEntitlementServiceMocks.hasDigitalEntitlement.mockResolvedValue(false);
  });

  it('loads a definePlugin page route and resolves its component module', async () => {
    const entry = createRuntimeEntry();

    const result = await resolvePluginPageRuntime('runtime-todo', [], new Headers(), { entry });
    const loadedModule = (await result.module.load()) as { default?: unknown };

    expect(result.route.path).toBe('/');
    expect(result.route.component).toBe('./pages/Home');
    expect(result.route.commercial).toEqual({
      plan: 'pro',
      purchaseUrl: '/pricing',
    });
    expect(result.localPath).toBe('/');
    expect(result.requestPath).toBe('/plugins/runtime-todo');
    expect(loadedModule.default).toEqual(expect.any(Function));
  });

  it('mirrors runtime contracts into the shared plugin contract cache', async () => {
    const entry = createRuntimeEntry();

    const result = await resolvePluginPageRuntime('runtime-todo', [], new Headers(), { entry });

    expect(pluginContractCache.set).toHaveBeenCalledWith(
      CACHE_KEYS.plugin.contract('runtime-todo'),
      expect.objectContaining({ id: 'runtime-todo' })
    );
    expect(pluginContractCache.get(CACHE_KEYS.plugin.contract('runtime-todo'))).toEqual(
      result.contract
    );
  });

  it('preserves commercial route metadata when normalizing contracts', () => {
    const contract = normalizePluginRuntimeContract(
      definePlugin({
        id: 'commercial-runtime',
        name: 'Commercial Runtime',
        version: '1.0.0',
        routes: {
          pages: [
            {
              path: '/seo',
              component: './pages/Seo',
              commercial: {
                license: 'seo-pro',
                purchaseUrl: '/pricing?plugin=seo',
              },
            },
          ],
          apis: [
            {
              path: '/seo/audit',
              handler: './api/audit',
              methods: ['POST'],
              commercial: {
                plan: 'pro',
              },
            },
          ],
        },
      })
    );

    expect(contract.routes.pages[0]?.commercial).toEqual({
      license: 'seo-pro',
      purchaseUrl: '/pricing?plugin=seo',
    });
    expect(contract.routes.apis[0]?.commercial).toEqual({ plan: 'pro' });
  });

  it('normalizes public tool routes into page routes with SEO metadata', async () => {
    const entry = createToolRuntimeEntry();
    const match = await resolvePluginToolRoute('/tools/json-format', {
      entries: { 'runtime-tools': entry },
      enforceInstallation: false,
    });

    expect(match).toMatchObject({
      pluginId: 'runtime-tools',
      localPath: '/tools/json-format',
      slug: ['tools', 'json-format'],
    });

    const result = await resolvePluginPageRuntime(
      'runtime-tools',
      ['tools', 'json-format'],
      new Headers(),
      {
        entry,
        publicPathPrefix: 'tools',
      }
    );
    expect(result.route).toMatchObject({
      path: '/tools/json-format',
      auth: 'public',
      layout: 'site',
      publicAliases: [
        {
          path: '/json',
          seo: expect.objectContaining({ canonical: '/json' }),
          sitemap: { changeFrequency: 'weekly', priority: 0.8 },
        },
      ],
      tool: {
        cache: { strategy: 'public', maxAgeSeconds: 3600 },
        anonymousPolicy: {
          rateLimit: { bucket: 'ip', limit: 20, window: '1m' },
          allowHighCostActions: false,
        },
      },
    });
    expect(result.requestPath).toBe('/tools/json-format');

    const metadata = createPluginToolMetadata(result.route.tool!, { locale: 'zh' });
    expect(metadata).toMatchObject({
      title: 'JSON 格式化工具',
      description: '在线格式化 JSON。',
      alternates: {
        canonical: 'http://localhost:3000/zh/tools/json-format',
      },
    });
  });

  it('only includes public indexable plugin tools in localized sitemap entries', async () => {
    const entry = createToolRuntimeEntry();
    const contract = normalizePluginRuntimeContract(
      definePlugin({
        id: 'runtime-tools',
        name: 'Runtime Tools',
        version: '1.0.0',
        kind: 'tool',
        routes: {
          tools: [
            {
              path: '/json-format',
              component: './pages/JsonFormatTool',
              seo: {
                title: 'JSON Format Tool',
                description: 'Format JSON online.',
                canonical: '/tools/json-format',
                robots: { index: true, follow: true },
              },
              sitemap: { changeFrequency: 'weekly', priority: 0.8 },
            },
            {
              path: '/private-tool',
              component: './pages/JsonFormatTool',
              auth: 'auth',
              seo: {
                title: 'Private Tool',
                description: 'Must not be indexed.',
                canonical: '/tools/private-tool',
                robots: { index: true, follow: true },
              },
              sitemap: { include: true, priority: 0.5 },
            },
            {
              path: '/noindex-tool',
              component: './pages/JsonFormatTool',
              seo: {
                title: 'Noindex Tool',
                description: 'Must not be indexed.',
                canonical: '/tools/noindex-tool',
                robots: { index: false, follow: true },
              },
              sitemap: { include: true, priority: 0.5 },
            },
          ],
        },
      })
    );

    await pluginRuntimeRegistry.getOrLoad('runtime-tools', {
      ...entry,
      runtimeContract: contract,
    });

    const entries = await listPluginToolSitemapEntries({
      pluginIds: ['runtime-tools'],
      locale: 'zh',
    });

    expect(entries).toEqual([
      expect.objectContaining({
        url: 'http://localhost:3000/zh/tools/json-format',
        changeFrequency: 'weekly',
        priority: 0.8,
        alternates: {
          languages: {
            en: 'http://localhost:3000/en/tools/json-format',
            zh: 'http://localhost:3000/zh/tools/json-format',
          },
        },
      }),
    ]);
  });

  it('resolves plugin-owned public route aliases to the target page route', async () => {
    const entry = createToolRuntimeEntry();
    const match = await resolvePluginPublicRouteAlias('/json', {
      entries: { 'runtime-tools': entry },
      enforceInstallation: false,
    });

    expect(match).toMatchObject({
      pluginId: 'runtime-tools',
      aliasPath: '/json',
      requestPath: '/json',
      slug: ['tools', 'json-format'],
      route: {
        path: '/tools/json-format',
        component: './pages/JsonFormatTool',
      },
    });

    const result = await resolvePluginPageRuntime(match!.pluginId, match!.slug, new Headers(), {
      entry,
      matchedRoute: match!.route,
      requestPathOverride: match!.requestPath,
    });

    expect(result.localPath).toBe('/tools/json-format');
    expect(result.requestPath).toBe('/json');
    expect(await result.module.load()).toMatchObject({ default: expect.any(Function) });
    expect(
      createPluginPublicAliasStructuredDataScripts(match!.route.publicAliases[0])
    ).toMatchObject([
      {
        id: 'plugin-public-alias-structured-data-0',
        json: expect.stringContaining('JSON Alias'),
      },
    ]);
  });

  it('detects global public alias conflicts across plugin contracts', async () => {
    const first = createToolRuntimeEntry();
    const second = createToolRuntimeEntry();

    await pluginRuntimeRegistry.getOrLoad('runtime-tools-a', {
      ...first,
      runtimeContract: {
        ...normalizePluginRuntimeContract(
          definePlugin({
            id: 'runtime-tools-a',
            name: 'Runtime Tools A',
            version: '1.0.0',
            routes: {
              pages: [
                {
                  path: '/a',
                  component: './pages/JsonFormatTool',
                  publicAliases: ['/json/:slug'],
                },
              ],
            },
          })
        ),
      },
    });
    await pluginRuntimeRegistry.getOrLoad('runtime-tools-b', {
      ...second,
      runtimeContract: {
        ...normalizePluginRuntimeContract(
          definePlugin({
            id: 'runtime-tools-b',
            name: 'Runtime Tools B',
            version: '1.0.0',
            routes: {
              pages: [
                {
                  path: '/b',
                  component: './pages/JsonFormatTool',
                  publicAliases: ['/json/[id]'],
                },
              ],
            },
          })
        ),
      },
    });

    await expect(
      findPluginPublicAliasConflicts({
        pluginIds: ['runtime-tools-a', 'runtime-tools-b'],
      })
    ).resolves.toEqual([
      expect.objectContaining({
        code: 'PLUGIN_PUBLIC_ALIAS_GLOBAL_CONFLICT',
        samplePath: '/json/value',
      }),
    ]);
  });

  it('dispatches a definePlugin API route through defineApi with a runtime context', async () => {
    const entry = createRuntimeEntry();
    const request = new Request('https://test.local/api/plugins/runtime-todo/todos', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'ship-runtime' }),
    });

    const response = await handlePluginApiRuntime(request, 'runtime-todo', ['todos'], { entry });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      pluginId: 'runtime-todo',
      title: 'ship-runtime',
    });
    expect(entitlementServiceMocks.hasRequiredPlanTier).toHaveBeenCalledWith('user-1', 'pro');
    expect(response.headers.get('X-Anonymous-RateLimit-Limit')).toBeNull();
  });

  it('returns structured commercial errors for API routes without the required plan', async () => {
    entitlementServiceMocks.hasRequiredPlanTier.mockResolvedValue(false);
    const entry = createRuntimeEntry();
    const request = new Request('https://test.local/api/plugins/runtime-todo/todos', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'blocked-plan' }),
    });

    const response = await handlePluginApiRuntime(request, 'runtime-todo', ['todos'], { entry });
    const payload = await response.json();

    expect(response.status).toBe(402);
    expect(payload).toMatchObject({
      code: 'PLUGIN_PLAN_REQUIRED',
      error: {
        details: {
          pluginId: 'runtime-todo',
          plan: 'pro',
        },
      },
    });
  });

  it('requires auth before checking commercial access on public commercial routes', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const entry = createRuntimeEntry();
    const request = new Request('https://test.local/api/plugins/runtime-todo/todos', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'anonymous-commercial' }),
    });

    const response = await handlePluginApiRuntime(request, 'runtime-todo', ['todos'], { entry });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toMatchObject({
      code: 'PLUGIN_AUTH_REQUIRED',
    });
  });

  it('rate limits anonymous public API routes before loading handlers', async () => {
    const entry = createRoutePermissionRuntimeEntry({
      contractPermissions: [Permission.StorageWrite],
    });

    for (let index = 0; index < 10; index += 1) {
      const request = new Request('https://test.local/api/plugins/runtime-permission/secure', {
        method: 'GET',
        headers: { 'x-forwarded-for': '198.51.100.10' },
      });
      await expect(
        handlePluginApiRuntime(request, 'runtime-permission', ['secure'], {
          entry,
          now: 1000,
        })
      ).resolves.toMatchObject({ status: 200 });
    }

    const blocked = new Request('https://test.local/api/plugins/runtime-permission/secure', {
      method: 'GET',
      headers: { 'x-forwarded-for': '198.51.100.10' },
    });
    const response = await handlePluginApiRuntime(blocked, 'runtime-permission', ['secure'], {
      entry,
      now: 1000,
    });
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload).toMatchObject({
      code: 'PLUGIN_ANONYMOUS_RATE_LIMITED',
      error: {
        details: {
          retryAfter: 60,
        },
      },
    });
  });

  it('blocks anonymous high-cost public API capability calls unless the route opts in', async () => {
    const handler = vi.fn<PluginApiHandler>(async (ctx) => {
      await ctx.connectors.call('demo', { path: '/run' });
      return ctx.json({ ok: true });
    });
    const entry = createRoutePermissionRuntimeEntry({
      apiHandler: handler,
      contractPermissions: [Permission.StorageWrite, Permission.ConnectorsInvoke],
    });
    const request = new Request('https://test.local/api/plugins/runtime-permission/secure', {
      method: 'GET',
    });

    const response = await handlePluginApiRuntime(request, 'runtime-permission', ['secure'], {
      entry,
    });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({
      code: 'PLUGIN_ANONYMOUS_HIGH_COST_FORBIDDEN',
      error: {
        details: {
          action: 'connector',
          routePath: '/secure',
        },
      },
    });
  });

  it('blocks API runtime before loading handlers when the plugin is disabled', async () => {
    vi.mocked(pluginQueryService.isEnabled).mockResolvedValue(false);
    const entry = createRuntimeEntry();
    const request = new Request('https://test.local/api/plugins/runtime-todo/todos', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'blocked' }),
    });
    const apiModuleLoader = vi.spyOn(entry.apis!, 'api/todos');

    const response = await handlePluginApiRuntime(request, 'runtime-todo', ['todos'], {
      entry,
      enforceInstallation: true,
    });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({
      success: false,
      code: 'PLUGIN_DISABLED',
      error: {
        details: {
          pluginId: 'runtime-todo',
        },
      },
    });
    expect(apiModuleLoader).not.toHaveBeenCalled();
  });

  it('returns a structured error when required permissions are missing', async () => {
    const entry = createRuntimeEntry();
    const request = new Request('https://test.local/api/plugins/runtime-todo/todos', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'blocked' }),
    });

    const response = await handlePluginApiRuntime(request, 'runtime-todo', ['todos'], {
      entry,
      requiredPermissions: [Permission.StorageWrite],
    });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({
      success: false,
      code: 'PLUGIN_PERMISSION_MISSING',
      error: {
        details: {
          missing: [Permission.StorageWrite],
        },
      },
    });
  });

  it('returns a structured error when API route permissions are missing', async () => {
    const handler = vi.fn<PluginApiHandler>(async (ctx) => ctx.json({ ok: true }));
    const entry = createRoutePermissionRuntimeEntry({ apiHandler: handler });
    const request = new Request('https://test.local/api/plugins/runtime-permission/secure', {
      method: 'GET',
    });

    const response = await handlePluginApiRuntime(request, 'runtime-permission', ['secure'], {
      entry,
    });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({
      success: false,
      code: 'PLUGIN_PERMISSION_MISSING',
      error: {
        details: {
          missing: [Permission.StorageWrite],
        },
      },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('enforces route permissions for page routes before resolving components', async () => {
    await expect(
      resolvePluginPageRuntime('runtime-permission', ['secure'], new Headers(), {
        entry: createRoutePermissionRuntimeEntry(),
      })
    ).rejects.toMatchObject({
      code: 'PLUGIN_PERMISSION_MISSING',
      details: {
        missing: [Permission.StorageWrite],
      },
    });
  });

  it('blocks page runtime before resolving components when the plugin is disabled', async () => {
    vi.mocked(pluginQueryService.isEnabled).mockResolvedValue(false);
    const entry = createRuntimeEntry();
    const pageModuleLoader = vi.spyOn(entry.pages!, 'pages/Home');

    await expect(
      resolvePluginPageRuntime('runtime-todo', [], new Headers(), {
        entry,
        enforceInstallation: true,
      })
    ).rejects.toMatchObject({
      code: 'PLUGIN_DISABLED',
      details: {
        pluginId: 'runtime-todo',
      },
    });
    expect(pageModuleLoader).not.toHaveBeenCalled();
  });

  it('returns a structured error when API auth is required', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const handler = vi.fn<PluginApiHandler>(async (ctx) => ctx.json({ ok: true }));
    const request = new Request('https://test.local/api/plugins/runtime-auth/private', {
      method: 'GET',
    });

    const response = await handlePluginApiRuntime(request, 'runtime-auth', ['private'], {
      entry: createAuthApiRuntimeEntry(handler),
    });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toMatchObject({
      success: false,
      code: 'PLUGIN_AUTH_REQUIRED',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('enforces admin auth for dashboard-admin page routes', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      session: { id: 'session-1' },
      user: { id: 'user-1', email: 'user@example.test' },
    } as Awaited<ReturnType<typeof auth.api.getSession>>);
    vi.mocked(isAdmin).mockResolvedValue(false);

    await expect(
      resolveAdminPluginPageRuntime('runtime-admin', ['settings'], new Headers(), {
        entry: createAdminRuntimeEntry(),
      })
    ).rejects.toMatchObject({
      code: 'PLUGIN_ADMIN_REQUIRED',
    });
  });

  it('rejects route conflicts after runtime path normalization', () => {
    const conflictedPlugin: RuntimePluginDefinition = {
      id: 'runtime-conflict',
      name: 'Runtime Conflict',
      version: '1.0.0',
      routes: {
        pages: [
          {
            path: '/todos/',
            component: './pages/Todos',
            auth: 'public',
          },
          {
            path: '/todos',
            component: './pages/TodosDuplicate',
            auth: 'public',
          },
        ],
      },
    };

    expect(() => pluginRuntimeRegistry.registerDefinition(conflictedPlugin)).toThrow(
      /PLUGIN_RUNTIME_PAGE_ROUTE_CONFLICT/
    );
  });

  it('rejects overlapping dynamic route patterns during runtime registration', () => {
    const conflictedPlugin: RuntimePluginDefinition = {
      id: 'runtime-dynamic-conflict',
      name: 'Runtime Dynamic Conflict',
      version: '1.0.0',
      routes: {
        pages: [
          {
            path: '/items/:id',
            component: './pages/Item',
            auth: 'public',
          },
          {
            path: '/items/[itemId]',
            component: './pages/ItemDuplicate',
            auth: 'public',
          },
        ],
      },
    };

    expect(() => pluginRuntimeRegistry.registerDefinition(conflictedPlugin)).toThrow(
      /PLUGIN_RUNTIME_PAGE_ROUTE_CONFLICT/
    );
  });

  it('runs declared lifecycle handlers and writes lifecycle audit records', async () => {
    const entry = createRuntimeEntry();
    const lifecycleLogs: unknown[] = [];
    const auditLogs: unknown[] = [];

    const result = await runPluginLifecycle({
      pluginId: 'runtime-todo',
      lifecycle: 'install',
      entry,
      userId: 'admin-1',
      writeLifecycleLog: async (input) => {
        lifecycleLogs.push(input);
      },
      writeAudit: async (input) => {
        auditLogs.push(input);
      },
    });

    expect(result).toMatchObject({
      success: true,
      lifecycle: 'install',
      pluginId: 'runtime-todo',
    });
    expect(lifecycleLogs).toHaveLength(1);
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({
      lifecycle: 'install',
      pluginId: 'runtime-todo',
      userId: 'admin-1',
      success: true,
    });
  });
});
