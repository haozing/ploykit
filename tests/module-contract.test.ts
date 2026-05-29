import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defineModule,
  Permission,
  relation,
  table,
  text,
  validateModuleDefinition,
} from '@ploykit/module-sdk';

function codesFor(definition: Parameters<typeof validateModuleDefinition>[0]): string[] {
  return validateModuleDefinition(definition).map((diagnostic) => diagnostic.code);
}

test('module contract rejects public aliases that collide with host routes', () => {
  const codes = codesFor(
    defineModule({
      id: 'alias-test',
      name: 'Alias Test',
      version: '0.1.0',
      routes: {
        site: [
          {
            path: '/tools/alias-test',
            component: './pages/ToolPage',
            auth: 'public',
            publicAliases: ['/pricing'],
          },
        ],
      },
    })
  );

  assert.ok(codes.includes('MODULE_PUBLIC_ALIAS_RESERVED'));
});

test('module contract rejects unsupported contract schema versions', () => {
  const codes = codesFor(
    defineModule({
      contractVersion: 3 as never,
      id: 'contract-version-test',
      name: 'Contract Version Test',
      version: '0.1.0',
    })
  );

  assert.ok(codes.includes('MODULE_CONTRACT_VERSION_UNSUPPORTED'));
});

test('module contract validates v2 signed service policies', () => {
  const valid = codesFor(
    defineModule({
      contractVersion: 2,
      id: 'signed-policy-test',
      name: 'Signed Policy Test',
      version: '0.1.0',
      serviceRequirements: {
        signedAdmin: {
          required: true,
          provider: 'signed-api',
          kind: 'signed-http',
          connection: {
            baseUrl: 'https://signed-api.example',
            egress: ['https://signed-api.example'],
          },
          secrets: {
            bearerToken: { required: true },
            hmacSecret: { required: true },
          },
          claims: {
            requestId: '${ctx.request.id}',
          },
          operations: {
            'admin.request': {
              method: 'POST',
              path: '/admin/request',
              auth: { type: 'bearer', secret: 'bearerToken' },
              signing: { type: 'hmac-sha256', secret: 'hmacSecret' },
              request: { body: 'json', allowHeaders: ['content-type'] },
              response: { body: 'json' },
            },
          },
        },
      },
    })
  );
  const invalid = codesFor(
    defineModule({
      id: 'bad-signed-policy-test',
      name: 'Bad Signed Policy Test',
      version: '0.1.0',
      serviceRequirements: {
        signedAdmin: {
          required: true,
          provider: 'signed-api',
          kind: 'signed-http',
          connection: {
            egress: ['http://localhost:3000'],
          },
          claims: {
            bad: '${ctx.env.SECRET}',
          },
          operations: {
            'admin.request': {
              auth: { type: 'bearer', secret: 'bearerToken' },
              signing: {
                type: 'hmac-sha256',
                secret: 'hmacSecret',
                header: 'x-module-signature',
                claimsHeader: 'x-module-claims',
              },
              request: { allowHeaders: ['authorization', 'x-module-signature'] },
            },
          },
        },
      },
    })
  );

  assert.deepEqual(valid, []);
  assert.ok(invalid.includes('MODULE_CONTRACT_V2_REQUIRED'));
  assert.ok(invalid.includes('MODULE_SERVICE_EGRESS_INVALID'));
  assert.ok(invalid.includes('MODULE_SERVICE_PRIVATE_NETWORK_FORBIDDEN'));
  assert.ok(invalid.includes('MODULE_SERVICE_CLAIMS_TEMPLATE_INVALID'));
  assert.ok(invalid.includes('MODULE_SERVICE_SECRET_REQUIRED'));
  assert.ok(invalid.includes('MODULE_SERVICE_REQUEST_ID_REQUIRED'));
  assert.ok(invalid.includes('MODULE_SERVICE_MANAGED_HEADER_DENIED'));
});

test('module contract requires public aliases to be public site routes', () => {
  const codes = codesFor(
    defineModule({
      id: 'dashboard-alias-test',
      name: 'Dashboard Alias Test',
      version: '0.1.0',
      routes: {
        dashboard: [
          {
            path: '/dashboard-alias',
            component: './pages/DashboardPage',
            auth: 'auth',
            publicAliases: ['/tools/dashboard-alias'],
          },
        ],
      },
    })
  );

  assert.ok(codes.includes('MODULE_PUBLIC_ALIAS_SITE_ONLY'));
  assert.ok(codes.includes('MODULE_PUBLIC_ALIAS_PUBLIC_AUTH_REQUIRED'));
});

test('module contract requires public site routes to declare SEO metadata and cache policy', () => {
  const codes = codesFor(
    defineModule({
      id: 'public-site-test',
      name: 'Public Site Test',
      version: '0.1.0',
      routes: {
        site: [
          {
            path: '/public-site-test',
            component: './pages/PublicSitePage',
            auth: 'public',
          },
          {
            path: '/private-cache',
            component: './pages/PrivateCachePage',
            metadata: './loaders/private-cache-metadata',
            auth: 'public',
            cache: {
              strategy: 'private',
              revalidateSeconds: 0,
              tags: [''],
            },
          },
        ],
      },
    })
  );

  assert.ok(codes.includes('MODULE_PUBLIC_SITE_METADATA_REQUIRED'));
  assert.ok(codes.includes('MODULE_PUBLIC_SITE_CACHE_REQUIRED'));
  assert.ok(codes.includes('MODULE_PUBLIC_ROUTE_PRIVATE_CACHE'));
  assert.ok(codes.includes('MODULE_ROUTE_CACHE_REVALIDATE_INVALID'));
  assert.ok(codes.includes('MODULE_ROUTE_CACHE_TAG_EMPTY'));
});

test('module contract rejects public machine-auth API routes', () => {
  const codes = codesFor(
    defineModule({
      id: 'machine-auth-test',
      name: 'Machine Auth Test',
      version: '0.1.0',
      routes: {
        api: [
          {
            path: '/machine',
            handler: './api/machine',
            auth: 'public',
            machineAuth: 'apiKey',
            anonymousPolicy: {
              rateLimit: {
                bucket: 'ip',
                limit: 10,
                window: '1m',
              },
            },
          },
        ],
      },
    })
  );

  assert.ok(codes.includes('MODULE_API_MACHINE_AUTH_NOT_PUBLIC'));
});

test('module contract validates public API anonymous policy details', () => {
  const codes = codesFor(
    defineModule({
      id: 'anonymous-policy-test',
      name: 'Anonymous Policy Test',
      version: '0.1.0',
      routes: {
        api: [
          {
            path: '/missing-rate-limit',
            handler: './api/missing-rate-limit',
            methods: ['POST'],
            auth: 'public',
            anonymousPolicy: {},
          },
          {
            path: '/bad-rate-limit',
            handler: './api/bad-rate-limit',
            methods: ['POST'],
            auth: 'public',
            commercial: {
              credits: { amount: 1 },
            },
            anonymousPolicy: {
              rateLimit: {
                bucket: 'ip',
                limit: 0,
                window: 'soon',
              },
              maxUploadBytes: 0,
              captcha: 'sometimes' as never,
              allowHighCostActions: true,
            },
          },
        ],
      },
    })
  );

  assert.ok(codes.includes('MODULE_PUBLIC_API_RATE_LIMIT_REQUIRED'));
  assert.ok(codes.includes('MODULE_PUBLIC_API_RATE_LIMIT_INVALID'));
  assert.ok(codes.includes('MODULE_PUBLIC_API_RATE_LIMIT_WINDOW_INVALID'));
  assert.ok(codes.includes('MODULE_PUBLIC_API_UPLOAD_LIMIT_INVALID'));
  assert.ok(codes.includes('MODULE_PUBLIC_API_CAPTCHA_INVALID'));
  assert.ok(codes.includes('MODULE_PUBLIC_API_HIGH_COST_ANONYMOUS_FORBIDDEN'));
});

test('module contract validates commercial placeholders', () => {
  const codes = codesFor(
    defineModule({
      id: 'commercial-test',
      name: 'Commercial Test',
      version: '0.1.0',
      permissions: [Permission.SurfaceContribute],
      routes: {
        site: [
          {
            path: '/paid',
            component: './pages/PaidPage',
            auth: 'auth',
            commercial: {
              entitlements: [''],
              credits: {
                amount: 0,
              },
            },
          },
        ],
      },
      surfaces: {
        'dashboard.home:paid-panel': {
          component: './surfaces/PaidPanel',
          permissions: [Permission.SurfaceContribute],
          commercial: {
            plans: [''],
          },
        },
      },
      actions: {
        paidAction: {
          handler: './actions/paid-action',
          commercial: {
            meter: '',
          },
        },
      },
    })
  );

  assert.ok(codes.includes('MODULE_COMMERCIAL_REQUIREMENT_EMPTY'));
  assert.ok(codes.includes('MODULE_COMMERCIAL_CREDITS_INVALID'));
  assert.ok(codes.includes('MODULE_COMMERCIAL_METER_EMPTY'));
});

test('module contract validates background runtime declarations', () => {
  const codes = codesFor(
    defineModule({
      id: 'background-contract-test',
      name: 'Background Contract Test',
      version: '0.1.0',
      jobs: {
        invalid_retries: {
          handler: './jobs/invalid',
          retries: -1,
        },
      },
      events: {
        publishes: ['Invalid Event'],
        subscribes: {
          'Bad Event': './events/bad',
        },
      },
      webhooks: {
        inbound: {
          path: '/inbound',
          handler: './webhooks/inbound',
          signature: 'ed25519' as never,
        },
      },
    })
  );

  assert.ok(codes.includes('MODULE_JOB_RETRIES_INVALID'));
  assert.ok(codes.includes('MODULE_EVENTS_EMIT_PERMISSION_REQUIRED'));
  assert.ok(codes.includes('MODULE_EVENTS_SUBSCRIBE_PERMISSION_REQUIRED'));
  assert.ok(codes.includes('MODULE_EVENT_NAME_INVALID'));
  assert.ok(codes.includes('MODULE_WEBHOOK_RECEIVE_PERMISSION_REQUIRED'));
  assert.ok(codes.includes('MODULE_WEBHOOK_SIGNATURE_INVALID'));
});

test('module contract couples external HTTP permission with explicit egress origins', () => {
  const egressWithoutPermission = codesFor(
    defineModule({
      id: 'egress-test',
      name: 'Egress Test',
      version: '0.1.0',
      egress: ['https://api.example.com'],
    })
  );
  const permissionWithoutEgress = codesFor(
    defineModule({
      id: 'http-test',
      name: 'HTTP Test',
      version: '0.1.0',
      permissions: [Permission.ExternalHttp],
    })
  );
  const invalidOrigin = codesFor(
    defineModule({
      id: 'bad-egress-test',
      name: 'Bad Egress Test',
      version: '0.1.0',
      permissions: [Permission.ExternalHttp],
      egress: ['https://*.example.com/path'],
    })
  );

  assert.ok(egressWithoutPermission.includes('MODULE_EGRESS_PERMISSION_REQUIRED'));
  assert.ok(permissionWithoutEgress.includes('MODULE_HTTP_EGRESS_REQUIRED'));
  assert.ok(invalidOrigin.includes('MODULE_EGRESS_ORIGIN_INVALID'));
});

test('module contract validates lifecycle, data migration, provider, and secret metadata', () => {
  const codes = codesFor(
    defineModule({
      id: 'framework-contract-test',
      name: 'Framework Contract Test',
      version: '0.1.0',
      data: {
        version: 1,
        tables: {
          posts: table({
            scope: 'workspace',
            columns: {
              title: text().notNull(),
            },
          }),
        },
      },
      lifecycle: {
        start: './lifecycle/start',
      } as never,
      serviceRequirements: {
        ai: {
          required: true,
        },
      },
      config: {
        api_key: {
          type: 'string',
          secret: true,
          default: 'dev-secret',
        },
      },
    })
  );

  const invalidMigrationMode = codesFor(
    defineModule({
      id: 'migration-mode-test',
      name: 'Migration Mode Test',
      version: '0.1.0',
      data: {
        version: 1,
        tables: {
          posts: table({
            scope: 'workspace',
            columns: {
              title: text().notNull(),
            },
          }),
        },
        migrations: {
          mode: 'diff' as never,
          dir: './migrations',
        },
      },
    })
  );

  assert.ok(codes.includes('MODULE_DATA_MIGRATIONS_REQUIRED'));
  assert.ok(codes.includes('MODULE_LIFECYCLE_HOOK_UNKNOWN'));
  assert.ok(codes.includes('MODULE_SERVICE_PROVIDER_REQUIRED'));
  assert.ok(codes.includes('MODULE_SECRET_DEFAULT_FORBIDDEN'));
  assert.ok(invalidMigrationMode.includes('MODULE_DATA_MIGRATION_MODE_INVALID'));
});

test('module contract validates data relation references and governance models', () => {
  const codes = codesFor(
    defineModule({
      id: 'data-relation-test',
      name: 'Data Relation Test',
      version: '0.1.0',
      data: {
        version: 1,
        tables: {
          posts: table({
            scope: 'workspace',
            columns: {
              author_id: text().notNull(),
              title: text().notNull(),
            },
            relations: {
              author: relation('authors', {
                local: 'author_id',
                foreign: 'missing_id',
              }),
              broken: relation('missing_table', {
                local: 'missing_local',
                foreign: 'id',
                onDelete: 'explode' as never,
              }),
            },
          }),
          authors: table({
            scope: 'workspace',
            columns: {
              name: text().notNull(),
            },
          }),
        },
        grants: {
          missing_model: {
            model: 'ghost',
            operations: ['read'],
          },
        },
        checks: {
          missing_check_model: {
            model: 'ghost',
            kind: 'schema',
          },
        },
        migrations: {
          mode: 'generated',
          dir: './migrations',
        },
      },
    })
  );

  assert.ok(codes.includes('MODULE_DATA_TABLE_RELATION_TARGET_UNKNOWN'));
  assert.ok(codes.includes('MODULE_DATA_TABLE_RELATION_LOCAL_FIELD_UNKNOWN'));
  assert.ok(codes.includes('MODULE_DATA_TABLE_RELATION_FOREIGN_FIELD_UNKNOWN'));
  assert.ok(codes.includes('MODULE_DATA_TABLE_RELATION_ON_DELETE_INVALID'));
  assert.ok(codes.includes('MODULE_DATA_GRANT_MODEL_UNKNOWN'));
  assert.ok(codes.includes('MODULE_DATA_CHECK_MODEL_UNKNOWN'));
});

test('module contract validates theme permissions and host token allowlist', () => {
  const codes = codesFor(
    defineModule({
      id: 'theme-test',
      name: 'Theme Test',
      version: '0.1.0',
      theme: {
        tokens: {
          colorPrimary: '#2563eb',
          focusRing: 'red; color: transparent',
          'global.css': 'body{}',
        },
        css: 'body { color: red; }',
      },
    })
  );

  assert.ok(codes.includes('MODULE_THEME_PERMISSION_REQUIRED'));
  assert.ok(codes.includes('MODULE_THEME_CSS_UNSUPPORTED'));
  assert.ok(codes.includes('MODULE_THEME_TOKEN_NOT_ALLOWED'));
  assert.ok(codes.includes('MODULE_THEME_TOKEN_VALUE_UNSAFE'));
});

test('module contract validates white-label presentation declarations', () => {
  const codes = codesFor(
    defineModule({
      id: 'white-label-invalid',
      name: 'White Label Invalid',
      version: '0.1.0',
      permissions: [Permission.SurfaceOverride],
      presentation: {
        whiteLabel: true,
        replaces: ['host.page:site.home', 'bad.target'],
        seoNamespaces: ['seo'],
        themeScope: 'site',
      },
      surfaces: {
        'host.page:site.home': {
          mode: 'append',
          component: './surfaces/HomePage',
          permissions: [Permission.SurfaceOverride],
        },
        'host.page:site.docs': {
          mode: 'replace',
          component: './surfaces/DocsPage',
          loader: './loaders/docs-meta',
          permissions: [Permission.SurfaceOverride],
        },
      },
    })
  );

  assert.ok(codes.includes('MODULE_PRESENTATION_I18N_REQUIRED'));
  assert.ok(codes.includes('MODULE_PRESENTATION_LOCALES_REQUIRED'));
  assert.ok(codes.includes('MODULE_PRESENTATION_REPLACE_TARGET_INVALID'));
  assert.ok(codes.includes('MODULE_PRESENTATION_REPLACE_SURFACE_MODE_INVALID'));
  assert.ok(codes.includes('MODULE_PRESENTATION_REPLACE_LOADER_REQUIRED'));
  assert.ok(codes.includes('MODULE_PRESENTATION_REPLACE_NOT_DECLARED'));
  assert.ok(codes.includes('MODULE_PRESENTATION_SEO_NAMESPACE_MISSING'));
});

test('module contract accepts complete white-label presentation declarations', () => {
  const diagnostics = validateModuleDefinition(
    defineModule({
      id: 'white-label-valid',
      name: 'White Label Valid',
      version: '0.1.0',
      permissions: [Permission.SurfaceOverride, Permission.ThemeWrite],
      resources: {
        locales: {
          zh: './locales/zh.json',
          en: './locales/en.json',
        },
      },
      i18n: {
        defaultLanguage: 'zh',
        requiredLanguages: ['zh', 'en'],
        namespaces: ['nav', 'seo'],
        strict: true,
      },
      presentation: {
        whiteLabel: true,
        replaces: ['host.page:site.home'],
        seoNamespaces: ['seo'],
        themeScope: 'site',
      },
      theme: {
        tokens: {
          colorPrimary: '#2563eb',
        },
      },
      surfaces: {
        'host.page:site.home': {
          mode: 'replace',
          component: './surfaces/HomePage',
          loader: './loaders/home-meta',
          permissions: [Permission.SurfaceOverride],
        },
      },
    })
  );

  assert.deepEqual(diagnostics, []);
});

test('module contract requires localized message keys for strict i18n fallbacks', () => {
  const codes = codesFor(
    defineModule({
      id: 'strict-i18n-messages',
      name: 'Strict I18n Messages',
      version: '0.1.0',
      resources: {
        locales: {
          zh: './locales/zh.json',
        },
      },
      i18n: {
        defaultLanguage: 'zh',
        requiredLanguages: ['zh'],
        namespaces: ['actions', 'surfaces'],
        strict: true,
      },
      actions: {
        publish: {
          handler: './actions/publish',
          confirmation: {
            required: true,
            fallbackMessage: 'Publish now?',
          },
        },
      },
      surfaces: {
        'dashboard.home:summary': {
          mode: 'append',
          component: './surfaces/Summary',
          fallback: {
            behavior: 'placeholder',
            fallbackMessage: 'Summary unavailable.',
          },
        },
      },
    })
  );

  assert.ok(codes.includes('MODULE_I18N_ACTION_CONFIRMATION_MESSAGE_KEY_REQUIRED'));
  assert.ok(codes.includes('MODULE_I18N_SURFACE_FALLBACK_MESSAGE_KEY_REQUIRED'));
});

test('module contract validates local contract parts, action side effects, and surface placement metadata', () => {
  const codes = codesFor(
    defineModule({
      id: 'contract-metadata-test',
      name: 'Contract Metadata Test',
      version: '0.1.0',
      parts: {
        data: './data',
        routes: './routes',
        theme: './theme',
      },
      actions: {
        deleteEverything: {
          handler: './actions/delete-everything',
          sideEffect: 'destructive',
        },
        callExternal: {
          handler: './actions/call-external',
          permissions: [Permission.FilesRead],
          sideEffect: 'external',
        },
      },
      surfaces: {
        'admin.dashboard:actions': {
          component: './surfaces/AdminActions',
          placement: {
            responsive: 'float' as never,
          },
          visibility: {
            mode: 'permission',
          },
          fallback: {
            behavior: 'teleport' as never,
          },
        },
      },
    })
  );

  assert.ok(codes.includes('MODULE_PART_DATA_NOT_WIRED'));
  assert.ok(codes.includes('MODULE_PART_ROUTES_NOT_WIRED'));
  assert.ok(codes.includes('MODULE_PART_THEME_NOT_WIRED'));
  assert.ok(codes.includes('MODULE_ENTRY_PERMISSION_NOT_DECLARED'));
  assert.ok(codes.includes('MODULE_ACTION_CONFIRMATION_REQUIRED'));
  assert.ok(codes.includes('MODULE_ACTION_IDEMPOTENCY_REQUIRED'));
  assert.ok(codes.includes('MODULE_SURFACE_PLACEMENT_RESPONSIVE_INVALID'));
  assert.ok(codes.includes('MODULE_SURFACE_VISIBILITY_PERMISSION_REQUIRED'));
  assert.ok(codes.includes('MODULE_SURFACE_FALLBACK_INVALID'));
});
