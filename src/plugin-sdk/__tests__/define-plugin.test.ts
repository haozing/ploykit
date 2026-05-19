import { describe, expect, it } from 'vitest';
import {
  defineApi,
  definePlugin,
  Permission,
  PluginError,
  validatePluginDefinition,
  z,
} from '@ploykit/plugin-sdk';
import { usePluginApi } from '@ploykit/plugin-sdk/react';
import {
  createPluginTestHost,
  createPluginTestHostStore,
  testPlugin,
} from '@ploykit/plugin-sdk/testing';
import { todoPlugin } from '../examples/todo-plugin';

describe('plugin SDK contract helpers', () => {
  it('defines a single-entry plugin contract for a generated plugin', () => {
    const plugin = definePlugin({
      id: 'todo',
      name: 'Todo',
      version: '1.0.0',
      kind: 'tool',
      permissions: [
        Permission.StorageRead,
        Permission.StorageWrite,
        Permission.UiToast,
        Permission.NavigationExtend,
      ],
      data: {
        collections: {
          todos: {
            fields: {
              title: 'string',
              done: 'boolean',
              priority: 'string?',
            },
          },
        },
      },
      routes: {
        pages: [
          { path: '/', component: './ui/page', auth: 'auth' },
          { path: '/items/:id', component: './ui/item', auth: 'auth' },
        ],
        apis: [{ path: '/todos', handler: './api', auth: 'auth', methods: ['GET', 'POST'] }],
      },
      hooks: {
        renderHead: { handler: './hooks/render-head', priority: 20 },
        sitemap: { handler: './hooks/sitemap' },
      },
      slots: {
        'header:extra': './slots/HeaderBadge',
        'route:/items/:id:main.before': './slots/ItemBanner',
        'site.home:main.after': [
          './slots/HomePromo',
          { component: './slots/HomeSurvey', priority: 80 },
        ],
      },
      menu: {
        location: 'dashboard.sidebar',
        label: 'Todo',
        icon: 'CheckSquare',
        path: '/',
      },
      theme: {
        tokens: {
          common: {
            colorPrimary: '#0ea5e9',
          },
          header: {
            sticky: true,
            borderBottom: '1px solid #bae6fd',
          },
        },
      },
    });

    expect(plugin.$$ploykit).toEqual({ type: 'ploykit.plugin', sdkVersion: '0.1.0' });
    expect(plugin.permissions).toContain('storage.read.self');
    expect(plugin.data?.collections?.todos.fields.priority).toBe('string?');
    expect(plugin.hooks?.renderHead?.handler).toBe('./hooks/render-head');
    expect(plugin.slots?.['header:extra']).toBe('./slots/HeaderBadge');
    expect(plugin.slots?.['route:/items/:id:main.before']).toBe('./slots/ItemBanner');
    expect(plugin.theme?.tokens.common?.colorPrimary).toBe('#0ea5e9');
  });

  it('accepts the full todo contract used as the Iteration 8 reference example', () => {
    const diagnostics = validatePluginDefinition(todoPlugin);

    expect(diagnostics).toEqual([]);
    const todoMenu = Array.isArray(todoPlugin.menu) ? todoPlugin.menu[0] : todoPlugin.menu;
    expect(todoMenu).toMatchObject({ labelKey: 'menu.label', fallbackLabel: 'Todo' });
    expect(todoPlugin.routes?.pages?.[0]?.layout).toBe('dashboard');
    expect(todoPlugin.data?.collections?.todos.indexes).toHaveLength(2);
    expect(todoPlugin.resources?.locales?.zh).toBe('./locales/zh.json');
    expect(todoPlugin.jobs?.['todo.cleanup']?.handler).toBe('./jobs/cleanup');
    expect(todoPlugin.webhooks?.import.signature).toBe('hmac-sha256');
  });

  it('validates optional service requirement metadata', () => {
    expect(
      validatePluginDefinition({
        id: 'service-optional',
        name: 'Service Optional',
        version: '1.0.0',
        permissions: [Permission.ServicesInvoke],
        serviceRequirements: [
          {
            name: 'core-api',
            methods: ['GET'],
            paths: ['/v1/projects'],
            required: false,
          },
        ],
      })
    ).toEqual([]);

    const diagnostics = validatePluginDefinition({
      id: 'service-invalid',
      name: 'Service Invalid',
      version: '1.0.0',
      permissions: [Permission.ServicesInvoke],
      serviceRequirements: [
        {
          name: 'core-api',
          methods: ['GET'],
          paths: ['/v1/projects'],
          required: 'yes',
        },
      ],
    } as unknown as Parameters<typeof validatePluginDefinition>[0]);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'PLUGIN_SERVICE_REQUIRED_INVALID'
    );
  });

  it('rejects invalid plugin identity and ambiguous API methods early', () => {
    expect(() =>
      definePlugin({
        id: 'Bad_ID',
        name: 'Bad',
        version: '1.0.0',
      })
    ).toThrow(/PLUGIN_ID_INVALID/);

    expect(() =>
      definePlugin({
        id: 'bad-routes',
        name: 'Bad routes',
        version: '1.0.0',
        routes: {
          apis: [
            { path: '/', handler: './api', methods: ['GET'] },
            { path: '/', handler: './api2', methods: ['GET'] },
          ],
        },
      })
    ).toThrow(/PLUGIN_ROUTE_DUPLICATE/);
  });

  it('rejects host-mounted route paths in plugin contracts', () => {
    expect(() =>
      definePlugin({
        id: 'crud',
        name: 'Bad mounted paths',
        version: '1.0.0',
        routes: {
          pages: [{ path: '/dashboard/plugins/crud', component: './pages/CrudPage' }],
          apis: [{ path: '/plugins/crud/items', handler: './api/items' }],
        },
      })
    ).toThrow(/PLUGIN_ROUTE_PATH_NOT_LOCAL/);
  });

  it('accepts commercial metadata on page and API routes', () => {
    const plugin = definePlugin({
      id: 'commercial-routes',
      name: 'Commercial Routes',
      version: '1.0.0',
      routes: {
        pages: [
          {
            path: '/report',
            component: './pages/Report',
            commercial: {
              license: 'seo-pro',
              plan: 'pro',
              purchaseUrl: '/pricing',
            },
          },
        ],
        apis: [
          {
            path: '/report',
            handler: './api/report',
            commercial: {
              plan: 'pro',
            },
          },
        ],
      },
    });

    expect(plugin.routes?.pages?.[0]?.commercial).toEqual({
      license: 'seo-pro',
      plan: 'pro',
      purchaseUrl: '/pricing',
    });
    expect(plugin.routes?.apis?.[0]?.commercial).toEqual({ plan: 'pro' });
  });

  it('accepts first-class public tool routes with SEO, sitemap, cache, and anonymous policy', () => {
    const plugin = definePlugin({
      id: 'tool-routes',
      name: 'Tool Routes',
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
                },
                sitemap: { changeFrequency: 'weekly', priority: 0.8 },
              },
            ],
            cache: { strategy: 'public', maxAgeSeconds: 3600 },
            anonymousPolicy: {
              rateLimit: { bucket: 'ip', limit: 20, window: '1m' },
              maxUploadBytes: 1024 * 1024,
              captcha: 'auto',
              allowHighCostActions: false,
            },
          },
        ],
      },
    });

    expect(plugin.routes?.tools?.[0]?.seo.title).toBe('JSON Format Tool');
    expect(plugin.routes?.tools?.[0]?.publicAliases?.[0]).toMatchObject({ path: '/json' });
    expect(validatePluginDefinition(plugin)).toEqual([]);
  });

  it('validates public route aliases as host-owned routing boundaries', () => {
    const valid = definePlugin({
      id: 'public-aliases',
      name: 'Public Aliases',
      version: '1.0.0',
      permissions: [Permission.NavigationExtend],
      routes: {
        pages: [
          {
            path: '/posts/:slug',
            component: './pages/Post',
            auth: 'public',
            publicAliases: [
              '/blog/:slug',
              {
                path: '/articles/:slug',
                seo: {
                  title: 'Article',
                  description: 'Article page',
                  canonical: '/articles/:slug',
                },
              },
            ],
          },
        ],
      },
      menu: {
        location: 'site.header',
        label: 'Blog',
        path: '/blog/:slug',
      },
    });

    expect(validatePluginDefinition(valid)).toEqual([]);

    const diagnostics = validatePluginDefinition({
      id: 'bad-public-aliases',
      name: 'Bad Public Aliases',
      version: '1.0.0',
      routes: {
        pages: [
          {
            path: '/private',
            component: './pages/Private',
            layout: 'dashboard',
            publicAliases: ['/blog/private'],
          },
          {
            path: '/public',
            component: './pages/Public',
            publicAliases: ['/admin/reports', '/blog/:slug', '/blog/[postId]'],
          },
        ],
      },
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'PLUGIN_PUBLIC_ALIAS_LAYOUT_INVALID',
        'PLUGIN_PUBLIC_ALIAS_RESERVED',
        'PLUGIN_PUBLIC_ALIAS_ROUTE_CONFLICT',
      ])
    );
  });

  it('rejects invalid public tool route contracts', () => {
    const diagnostics = validatePluginDefinition({
      id: 'bad-tool-routes',
      name: 'Bad Tool Routes',
      version: '1.0.0',
      routes: {
        tools: [
          {
            path: '/pdf-compress',
            component: './pages/PdfCompress',
            auth: 'admin' as never,
            seo: {
              title: '',
              description: '',
              canonical: 'https://example.test/pdf-compress',
            },
            sitemap: { priority: 2 },
            cache: { strategy: 'cdn' as never, maxAgeSeconds: -1 },
            anonymousPolicy: {
              rateLimit: { bucket: 'cookie' as never, limit: 0, window: 'soon' },
              captcha: 'sometimes' as never,
            },
          },
        ],
      },
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'PLUGIN_TOOL_ROUTE_AUTH_INVALID',
        'PLUGIN_TOOL_SEO_TITLE_REQUIRED',
        'PLUGIN_TOOL_SEO_DESCRIPTION_REQUIRED',
        'PLUGIN_TOOL_SEO_CANONICAL_INVALID',
        'PLUGIN_TOOL_SITEMAP_PRIORITY_INVALID',
        'PLUGIN_TOOL_CACHE_STRATEGY_INVALID',
        'PLUGIN_TOOL_CACHE_SECONDS_INVALID',
        'PLUGIN_ANONYMOUS_RATE_LIMIT_BUCKET_INVALID',
        'PLUGIN_ANONYMOUS_RATE_LIMIT_INVALID',
        'PLUGIN_ANONYMOUS_RATE_LIMIT_WINDOW_INVALID',
        'PLUGIN_ANONYMOUS_CAPTCHA_INVALID',
      ])
    );
  });

  it('requires anonymousPolicy on public server-executed routes', () => {
    const diagnostics = validatePluginDefinition({
      id: 'public-server-routes',
      name: 'Public Server Routes',
      version: '1.0.0',
      permissions: [Permission.HostPageExtend],
      routes: {
        pages: [
          {
            path: '/posts/:slug',
            component: './pages/Post',
            loader: './loaders/post',
            auth: 'public',
          },
        ],
        tools: [
          {
            path: '/json',
            component: './pages/Json',
            loader: './loaders/json',
            auth: 'public',
            seo: {
              title: 'JSON',
              description: 'JSON tool',
              canonical: '/tools/json',
            },
          },
        ],
      },
      hostPages: {
        slots: [
          {
            page: '/',
            position: 'main.after',
            component: './slots/Home',
            loader: './loaders/home',
          },
        ],
      },
    });

    expect(
      diagnostics.filter(
        (diagnostic) => diagnostic.code === 'PLUGIN_PUBLIC_EXECUTABLE_ANONYMOUS_POLICY_REQUIRED'
      )
    ).toHaveLength(3);
  });

  it('validates declared action meters', () => {
    const valid = definePlugin({
      id: 'meter-contract-check',
      name: 'Meter Contract Check',
      version: '1.0.0',
      meters: [
        {
          id: 'meter-contract-check.api.request',
          unit: 'request',
          defaultCreditCost: 1,
          billable: true,
        },
      ],
    });

    expect(validatePluginDefinition(valid)).toEqual([]);

    const invalid = {
      id: 'meter-contract-check',
      name: 'Meter Contract Check',
      version: '1.0.0',
      meters: [
        { id: 'other.api.request', unit: 'request', defaultCreditCost: -1 },
        { id: 'other.api.request', unit: '' },
      ],
    } as Parameters<typeof validatePluginDefinition>[0];

    expect(validatePluginDefinition(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PLUGIN_METER_NAMESPACE_INVALID' }),
        expect.objectContaining({ code: 'PLUGIN_METER_CREDIT_COST_INVALID' }),
        expect.objectContaining({ code: 'PLUGIN_METER_DUPLICATE' }),
        expect.objectContaining({ code: 'PLUGIN_METER_UNIT_INVALID' }),
      ])
    );
  });

  it('validates static asset declarations for frontend tools', () => {
    const plugin = definePlugin({
      id: 'asset-contract-check',
      name: 'Asset Contract Check',
      version: '1.0.0',
      resources: {
        assets: [
          './assets/icon.png',
          {
            path: './assets/editor.worker.js',
            kind: 'worker',
            contentType: 'application/javascript; charset=utf-8',
            maxBytes: 128 * 1024,
            cache: { strategy: 'public', maxAgeSeconds: 3600 },
          },
          {
            path: './assets/parser.wasm',
            kind: 'wasm',
            contentType: 'application/wasm',
          },
        ],
      },
    });

    expect(validatePluginDefinition(plugin)).toEqual([]);

    const invalid = validatePluginDefinition({
      id: 'asset-contract-check',
      name: 'Asset Contract Check',
      version: '1.0.0',
      resources: {
        assets: [
          './resources/icon.png',
          './assets/parser.wasm',
          { path: './assets/editor.worker.js', kind: 'asset' },
          { path: './assets/huge.png', maxBytes: -1 },
        ],
      },
    });

    expect(invalid.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'PLUGIN_ASSET_PATH_INVALID',
        'PLUGIN_ASSET_WASM_DECLARATION_REQUIRED',
        'PLUGIN_ASSET_WORKER_DECLARATION_REQUIRED',
        'PLUGIN_ASSET_SIZE_INVALID',
      ])
    );
  });

  it('allows the same plugin-local page path in public and admin areas', () => {
    const plugin = definePlugin({
      id: 'split-area-pages',
      name: 'Split Area Pages',
      version: '1.0.0',
      routes: {
        pages: [
          { path: '/', component: './pages/PublicPage', auth: 'auth', layout: 'dashboard' },
          {
            path: '/',
            component: './pages/AdminPage',
            auth: 'admin',
            layout: 'dashboard-admin',
          },
        ],
      },
    });

    expect(plugin.routes?.pages).toHaveLength(2);
  });

  it('rejects invalid commercial route metadata', () => {
    const diagnostics = validatePluginDefinition({
      id: 'bad-commercial-routes',
      name: 'Bad Commercial Routes',
      version: '1.0.0',
      routes: {
        pages: [
          {
            path: '/report',
            component: './pages/Report',
            commercial: {
              license: '',
              purchaseUrl: 'javascript:alert(1)',
            },
          },
        ],
        apis: [
          {
            path: '/report',
            handler: './api/report',
            commercial: {
              plan: ' ',
            },
          },
        ],
      },
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'PLUGIN_ROUTE_LICENSE_INVALID',
        'PLUGIN_ROUTE_PURCHASE_URL_INVALID',
        'PLUGIN_ROUTE_PLAN_INVALID',
      ])
    );
  });

  it('rejects route patterns that can match the same runtime request', () => {
    const diagnostics = validatePluginDefinition({
      id: 'ambiguous-routes',
      name: 'Ambiguous Routes',
      version: '1.0.0',
      permissions: [Permission.WebhookReceive],
      routes: {
        pages: [
          { path: '/items/:id', component: './pages/Item', layout: 'dashboard' },
          { path: '/items/[itemId]', component: './pages/ItemDuplicate', layout: 'dashboard' },
        ],
        apis: [
          {
            path: '/items/:id',
            handler: './api/item',
            methods: ['GET'],
            auth: 'auth',
          },
          {
            path: '/items/new',
            handler: './api/item-new',
            methods: ['GET'],
            auth: 'auth',
          },
        ],
      },
      webhooks: {
        ingest: {
          path: '/events/[...path]',
          handler: './webhooks/ingest',
          methods: ['POST'],
        },
        provider: {
          path: '/events/:provider',
          handler: './webhooks/provider',
          methods: ['POST'],
        },
      },
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'PLUGIN_RUNTIME_PAGE_ROUTE_CONFLICT',
        'PLUGIN_RUNTIME_API_ROUTE_CONFLICT',
        'PLUGIN_RUNTIME_WEBHOOK_ROUTE_CONFLICT',
      ])
    );
  });

  it('rejects unsafe permissions for ordinary plugins', () => {
    expect(() =>
      definePlugin({
        id: 'unsafe-plugin',
        name: 'Unsafe Plugin',
        version: '1.0.0',
        trustLevel: 'trusted',
        permissions: [Permission.UnsafeSqlRaw],
      })
    ).toThrow(/PLUGIN_UNSAFE_PERMISSION_FORBIDDEN/);
  });

  it('requires explicit permissions for job and webhook declarations', () => {
    expect(() =>
      definePlugin({
        id: 'background-plugin',
        name: 'Background Plugin',
        version: '1.0.0',
        jobs: {
          'background-plugin.sync': {
            handler: './jobs/sync',
          },
        },
      })
    ).toThrow(/PLUGIN_JOB_PERMISSION_MISSING/);

    expect(() =>
      definePlugin({
        id: 'webhook-plugin',
        name: 'Webhook Plugin',
        version: '1.0.0',
        webhooks: {
          ingest: {
            path: '/ingest',
            handler: './webhooks/ingest',
          },
        },
      })
    ).toThrow(/PLUGIN_WEBHOOK_PERMISSION_MISSING/);
  });

  it('requires explicit permissions for event declarations', () => {
    expect(() =>
      definePlugin({
        id: 'publisher-plugin',
        name: 'Publisher Plugin',
        version: '1.0.0',
        events: {
          publishes: ['publisher-plugin.created'],
        },
      })
    ).toThrow(/PLUGIN_EVENT_EMIT_PERMISSION_MISSING/);

    expect(() =>
      definePlugin({
        id: 'subscriber-plugin',
        name: 'Subscriber Plugin',
        version: '1.0.0',
        events: {
          subscribes: {
            'platform.user.created': './events/user-created',
          },
        },
      })
    ).toThrow(/PLUGIN_EVENT_SUBSCRIBE_PERMISSION_MISSING/);
  });

  it('validates declared render and sitemap hooks', () => {
    const diagnostics = validatePluginDefinition({
      id: 'seo-plugin',
      name: 'SEO Plugin',
      version: '1.0.0',
      hooks: {
        renderHead: { handler: './hooks/render-head', priority: 10 },
        sitemap: { handler: './hooks/sitemap' },
      },
    });

    expect(diagnostics).toEqual([]);

    expect(() =>
      definePlugin({
        id: 'bad-hook-plugin',
        name: 'Bad Hook Plugin',
        version: '1.0.0',
        hooks: {
          renderHead: { handler: '../outside', priority: -1 },
        },
      })
    ).toThrow(/PLUGIN_MODULE_PATH_INVALID/);
  });

  it('validates declared UI slots', () => {
    const diagnostics = validatePluginDefinition({
      id: 'ui-plugin',
      name: 'UI Plugin',
      version: '1.0.0',
      routes: {
        pages: [{ path: '/landing', component: './pages/Landing' }],
      },
      slots: {
        'header:extra': './slots/HeaderExtra',
        'site.home:main.after': { component: './slots/HomeAfter', priority: 20 },
        'route:/landing:main.before': './slots/LandingBefore',
      },
    });

    expect(diagnostics).toEqual([]);

    expect(() =>
      definePlugin({
        id: 'bad-slot-plugin',
        name: 'Bad Slot Plugin',
        version: '1.0.0',
        slots: {
          'header:missing': { component: '../outside', priority: -1 },
        },
      } as Parameters<typeof definePlugin>[0])
    ).toThrow(/PLUGIN_SLOT_NAME_INVALID/);

    expect(() =>
      definePlugin({
        id: 'bad-slot-priority',
        name: 'Bad Slot Priority',
        version: '1.0.0',
        slots: {
          'header:extra': { component: './slots/HeaderExtra', priority: -1 },
        },
      })
    ).toThrow(/PLUGIN_SLOT_PRIORITY_INVALID/);

    expect(() =>
      definePlugin({
        id: 'bad-route-slot',
        name: 'Bad Route Slot',
        version: '1.0.0',
        slots: {
          'route:/missing:main.before': './slots/Missing',
        },
      })
    ).toThrow(/PLUGIN_ROUTE_SLOT_ROUTE_UNKNOWN/);
  });

  it('accepts first-class host page slots and overrides', () => {
    const plugin = definePlugin({
      id: 'home-override',
      name: 'Home Override',
      version: '1.0.0',
      trustLevel: 'trusted',
      permissions: [Permission.HostPageExtend, Permission.HostPageOverride],
      resources: {
        locales: {
          en: './locales/en.json',
          zh: './locales/zh.json',
        },
      },
      hostPages: {
        slots: [
          {
            page: '/',
            position: 'hero.before',
            component: './slots/HomeHeroBefore',
            priority: 10,
          },
        ],
        overrides: [
          {
            page: '/',
            mode: 'main.replace',
            component: './pages/HomeOverride',
            shell: {
              layout: 'site',
              header: 'host',
              footer: 'host',
              container: 'fixed',
              activeMenuPath: '/',
            },
            i18n: {
              namespaces: ['homeOverride'],
              requiredLocales: ['en', 'zh'],
            },
            seo: {
              titleKey: 'homeOverride.seo.title',
              descriptionKey: 'homeOverride.seo.description',
              canonical: '/',
              robots: { index: true, follow: true },
              openGraph: {
                image: '/plugins/home-override/og/home.png',
              },
            },
            cache: { strategy: 'public', maxAgeSeconds: 300 },
          },
        ],
      },
    });

    expect(validatePluginDefinition(plugin)).toEqual([]);
    expect(plugin.hostPages?.overrides?.[0]?.shell?.header).toBe('host');
  });

  it('rejects host page overrides without permission, trust, SEO, and i18n contract', () => {
    const diagnostics = validatePluginDefinition({
      id: 'bad-host-page',
      name: 'Bad Host Page',
      version: '1.0.0',
      hostPages: {
        slots: [
          {
            page: '/admin',
            position: 'main.replace',
            component: './slots/Bad',
          },
        ],
        overrides: [
          {
            page: '/',
            mode: 'main.replace',
            component: './pages/Home',
          },
        ],
      },
    } as unknown as Parameters<typeof validatePluginDefinition>[0]);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'PLUGIN_HOST_PAGE_EXTEND_PERMISSION_REQUIRED',
        'PLUGIN_HOST_PAGE_SLOT_POSITION_FORBIDDEN',
        'PLUGIN_HOST_PAGE_OVERRIDE_PERMISSION_REQUIRED',
        'PLUGIN_HOST_PAGE_OVERRIDE_TRUST_REQUIRED',
        'PLUGIN_HOST_PAGE_SEO_REQUIRED',
        'PLUGIN_HOST_PAGE_I18N_REQUIRED',
      ])
    );
  });

  it('validates controlled plugin theme tokens', () => {
    expect(
      validatePluginDefinition({
        id: 'theme-plugin',
        name: 'Theme Plugin',
        version: '1.0.0',
        trustLevel: 'trusted',
        theme: {
          tokens: {
            common: {
              colorPrimary: '#0ea5e9',
              radius: '8px',
            },
            header: {
              variant: 'solid',
              sticky: true,
            },
          },
        },
      })
    ).toEqual([]);

    expect(
      validatePluginDefinition({
        id: 'bad-theme-plugin',
        name: 'Bad Theme Plugin',
        version: '1.0.0',
        theme: {
          tokens: {
            common: {
              colorPrimary: 'url(javascript:alert(1))',
              radius: 'large',
              unknownToken: 'value',
            } as never,
          },
        },
      }).map((diagnostic) => diagnostic.code)
    ).toEqual(expect.arrayContaining(['PLUGIN_THEME_TOKEN_INVALID', 'PLUGIN_THEME_TOKEN_UNKNOWN']));
  });

  it('returns model-readable diagnostics without throwing', () => {
    const invalidPlugin = {
      id: 'bad_plugin',
      name: '',
      version: '1',
      permissions: ['missing:permission'],
      data: {
        collections: {
          BadTodos: {
            fields: {
              Title: { type: 'varchar' },
            },
            indexes: [{ fields: ['missing_field'] }],
          },
        },
      },
      routes: {
        pages: [
          {
            path: 'relative',
            component: '../outside',
            layout: 'dashboard-admin',
            auth: 'auth',
          },
        ],
      },
      resources: {
        locales: {
          english: '../locales/en.json',
        },
      },
      egress: ['ftp://bad.example.com', 'https://api.example.com/v1'],
      menu: {
        location: 'dashboard.sidebar',
        label: ' ',
        labelKey: 'bad..key',
        fallbackLabel: '',
        path: '/',
      },
    } as unknown as Parameters<typeof validatePluginDefinition>[0];

    const diagnostics = validatePluginDefinition(invalidPlugin);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'PLUGIN_ID_INVALID',
        'PLUGIN_NAME_REQUIRED',
        'PLUGIN_VERSION_INVALID',
        'PLUGIN_PERMISSION_UNKNOWN',
        'PLUGIN_COLLECTION_NAME_INVALID',
        'PLUGIN_COLLECTION_FIELD_NAME_INVALID',
        'PLUGIN_COLLECTION_FIELD_TYPE_INVALID',
        'PLUGIN_COLLECTION_INDEX_FIELD_UNKNOWN',
        'PLUGIN_PATH_NOT_ABSOLUTE',
        'PLUGIN_MODULE_PATH_INVALID',
        'PLUGIN_ROUTE_AUTH_TOO_WEAK',
        'PLUGIN_LOCALE_INVALID',
        'PLUGIN_EGRESS_INVALID',
        'PLUGIN_MENU_LABEL_INVALID',
        'PLUGIN_MENU_I18N_KEY_INVALID',
        'PLUGIN_MENU_FALLBACK_LABEL_INVALID',
      ])
    );

    expect(diagnostics.find((diagnostic) => diagnostic.code === 'PLUGIN_ID_INVALID')).toMatchObject(
      {
        severity: 'error',
        path: 'id',
        fix: expect.stringContaining('todo'),
      }
    );
  });

  it('defines API handlers with zod available from the SDK', async () => {
    const schema = z.object({ title: z.string().min(1) });
    const api = defineApi({
      async post(ctx) {
        const input = await ctx.request.json(schema);
        return ctx.json({ title: input.title });
      },
    });

    expect(api.$$ploykit.type).toBe('ploykit.api');
    expect(typeof api.post).toBe('function');
  });

  it('serializes plugin errors for model-readable repair feedback', () => {
    const error = new PluginError({
      code: 'PLUGIN_PERMISSION_MISSING',
      message: 'Permission missing',
      fix: 'Add Permission.StorageWrite to permissions in plugin.ts.',
    });

    expect(error.toJSON()).toMatchObject({
      success: false,
      code: 'PLUGIN_PERMISSION_MISSING',
      error: {
        fix: 'Add Permission.StorageWrite to permissions in plugin.ts.',
      },
    });
  });

  it('redacts sensitive plugin error details before serialization', () => {
    const error = new PluginError({
      code: 'PLUGIN_RUNTIME_ERROR',
      message: 'Runtime failed',
      details: {
        pluginId: 'seo-pro',
        accessToken: 'secret-token',
        nested: {
          payload: { password: 'secret-password' },
          stack: 'internal stack',
        },
      },
    });

    expect(error.toJSON()).toMatchObject({
      error: {
        details: {
          pluginId: 'seo-pro',
          accessToken: '[REDACTED]',
          nested: {
            payload: '[REDACTED]',
          },
        },
      },
    });
    expect(error.toJSON().error.details?.nested).not.toHaveProperty('stack');
  });

  it('exposes SDK subpath entrypoints for plugin-side helpers', () => {
    const plugin = definePlugin({
      id: 'subpath-check',
      name: 'Subpath check',
      version: '1.0.0',
    });

    const scenario = testPlugin(plugin, () => undefined);

    expect(typeof usePluginApi).toBe('function');
    expect(scenario.plugin.id).toBe('subpath-check');
  });

  it('provides a fake host for plugin smoke tests', async () => {
    const plugin = definePlugin({
      id: 'host-check',
      name: 'Host check',
      version: '1.0.0',
      permissions: [Permission.StorageRead, Permission.StorageWrite, Permission.EventsEmit],
    });
    const api = defineApi({
      async post(ctx) {
        const input = await ctx.request.json(z.object({ title: z.string() }));
        const item = await ctx.storage.collection('items').insert(input);
        await ctx.events.emit('host-check.created', { id: item.id });
        return ctx.json({ item }, { status: 201 });
      },
    });
    const host = createPluginTestHost(plugin, {
      method: 'POST',
      json: { title: 'Hello' },
    });

    const response = await api.post(host.ctx);
    const body = await host.readJson<{ item: { title: string } }>(response);

    expect(response.status).toBe(201);
    expect(body.item.title).toBe('Hello');
    expect(host.getCollection('items')).toHaveLength(1);
    expect(host.state.events).toEqual([
      { event: 'host-check.created', payload: { id: 'items-1' } },
    ]);
  });

  it('enforces permissions in the fake host', async () => {
    const plugin = definePlugin({
      id: 'permission-host-check',
      name: 'Permission Host Check',
      version: '1.0.0',
    });
    const api = defineApi({
      async post(ctx) {
        await ctx.storage.collection('items').insert({ title: 'Denied' });
        return ctx.json({ ok: true });
      },
    });
    const host = createPluginTestHost(plugin, { method: 'POST' });

    await expect(api.post(host.ctx)).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: {
        pluginId: 'permission-host-check',
        capability: 'ctx.storage.collection("items").insert',
        permission: Permission.StorageWrite,
      },
    });
  });

  it('enforces http egress in the fake host', async () => {
    const plugin = definePlugin({
      id: 'http-host-check',
      name: 'HTTP Host Check',
      version: '1.0.0',
      permissions: [Permission.ExternalHttp],
      egress: ['https://api.allowed.test/'],
    });
    const host = createPluginTestHost(plugin);

    await expect(host.ctx.http.fetch('https://api.allowed.test/v1/items')).resolves.toBeInstanceOf(
      Response
    );
    await expect(host.ctx.http.fetch('https://api.blocked.test/v1/items')).rejects.toMatchObject({
      code: 'PLUGIN_HTTP_EGRESS_FORBIDDEN',
      details: {
        pluginId: 'http-host-check',
        origin: 'https://api.blocked.test',
      },
    });
  });

  it('tracks billing and notifications in the fake host', async () => {
    const plugin = definePlugin({
      id: 'commercial-host-check',
      name: 'Commercial Host Check',
      version: '1.0.0',
      permissions: [
        Permission.CreditsRead,
        Permission.CreditsConsume,
        Permission.CreditsWrite,
        Permission.BillingRead,
        Permission.BillingWrite,
        Permission.CommerceRead,
        Permission.CommerceWrite,
        Permission.NotificationsSend,
      ],
    });
    const host = createPluginTestHost(plugin);

    await expect(host.ctx.credits.getBalance()).resolves.toEqual({
      balance: 1000,
      metric: 'platform.credits',
      scope: { type: 'user', id: 'test-user' },
      userId: 'test-user',
    });
    await expect(
      host.ctx.credits.consume({
        meter: 'commercial-host-check.external-api',
        amount: 3,
        idempotencyKey: 'credit-1',
        metadata: { provider: 'example' },
      })
    ).resolves.toMatchObject({
      consumed: true,
      amount: 3,
      balanceBefore: 1000,
      balanceAfter: 997,
      meter: 'commercial-host-check.external-api',
      metric: 'platform.credits',
      scope: { type: 'user', id: 'test-user' },
      userId: 'test-user',
      idempotencyKey: 'credit-1',
    });
    await expect(
      host.ctx.credits.grant({ amount: 5, idempotencyKey: 'grant-1' })
    ).resolves.toMatchObject({
      operation: 'grant',
      balanceBefore: 997,
      balanceAfter: 1002,
    });
    await expect(
      host.ctx.commerce.createOrder({
        amount: 9,
        currency: 'USD',
        creditAmount: 2,
        idempotencyKey: 'order-1',
      })
    ).resolves.toMatchObject({
      provider: 'local',
      status: 'succeeded',
      amount: '9',
    });
    await expect(host.ctx.billing.getCurrentPlan()).resolves.toBeNull();
    await expect(host.ctx.billing.hasEntitlement('feature.export')).resolves.toBe(false);
    await expect(
      host.ctx.billing.grantPlan({ planId: 'pro-plan', reason: 'manual-code' })
    ).resolves.toMatchObject({
      entitlementId: 'entitlement-3',
      userId: 'test-user',
      planId: 'pro-plan',
      status: 'active',
    });
    await expect(
      host.ctx.billing.redeemCode({ code: 'WELCOME-2026', metadata: { source: 'test' } })
    ).resolves.toMatchObject({
      redeemed: true,
      redemptionId: 'redemption-4',
    });
    await expect(host.ctx.notifications.send({ message: 'Ready' })).resolves.toEqual({
      id: 'notification-1',
      queued: false,
    });

    expect(host.state.billing).toEqual([
      { operation: 'getCurrentPlan' },
      { operation: 'hasEntitlement', feature: 'feature.export' },
      {
        operation: 'grantPlan',
        planId: 'pro-plan',
        userId: 'test-user',
        reason: 'manual-code',
        metadata: undefined,
        idempotencyKey: undefined,
      },
      {
        operation: 'redeemCode',
        code: 'WELCOME-2026',
        userId: 'test-user',
        metadata: { source: 'test' },
        idempotencyKey: undefined,
      },
    ]);
    expect(host.state.credits).toEqual([
      {
        operation: 'getBalance',
        metric: 'platform.credits',
        scope: { type: 'user', id: 'test-user' },
        userId: 'test-user',
      },
      {
        operation: 'consume',
        meter: 'commercial-host-check.external-api',
        metric: 'platform.credits',
        amount: 3,
        scope: { type: 'user', id: 'test-user' },
        userId: 'test-user',
        idempotencyKey: 'credit-1',
        balanceBefore: 1000,
        balanceAfter: 997,
        metadata: { provider: 'example' },
      },
      {
        operation: 'grant',
        metric: 'platform.credits',
        amount: 5,
        scope: { type: 'user', id: 'test-user' },
        userId: 'test-user',
        idempotencyKey: 'grant-1',
        balanceBefore: 997,
        balanceAfter: 1002,
        reason: undefined,
        metadata: undefined,
      },
      expect.objectContaining({
        operation: 'grant',
        metric: 'platform.credits',
        amount: 2,
        scope: { type: 'user', id: 'test-user' },
        userId: 'test-user',
      }),
    ]);
    expect(host.state.notifications).toEqual([
      expect.objectContaining({
        id: 'notification-1',
        recipientUserId: 'test-user',
        channel: 'in-app',
        message: 'Ready',
      }),
    ]);
  });

  it('tracks action metering in the fake host', async () => {
    const plugin = definePlugin({
      id: 'metering-host-check',
      name: 'Metering Host Check',
      version: '1.0.0',
      permissions: [Permission.MeteringWrite, Permission.UsageWrite, Permission.CreditsConsume],
      meters: [
        {
          id: 'metering-host-check.ocr.page',
          unit: 'page',
          defaultCreditCost: 2,
          billable: true,
        },
      ],
    });
    const host = createPluginTestHost(plugin);

    await expect(
      host.ctx.metering.authorize({
        meter: 'metering-host-check.ocr.page',
        amount: 3,
        idempotencyKey: 'meter-auth-1',
      })
    ).resolves.toMatchObject({
      authorized: true,
      meter: 'metering-host-check.ocr.page',
      amount: 3,
      unit: 'page',
      creditCost: 6,
    });
    await expect(
      host.ctx.metering.commit({
        meter: 'metering-host-check.ocr.page',
        amount: 2,
        idempotencyKey: 'meter-commit-1',
      })
    ).resolves.toMatchObject({
      meter: 'metering-host-check.ocr.page',
      amount: 2,
      usageId: 'usage-1',
      credits: { amount: 4 },
    });

    expect(host.state.usage).toEqual([
      {
        metric: 'metering-host-check.ocr.page',
        amount: 2,
        options: {
          idempotencyKey: 'meter-commit-1:usage',
          unit: 'page',
          metadata: undefined,
        },
      },
    ]);
    expect(host.state.credits).toEqual([
      expect.objectContaining({
        operation: 'consume',
        meter: 'metering-host-check.ocr.page',
        amount: 4,
        idempotencyKey: 'meter-commit-1:credits',
      }),
    ]);
  });

  it('tracks artifact files in the fake host', async () => {
    const plugin = definePlugin({
      id: 'artifact-host-check',
      name: 'Artifact Host Check',
      version: '1.0.0',
      permissions: [Permission.ArtifactsRead, Permission.ArtifactsWrite],
    });
    const host = createPluginTestHost(plugin);
    const scope = { type: 'workspace' as const, id: 'workspace-1' };

    const written = await host.ctx.artifacts.writeText({
      scope,
      path: 'docs/outline.md',
      content: '# Outline',
      contentType: 'text/markdown',
      metadata: { artifactType: 'outline' },
    });

    await expect(
      host.ctx.artifacts.readText({ scope, path: 'docs/outline.md' })
    ).resolves.toMatchObject({
      id: 'workspace:workspace-1:docs/outline.md',
      content: '# Outline',
      version: 1,
    });
    await expect(host.ctx.artifacts.list({ scope })).resolves.toEqual([
      expect.objectContaining({ path: 'docs/outline.md' }),
    ]);
    await expect(host.ctx.artifacts.tree({ scope })).resolves.toEqual([
      expect.objectContaining({ name: 'outline.md', parentPath: 'docs' }),
    ]);
    await expect(
      host.ctx.artifacts.updateMetadata({
        scope,
        path: 'docs/outline.md',
        metadata: { indexed: true },
      })
    ).resolves.toMatchObject({
      metadata: { artifactType: 'outline', indexed: true },
      version: 2,
    });
    await host.ctx.artifacts.delete({ scope, path: 'docs/outline.md' });

    expect(written).toMatchObject({
      scope,
      path: 'docs/outline.md',
      contentType: 'text/markdown',
      metadata: { artifactType: 'outline' },
    });
    expect(host.state.artifacts).toEqual([
      { operation: 'writeText', scope, path: 'docs/outline.md' },
      { operation: 'readText', scope, path: 'docs/outline.md' },
      { operation: 'list', scope, prefix: undefined },
      { operation: 'tree', scope, prefix: undefined },
      { operation: 'updateMetadata', scope, path: 'docs/outline.md' },
      { operation: 'delete', scope, path: 'docs/outline.md' },
    ]);
  });

  it('tracks RAG indexes in the fake host', async () => {
    const plugin = definePlugin({
      id: 'rag-host-check',
      name: 'RAG Host Check',
      version: '1.0.0',
      permissions: [
        Permission.ArtifactsRead,
        Permission.ArtifactsWrite,
        Permission.RagRead,
        Permission.RagWrite,
      ],
    });
    const host = createPluginTestHost(plugin);
    const scope = { type: 'workspace' as const, id: 'workspace-1' };

    await host.ctx.artifacts.writeText({
      scope,
      path: 'docs/source.md',
      content: 'Alpha planning note.\n\nBeta execution note.',
    });

    await expect(host.ctx.rag.index({ scope, path: 'docs/source.md' })).resolves.toMatchObject({
      scope,
      sourcePath: 'docs/source.md',
      chunkCount: 1,
    });
    await expect(host.ctx.rag.search({ scope, query: 'Beta', topK: 2 })).resolves.toEqual([
      expect.objectContaining({
        sourcePath: 'docs/source.md',
        content: expect.stringContaining('Beta execution'),
      }),
    ]);
    await expect(
      host.ctx.rag.buildContextPack({
        scope,
        query: 'Alpha',
        maxCharacters: 120,
      })
    ).resolves.toMatchObject({
      scope,
      query: 'Alpha',
      content: expect.stringContaining('Alpha planning'),
      characterCount: expect.any(Number),
    });
    await host.ctx.rag.delete({ scope, path: 'docs/source.md' });

    expect(host.state.rag).toEqual([
      {
        operation: 'index',
        scope,
        sourceId: 'workspace:workspace-1:docs/source.md',
        path: 'docs/source.md',
        chunkCount: 1,
      },
      { operation: 'search', scope, query: 'Beta' },
      { operation: 'buildContextPack', scope, query: 'Alpha' },
      {
        operation: 'delete',
        scope,
        sourceId: undefined,
        path: 'docs/source.md',
      },
    ]);
  });

  it('tracks AI calls in the fake host', async () => {
    const plugin = definePlugin({
      id: 'ai-host-check',
      name: 'AI Host Check',
      version: '1.0.0',
      permissions: [Permission.AiGenerate, Permission.AiEmbed],
    });
    const host = createPluginTestHost(plugin);

    await expect(
      host.ctx.ai.generateText({
        prompt: 'Draft outline',
        model: 'test-generate',
        meter: 'ai-host-check.ai.generate',
        creditAmount: 2,
        idempotencyKey: 'ai-1',
        metadata: { workflow: 'outline' },
      })
    ).resolves.toMatchObject({
      text: 'Generated: Draft outline',
      model: 'test-generate',
      provider: 'fake-host',
      usage: { creditsConsumed: 2 },
    });

    const streamEvents = [];
    for await (const event of host.ctx.ai.streamText({
      prompt: 'Stream outline',
      model: 'test-generate',
    })) {
      streamEvents.push(event);
    }
    expect(streamEvents).toEqual([
      expect.objectContaining({ type: 'text-delta', text: 'Generated: Stream outline' }),
      expect.objectContaining({
        type: 'done',
        result: expect.objectContaining({ text: 'Generated: Stream outline' }),
      }),
    ]);

    await expect(
      host.ctx.ai.embedText({
        input: ['Alpha', 'Beta'],
        model: 'test-embed',
        meter: 'ai-host-check.ai.embed',
      })
    ).resolves.toMatchObject({
      embeddings: [
        { index: 0, embedding: expect.any(Array) },
        { index: 1, embedding: expect.any(Array) },
      ],
      model: 'test-embed',
      provider: 'fake-host',
      usage: { creditsConsumed: 1 },
    });

    expect(host.state.ai).toEqual([
      {
        operation: 'generateText',
        model: 'test-generate',
        meter: 'ai-host-check.ai.generate',
        creditAmount: 2,
        idempotencyKey: 'ai-1',
        prompt: 'Draft outline',
        metadata: { workflow: 'outline' },
      },
      {
        operation: 'streamText',
        model: 'test-generate',
        meter: undefined,
        creditAmount: undefined,
        idempotencyKey: undefined,
        prompt: 'Stream outline',
        metadata: undefined,
        response: 'stream',
      },
      {
        operation: 'embedText',
        model: 'test-embed',
        meter: 'ai-host-check.ai.embed',
        creditAmount: undefined,
        idempotencyKey: undefined,
        inputCount: 2,
        metadata: undefined,
      },
    ]);
  });

  it('isolates fake host storage, artifacts, config, and secrets by plugin and user', async () => {
    const store = createPluginTestHostStore();
    const pluginA = definePlugin({
      id: 'isolated-a',
      name: 'Isolated A',
      version: '1.0.0',
      permissions: [
        Permission.StorageRead,
        Permission.StorageWrite,
        Permission.ArtifactsRead,
        Permission.ArtifactsWrite,
        Permission.RagRead,
        Permission.RagWrite,
        Permission.ConfigRead,
        Permission.ConfigWrite,
        Permission.SecretsRead,
        Permission.SecretsWrite,
      ],
    });
    const pluginB = definePlugin({
      id: 'isolated-b',
      name: 'Isolated B',
      version: '1.0.0',
      permissions: pluginA.permissions,
    });

    const userAHost = createPluginTestHost(pluginA, {
      store,
      user: { id: 'user-a', role: 'user' },
    });
    const userBHost = createPluginTestHost(pluginA, {
      store,
      user: { id: 'user-b', role: 'user' },
    });
    const pluginBHost = createPluginTestHost(pluginB, {
      store,
      user: { id: 'user-a', role: 'user' },
    });
    const scope = { type: 'workspace' as const, id: 'workspace-1' };

    await userAHost.ctx.storage.collection('items').insert({ title: 'private' });
    await userAHost.ctx.artifacts.writeText({
      scope,
      path: 'docs/private.md',
      content: 'private',
    });
    await userAHost.ctx.rag.index({
      scope,
      path: 'docs/private.md',
    });
    await userAHost.ctx.config.set?.('theme', 'dark');
    await userAHost.ctx.secrets.set?.('apiKey', 'secret');

    await expect(userAHost.ctx.storage.collection('items').findMany()).resolves.toHaveLength(1);
    await expect(userBHost.ctx.storage.collection('items').findMany()).resolves.toEqual([]);
    await expect(pluginBHost.ctx.storage.collection('items').findMany()).resolves.toEqual([]);
    await expect(userAHost.ctx.artifacts.list({ scope })).resolves.toHaveLength(1);
    await expect(userBHost.ctx.artifacts.list({ scope })).resolves.toEqual([]);
    await expect(pluginBHost.ctx.artifacts.list({ scope })).resolves.toEqual([]);
    await expect(userAHost.ctx.rag.search({ scope, query: 'private' })).resolves.toHaveLength(1);
    await expect(userBHost.ctx.rag.search({ scope, query: 'private' })).resolves.toEqual([]);
    await expect(pluginBHost.ctx.rag.search({ scope, query: 'private' })).resolves.toEqual([]);
    await expect(userBHost.ctx.config.get('theme')).resolves.toBeNull();
    await expect(pluginBHost.ctx.secrets.get('apiKey')).resolves.toBeNull();
  });
});
