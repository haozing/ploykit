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

test('module contract rejects permissions reserved without runtime capabilities', () => {
  const codes = codesFor(
    defineModule({
      id: 'reserved-permission-test',
      name: 'Reserved Permission Test',
      version: '0.1.0',
      permissions: [Permission.ConfigWrite, Permission.SecretsWrite],
      actions: {
        updateConfig: {
          handler: './actions/update-config',
          permissions: [Permission.ConfigWrite],
        },
      },
    })
  );

  assert.ok(codes.includes('MODULE_PERMISSION_RESERVED_RUNTIME'));
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

test('module contract validates dashboard and admin route aliases', () => {
  const codes = codesFor(
    defineModule({
      id: 'route-alias-test',
      name: 'Route Alias Test',
      version: '0.1.0',
      routes: {
        dashboard: [
          {
            path: '/canonical',
            component: './pages/DashboardPage',
            auth: 'auth',
            aliases: ['/canonical', '/alias/:dynamic', '/alias/:dynamic', '/alias?tab=one'],
          },
        ],
      },
    })
  );

  assert.ok(codes.includes('MODULE_ROUTE_ALIAS_SELF_REFERENCE'));
  assert.ok(codes.includes('MODULE_ROUTE_ALIAS_DYNAMIC_UNSUPPORTED'));
  assert.ok(codes.includes('MODULE_ROUTE_ALIAS_DUPLICATE'));
  assert.ok(codes.includes('MODULE_ROUTE_ALIAS_PATH_INVALID'));
});

test('module contract validates page route param selectors', () => {
  const valid = codesFor(
    defineModule({
      id: 'param-selector-valid',
      name: 'Param Selector Valid',
      version: '0.1.0',
      routes: {
        dashboard: [
          {
            path: '/param-selector/[section]',
            component: './pages/App',
            loaderByParam: {
              section: {
                agents: './loaders/agents',
              },
            },
            metadataByParam: {
              section: {
                agents: './loaders/agents-metadata',
              },
            },
            cacheByParam: {
              section: {
                agents: {
                  strategy: 'private',
                  revalidateSeconds: 10,
                },
              },
            },
          },
        ],
      },
    })
  );
  const invalid = codesFor(
    defineModule({
      id: 'param-selector-invalid',
      name: 'Param Selector Invalid',
      version: '0.1.0',
      routes: {
        dashboard: [
          {
            path: '/param-selector/[section]',
            component: './pages/App',
            loaderByParam: {
              section: {
                agents: '../outside',
              },
              tab: {
                overview: './loaders/overview',
              },
            },
            metadataByParam: {
              missing: {
                agents: './loaders/agents-metadata',
              },
            },
            cacheByParam: {
              section: {
                agents: {
                  strategy: 'invalid' as never,
                  revalidateSeconds: 0,
                },
              },
            },
          },
        ],
      },
    })
  );
  const invalidPath = codesFor(
    defineModule({
      id: 'param-selector-invalid-path',
      name: 'Param Selector Invalid Path',
      version: '0.1.0',
      routes: {
        dashboard: [
          {
            path: '/param-selector/[section]',
            component: './pages/App',
            loaderByParam: {
              section: {
                agents: '../outside',
              },
            },
          },
        ],
      },
    })
  );

  assert.deepEqual(valid, []);
  assert.ok(invalid.includes('MODULE_ROUTE_PARAM_SELECTOR_COUNT_INVALID'));
  assert.ok(invalid.includes('MODULE_ROUTE_PARAM_SELECTOR_UNKNOWN'));
  assert.ok(invalidPath.includes('MODULE_LOCAL_PATH_INVALID'));
  assert.ok(invalid.includes('MODULE_ROUTE_CACHE_STRATEGY_INVALID'));
  assert.ok(invalid.includes('MODULE_ROUTE_CACHE_REVALIDATE_INVALID'));
});

test('module contract keeps public aliases and route aliases in separate lanes', () => {
  const siteCodes = codesFor(
    defineModule({
      id: 'site-route-alias-test',
      name: 'Site Route Alias Test',
      version: '0.1.0',
      routes: {
        site: [
          {
            path: '/canonical',
            component: './pages/SitePage',
            metadata: './loaders/site-meta',
            auth: 'public',
            aliases: ['/legacy'],
            cache: { strategy: 'public', revalidateSeconds: 300 },
          },
        ],
      },
    })
  );

  const conflictCodes = codesFor(
    defineModule({
      id: 'route-alias-conflict-test',
      name: 'Route Alias Conflict Test',
      version: '0.1.0',
      routes: {
        dashboard: [
          {
            path: '/orders/:orderId',
            component: './pages/OrderPage',
            auth: 'auth',
          },
          {
            path: '/orders/archive',
            component: './pages/ArchivePage',
            auth: 'auth',
            aliases: ['/orders/:orderId'],
          },
        ],
      },
    })
  );

  assert.ok(siteCodes.includes('MODULE_ROUTE_ALIAS_NON_SITE_ONLY'));
  assert.ok(conflictCodes.includes('MODULE_ROUTE_PATH_CONFLICT'));
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

test('module contract validates public site param metadata and cache branches', () => {
  const branchOnlyCodes = codesFor(
    defineModule({
      id: 'public-site-param-test',
      name: 'Public Site Param Test',
      version: '0.1.0',
      routes: {
        site: [
          {
            path: '/docs/[section]',
            component: './pages/DocsPage',
            auth: 'public',
            metadataByParam: {
              section: {
                guide: './loaders/docs-guide-metadata',
              },
            },
            cacheByParam: {
              section: {
                guide: {
                  strategy: 'public',
                  revalidateSeconds: 300,
                },
              },
            },
          },
        ],
      },
    })
  );
  const privateBranchCodes = codesFor(
    defineModule({
      id: 'public-site-param-private-test',
      name: 'Public Site Param Private Test',
      version: '0.1.0',
      routes: {
        site: [
          {
            path: '/docs/[section]',
            component: './pages/DocsPage',
            auth: 'public',
            metadataByParam: {
              section: {
                guide: './loaders/docs-guide-metadata',
              },
            },
            cacheByParam: {
              section: {
                guide: {
                  strategy: 'private',
                },
              },
            },
          },
        ],
      },
    })
  );

  assert.equal(branchOnlyCodes.includes('MODULE_PUBLIC_SITE_METADATA_REQUIRED'), false);
  assert.equal(branchOnlyCodes.includes('MODULE_PUBLIC_SITE_CACHE_REQUIRED'), false);
  assert.ok(privateBranchCodes.includes('MODULE_PUBLIC_ROUTE_PRIVATE_CACHE'));
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

test('module contract validates API route idempotency declarations', () => {
  const codes = codesFor(
    defineModule({
      id: 'api-idempotency-test',
      name: 'API Idempotency Test',
      version: '0.1.0',
      routes: {
        api: [
          {
            path: '/missing-key-source',
            handler: './api/missing-key-source',
            auth: 'auth',
            methods: ['POST'],
            idempotency: { required: true },
          },
          {
            path: '/invalid-key-source',
            handler: './api/invalid-key-source',
            auth: 'auth',
            methods: ['POST'],
            idempotency: { required: true, keyFrom: 'body' as never },
          },
        ],
      },
    })
  );

  assert.ok(codes.includes('MODULE_API_IDEMPOTENCY_KEY_SOURCE_REQUIRED'));
  assert.ok(codes.includes('MODULE_API_IDEMPOTENCY_KEY_SOURCE_INVALID'));
});

test('module contract validates quality performance route sampling shape', () => {
  const valid = codesFor(
    defineModule({
      id: 'quality-performance-valid',
      name: 'Quality Performance Valid',
      version: '0.1.0',
      quality: {
        performance: {
          pageRoutes: [
            {
              shell: 'dashboard',
              path: '/quality-performance/[section]',
              samplePath: '/quality-performance/traces',
              maxLoaderMs: 500,
              maxLoaderDataBytes: 20000,
            },
          ],
          apiRoutes: [
            {
              path: '/quality-performance/audit',
              method: 'GET',
              auth: 'anonymous',
              maxP95Ms: 800,
              maxResponseBytes: 150000,
            },
          ],
        },
      },
    })
  );
  const invalid = codesFor(
    defineModule({
      id: 'quality-performance-invalid',
      name: 'Quality Performance Invalid',
      version: '0.1.0',
      quality: {
        performance: {
          pageRoutes: [
            {
              shell: 'site' as never,
              path: '/quality-performance/[section]',
              samplePath: '/quality-performance/traces',
            },
          ],
          apiRoutes: [
            {
              path: '/quality-performance/audit',
              method: 'POST' as never,
              auth: 'user' as never,
            },
          ],
        },
      },
    })
  );

  assert.deepEqual(valid, []);
  assert.ok(invalid.includes('MODULE_QUALITY_PAGE_ROUTE_SHELL_INVALID'));
  assert.ok(invalid.includes('MODULE_QUALITY_API_METHOD_INVALID'));
  assert.ok(invalid.includes('MODULE_QUALITY_API_AUTH_INVALID'));
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

test('module contract validates module icon resources', () => {
  const validCodes = codesFor(
    defineModule({
      id: 'icon-resource-test',
      name: 'Icon Resource Test',
      version: '0.1.0',
      resources: {
        icons: {
          taskList: {
            kind: 'lucide',
            name: 'ListChecks',
          },
          workerToken: {
            kind: 'svg',
            path: './assets/icons/worker-token.svg',
          },
        },
      },
    })
  );
  const invalidCodes = codesFor(
    defineModule({
      id: 'bad-icon-resource-test',
      name: 'Bad Icon Resource Test',
      version: '0.1.0',
      resources: {
        icons: {
          task_list: {
            kind: 'lucide',
            name: 'clipboard-list',
          },
          report: {
            kind: 'svg',
            path: '../icons/report.png',
          },
          mystery: { kind: 'emoji' } as never,
        },
      },
    })
  );

  assert.deepEqual(validCodes, []);
  assert.ok(invalidCodes.includes('MODULE_ICON_KEY_INVALID'));
  assert.ok(invalidCodes.includes('MODULE_ICON_LUCIDE_NAME_INVALID'));
  assert.ok(invalidCodes.includes('MODULE_LOCAL_PATH_INVALID'));
  assert.ok(invalidCodes.includes('MODULE_ICON_SVG_PATH_INVALID'));
  assert.ok(invalidCodes.includes('MODULE_ICON_KIND_INVALID'));
});
