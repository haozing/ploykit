import assert from 'node:assert/strict';
import test from 'node:test';
import {
  api,
  defineModule,
  page,
  Permission,
  resource,
  relation,
  schema,
  stringField,
  table,
  text,
  validateModuleDefinition,
} from '@ploykit/module-sdk';

function codesFor(definition: Parameters<typeof validateModuleDefinition>[0]): string[] {
  return validateModuleDefinition(definition).map((diagnostic) => diagnostic.code);
}

function payloadSchema(name = 'Payload') {
  return schema({
    name,
    fields: {
      value: stringField({ required: true }),
    },
  });
}

test('module contract rejects public aliases that collide with host routes', () => {
  const codes = codesFor(
    defineModule({
      id: 'alias-test',
      name: 'Alias Test',
      version: '0.1.0',
      pages: [
        page({
          id: 'alias-test.tool',
          area: 'site',
          path: '/tools/alias-test',
          frame: 'site',
          component: './pages/ToolPage',
          metadata: './loaders/tool-metadata',
          auth: 'public',
          publicAliases: ['/pricing'],
          cache: {
            strategy: 'public',
            revalidateSeconds: 300,
            tags: ['alias-test'],
          },
        }),
      ],
    })
  );

  assert.ok(codes.includes('MODULE_PUBLIC_ALIAS_RESERVED'));
});

test('module contract rejects removed contractVersion field', () => {
  const codes = codesFor(
    defineModule({
      contractVersion: 4 as never,
      id: 'contract-version-test',
      name: 'Contract Version Test',
      version: '0.1.0',
    })
  );

  assert.ok(codes.includes('MODULE_CONTRACT_VERSION_UNSUPPORTED'));
});

test('module contract validates host extension declarations', () => {
  const productCodes = codesFor(
    defineModule({
      id: 'product-with-provides',
      name: 'Product With Provides',
      version: '0.1.0',
      provides: {
        capabilities: {
          executor: {
            provider: './capabilities/executor',
          },
        },
      },
    })
  );

  assert.ok(productCodes.includes('MODULE_PROVIDES_PRODUCT_FORBIDDEN'));

  const extensionDiagnostics = validateModuleDefinition(
    defineModule({
      id: 'worker-executor-local',
      name: 'Worker Executor Local',
      version: '0.1.0',
      kind: 'host-extension',
      permissions: [Permission.ServicesInvoke, Permission.AdminResourcesWrite],
      provides: {
        capabilities: {
          executor: {
            provider: './capabilities/executor',
            permissions: [Permission.ServicesInvoke],
          },
        },
        adminResources: {
          workers: {
            operations: {
              restart: {
                handler: './admin/restart-worker',
                permission: Permission.AdminResourcesWrite,
                risk: 'dangerous',
                auditEvent: 'worker.restart',
                confirmation: { field: 'confirm', value: 'RESTART' },
              },
            },
          },
        },
      },
      uses: {
        capabilities: ['executor'],
      },
    })
  );

  assert.deepEqual(extensionDiagnostics.map((diagnostic) => diagnostic.code), []);
});

test('module contract rejects provided capability key collisions', () => {
  const codes = codesFor(
    defineModule({
      id: 'bad-extension-capability-key',
      name: 'Bad Extension Capability Key',
      version: '0.1.0',
      kind: 'host-extension',
      provides: {
        capabilities: {
          data: {
            provider: './capabilities/data-proxy',
          },
        },
      },
    })
  );

  assert.ok(codes.includes('MODULE_PROVIDED_CAPABILITY_KEY_RESERVED'));
});

test('module contract validates admin resource operation guards', () => {
  const codes = codesFor(
    defineModule({
      id: 'bad-admin-resource',
      name: 'Bad Admin Resource',
      version: '0.1.0',
      kind: 'host-extension',
    permissions: [Permission.AdminResourcesWrite],
      provides: {
        adminResources: {
          workers: {
            operations: {
              restart: {
                handler: './admin/restart-worker',
                permission: Permission.AdminResourcesWrite,
                risk: 'dangerous',
              },
            },
          },
        },
      },
    })
  );

  assert.ok(codes.includes('MODULE_ADMIN_RESOURCE_AUDIT_EVENT_REQUIRED'));
  assert.ok(codes.includes('MODULE_ADMIN_RESOURCE_CONFIRMATION_REQUIRED'));
});

test('clean-slate contract validates assets, resources, pages, and schemas', () => {
  const noteSchema = schema({
    name: 'Note',
    fields: {
      title: stringField({ required: true }),
      body: stringField(),
    },
  });

  const diagnostics = validateModuleDefinition(
    defineModule({
      id: 'clean-notes',
      name: 'Clean Notes',
      version: '0.1.0',
      assets: {
        locales: {
          en: './locales/en.json',
        },
        icons: {
          notes: {
            kind: 'lucide',
            name: 'NotebookTabs',
          },
        },
      },
      resources: {
        notes: resource({
          scope: 'workspace',
          schema: noteSchema,
          storage: { table: 'notes' },
        }),
      },
      pages: [
        page({
          id: 'notes.list',
          area: 'dashboard',
          path: '/notes',
          frame: 'workspace',
          component: './pages/NotesListPage.tsx',
          auth: 'auth',
        }),
      ],
      actions: {
        publishNote: {
          handler: './actions/publish-note',
          input: noteSchema,
          sideEffect: 'write',
        },
      },
      apis: [
        {
          id: 'notes.api',
          path: '/notes',
          handler: './api/notes',
          methods: ['GET', 'POST'],
          input: noteSchema,
          output: noteSchema,
        },
      ],
    })
  );

  assert.deepEqual(diagnostics, []);
});

test('clean-slate contract rejects old routes, static resources, missing frame, and missing schemas', () => {
  const codes = codesFor(
    defineModule({
      id: 'bad-clean-notes',
      name: 'Bad Clean Notes',
      version: '0.1.0',
      routes: {
        dashboard: [
          {
            path: '/notes',
            component: './pages/NotesPage',
          },
        ],
      },
      resources: {
        locales: {
          en: './locales/en.json',
        },
      } as never,
      pages: [
        {
          id: 'notes.list',
          area: 'dashboard',
          path: '/notes',
          frame: '',
          component: './pages/NotesListPage.tsx',
        },
      ],
      actions: {
        publishNote: {
          handler: './actions/publish-note',
        },
      },
      apis: [
        {
          id: 'notes.api',
          path: '/notes',
          handler: './api/notes',
        } as never,
      ],
    })
  );

  assert.ok(codes.includes('MODULE_CLEAN_ROUTES_UNSUPPORTED'));
  assert.ok(codes.includes('MODULE_CLEAN_STATIC_RESOURCES_MOVED'));
  assert.ok(codes.includes('MODULE_PAGE_FRAME_REQUIRED'));
  assert.ok(codes.includes('MODULE_SCHEMA_REQUIRED'));
});

test('clean-slate contract rejects module-owned tenant authority fields', () => {
  const codes = codesFor(
    defineModule({
      id: 'tenant-authority-test',
      name: 'Tenant Authority Test',
      version: '0.1.0',
      resources: {
        notes: resource({
          scope: 'workspace',
          schema: schema({
            fields: {
              title: stringField({ required: true }),
              tenant_id: stringField({ required: true }),
            },
          }),
          storage: { table: 'notes' },
        }),
      },
    })
  );

  assert.ok(codes.includes('MODULE_TENANT_AUTHORITY_FIELD_FORBIDDEN'));
});

test('clean-slate contract rejects resource-local page declarations', () => {
  const codes = codesFor(
    defineModule({
      id: 'resource-pages-test',
      name: 'Resource Pages Test',
      version: '0.1.0',
      resources: {
        notes: {
          $$type: 'ploykit.resource',
          scope: 'workspace',
          schema: payloadSchema('ResourcePagesPayload'),
          storage: { table: 'notes' },
          pages: {
            list: { area: 'dashboard', path: '/notes', frame: 'workspace' },
          },
        } as never,
      },
    })
  );

  assert.ok(codes.includes('MODULE_RESOURCE_PAGES_UNSUPPORTED'));
});

test('module contract validates page, API, and resource entry security rules', () => {
  const noteSchema = schema({
    name: 'Note',
    fields: {
      title: stringField({ required: true }),
    },
  });

  const diagnostics = validateModuleDefinition(
    defineModule({
      id: 'clean-entry-security',
      name: 'Clean Entry Security',
      version: '0.1.0',
      assets: {},
      resources: {
        notes: resource({
          scope: 'workspace',
          schema: noteSchema,
          storage: { table: 'notes' },
          permissions: [Permission.ExternalHttp],
        }),
      },
      pages: [
        page({
          id: 'clean-entry-security.home',
          area: 'dashboard',
          path: '/clean-entry-security',
          frame: 'workspace',
          component: './pages/HomePage.tsx',
          auth: 'anonymous' as never,
          permissions: [Permission.ExternalHttp],
        }),
      ],
      apis: [
        api({
          id: 'clean-entry-security.public',
          path: '/clean-entry-security/public',
          methods: ['TRACE' as never],
          auth: 'public',
          permissions: [Permission.ExternalHttp],
          machineAuth: 'apiKey',
          idempotency: { required: true },
          input: noteSchema,
          output: noteSchema,
          handler: './api/public.ts',
        }),
        api({
          id: 'clean-entry-security.commercial',
          path: '/clean-entry-security/commercial',
          methods: ['POST'],
          auth: 'public',
          commercial: {
            credits: { amount: 1 },
          },
          anonymousPolicy: {
            rateLimit: { bucket: 'ip', limit: 0, window: 'soon' },
            maxUploadBytes: 0,
            captcha: 'sometimes' as never,
            allowHighCostActions: true,
          },
          input: noteSchema,
          output: noteSchema,
          handler: './api/commercial.ts',
        }),
      ],
    })
  );
  const codes = diagnostics.map((diagnostic) => diagnostic.code);

  assert.ok(codes.includes('MODULE_ROUTE_AUTH_INVALID'));
  assert.ok(codes.includes('MODULE_ENTRY_PERMISSION_NOT_DECLARED'));
  assert.ok(codes.includes('MODULE_API_METHOD_INVALID'));
  assert.ok(codes.includes('MODULE_API_MACHINE_AUTH_NOT_PUBLIC'));
  assert.ok(codes.includes('MODULE_PUBLIC_API_ANONYMOUS_POLICY_REQUIRED'));
  assert.ok(codes.includes('MODULE_API_IDEMPOTENCY_KEY_SOURCE_REQUIRED'));
  assert.ok(codes.includes('MODULE_PUBLIC_API_RATE_LIMIT_INVALID'));
  assert.ok(codes.includes('MODULE_PUBLIC_API_RATE_LIMIT_WINDOW_INVALID'));
  assert.ok(codes.includes('MODULE_PUBLIC_API_UPLOAD_LIMIT_INVALID'));
  assert.ok(codes.includes('MODULE_PUBLIC_API_CAPTCHA_INVALID'));
  assert.ok(codes.includes('MODULE_PUBLIC_API_HIGH_COST_ANONYMOUS_FORBIDDEN'));
});

test('module contract validates public page metadata, aliases, and cache policy', () => {
  const validCodes = codesFor(
    defineModule({
      id: 'clean-public-page',
      name: 'Clean Public Page',
      version: '0.1.0',
      assets: {},
      pages: [
        page({
          id: 'clean-public-page.index',
          area: 'site',
          path: '/clean-public-page',
          frame: 'site',
          component: './pages/PublicPage.tsx',
          auth: 'public',
          metadata: './loaders/public-metadata',
          metadataResult: {
            required: ['title', 'description', 'canonical', 'sitemap'],
          },
          publicAliases: ['/tools/clean-public-page'],
          cache: {
            strategy: 'public',
            revalidateSeconds: 300,
            tags: ['clean-public-page'],
          },
        }),
      ],
    })
  );
  const invalidCodes = codesFor(
    defineModule({
      id: 'bad-clean-public-page',
      name: 'Bad Clean Public Page',
      version: '0.1.0',
      assets: {},
      pages: [
        page({
          id: 'bad-clean-public-page.index',
          area: 'site',
          path: '/bad-clean-public-page',
          frame: 'site',
          component: './pages/PublicPage.tsx',
          auth: 'public',
          publicAliases: ['/pricing'],
          metadataResult: {
            required: ['unknown' as never],
          },
          cache: {
            strategy: 'private',
            revalidateSeconds: 0,
            tags: [''],
          },
        }),
      ],
    })
  );
  const branchCodes = codesFor(
    defineModule({
      id: 'clean-public-page-branches',
      name: 'Clean Public Page Branches',
      version: '0.1.0',
      assets: {},
      pages: [
        page({
          id: 'clean-public-page-branches.docs',
          area: 'site',
          path: '/docs/[section]',
          frame: 'site',
          component: './pages/DocsPage.tsx',
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
        }),
      ],
    })
  );

  assert.deepEqual(validCodes, []);
  assert.equal(branchCodes.includes('MODULE_PUBLIC_SITE_METADATA_REQUIRED'), false);
  assert.equal(branchCodes.includes('MODULE_PUBLIC_SITE_CACHE_REQUIRED'), false);
  assert.ok(invalidCodes.includes('MODULE_PUBLIC_SITE_METADATA_REQUIRED'));
  assert.ok(invalidCodes.includes('MODULE_PUBLIC_ALIAS_RESERVED'));
  assert.ok(invalidCodes.includes('MODULE_PAGE_METADATA_REQUIRED_FIELD_INVALID'));
  assert.ok(invalidCodes.includes('MODULE_PUBLIC_ROUTE_PRIVATE_CACHE'));
  assert.ok(invalidCodes.includes('MODULE_ROUTE_CACHE_REVALIDATE_INVALID'));
  assert.ok(invalidCodes.includes('MODULE_ROUTE_CACHE_TAG_EMPTY'));
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

test('module contract validates signed service policies', () => {
  const valid = codesFor(
    defineModule({
      id: 'signed-policy-test',
      name: 'Signed Policy Test',
      version: '0.1.0',
      assets: {},
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
      pages: [
        page({
          id: 'dashboard-alias-test.home',
          area: 'dashboard',
          path: '/dashboard-alias',
          frame: 'workspace',
          component: './pages/DashboardPage',
          auth: 'auth',
          publicAliases: ['/tools/dashboard-alias'],
        }),
      ],
    })
  );

  assert.ok(codes.includes('MODULE_PUBLIC_ALIAS_SITE_ONLY'));
  assert.ok(codes.includes('MODULE_PUBLIC_ALIAS_PUBLIC_AUTH_REQUIRED'));
});

test('module contract validates dashboard and admin page aliases', () => {
  const codes = codesFor(
    defineModule({
      id: 'route-alias-test',
      name: 'Route Alias Test',
      version: '0.1.0',
      pages: [
        page({
          id: 'route-alias-test.home',
          area: 'dashboard',
          path: '/canonical',
          frame: 'workspace',
          component: './pages/DashboardPage',
          auth: 'auth',
          aliases: ['/canonical', '/alias/:dynamic', '/alias/:dynamic', '/alias?tab=one'],
        }),
      ],
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
      assets: {},
      pages: [
        page({
          id: 'param-selector-valid.home',
          area: 'dashboard',
          path: '/param-selector/[section]',
          frame: 'workspace',
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
        }),
      ],
    })
  );
  const invalid = codesFor(
    defineModule({
      id: 'param-selector-invalid',
      name: 'Param Selector Invalid',
      version: '0.1.0',
      pages: [
        page({
          id: 'param-selector-invalid.home',
          area: 'dashboard',
          path: '/param-selector/[section]',
          frame: 'workspace',
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
        }),
      ],
    })
  );
  const invalidPath = codesFor(
    defineModule({
      id: 'param-selector-invalid-path',
      name: 'Param Selector Invalid Path',
      version: '0.1.0',
      pages: [
        page({
          id: 'param-selector-invalid-path.home',
          area: 'dashboard',
          path: '/param-selector/[section]',
          frame: 'workspace',
          component: './pages/App',
          loaderByParam: {
            section: {
              agents: '../outside',
            },
          },
        }),
      ],
    })
  );

  assert.deepEqual(valid, []);
  assert.ok(invalid.includes('MODULE_ROUTE_PARAM_SELECTOR_COUNT_INVALID'));
  assert.ok(invalid.includes('MODULE_ROUTE_PARAM_SELECTOR_UNKNOWN'));
  assert.ok(invalidPath.includes('MODULE_LOCAL_PATH_INVALID'));
  assert.ok(invalid.includes('MODULE_ROUTE_CACHE_STRATEGY_INVALID'));
  assert.ok(invalid.includes('MODULE_ROUTE_CACHE_REVALIDATE_INVALID'));
});

test('module contract keeps public aliases and page aliases in separate lanes', () => {
  const siteCodes = codesFor(
    defineModule({
      id: 'site-route-alias-test',
      name: 'Site Route Alias Test',
      version: '0.1.0',
      pages: [
        page({
          id: 'site-route-alias-test.public',
          area: 'site',
          path: '/canonical',
          frame: 'site',
          component: './pages/SitePage',
          metadata: './loaders/site-meta',
          auth: 'public',
          aliases: ['/legacy'],
          cache: { strategy: 'public', revalidateSeconds: 300 },
        }),
      ],
    })
  );

  const conflictCodes = codesFor(
    defineModule({
      id: 'route-alias-conflict-test',
      name: 'Route Alias Conflict Test',
      version: '0.1.0',
      pages: [
        page({
          id: 'route-alias-conflict-test.order',
          area: 'dashboard',
          path: '/orders/[orderId]',
          frame: 'workspace',
          component: './pages/OrderPage',
          auth: 'auth',
        }),
        page({
          id: 'route-alias-conflict-test.archive',
          area: 'dashboard',
          path: '/orders/archive',
          frame: 'workspace',
          component: './pages/ArchivePage',
          auth: 'auth',
          aliases: ['/orders/[orderId]'],
        }),
      ],
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
      pages: [
        page({
          id: 'public-site-test.home',
          area: 'site',
          path: '/public-site-test',
          frame: 'site',
          component: './pages/PublicSitePage',
          auth: 'public',
        }),
        page({
          id: 'public-site-test.private-cache',
          area: 'site',
          path: '/private-cache',
          frame: 'site',
          component: './pages/PrivateCachePage',
          metadata: './loaders/private-cache-metadata',
          auth: 'public',
          cache: {
            strategy: 'private',
            revalidateSeconds: 0,
            tags: [''],
          },
        }),
      ],
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
      pages: [
        page({
          id: 'public-site-param-test.docs',
          area: 'site',
          path: '/docs/[section]',
          frame: 'site',
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
        }),
      ],
    })
  );
  const privateBranchCodes = codesFor(
    defineModule({
      id: 'public-site-param-private-test',
      name: 'Public Site Param Private Test',
      version: '0.1.0',
      pages: [
        page({
          id: 'public-site-param-private-test.docs',
          area: 'site',
          path: '/docs/[section]',
          frame: 'site',
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
        }),
      ],
    })
  );

  assert.equal(branchOnlyCodes.includes('MODULE_PUBLIC_SITE_METADATA_REQUIRED'), false);
  assert.equal(branchOnlyCodes.includes('MODULE_PUBLIC_SITE_CACHE_REQUIRED'), false);
  assert.ok(privateBranchCodes.includes('MODULE_PUBLIC_ROUTE_PRIVATE_CACHE'));
});

test('module contract rejects public machine-auth API routes', () => {
  const payload = payloadSchema('MachineAuthPayload');
  const codes = codesFor(
    defineModule({
      id: 'machine-auth-test',
      name: 'Machine Auth Test',
      version: '0.1.0',
      apis: [
        api({
          id: 'machine-auth-test.machine',
          path: '/machine',
          handler: './api/machine',
          auth: 'public',
          machineAuth: 'apiKey',
          input: payload,
          output: payload,
          anonymousPolicy: {
            rateLimit: {
              bucket: 'ip',
              limit: 10,
              window: '1m',
            },
          },
        }),
      ],
    })
  );

  assert.ok(codes.includes('MODULE_API_MACHINE_AUTH_NOT_PUBLIC'));
});

test('module contract validates API route idempotency declarations', () => {
  const payload = payloadSchema('ApiIdempotencyPayload');
  const codes = codesFor(
    defineModule({
      id: 'api-idempotency-test',
      name: 'API Idempotency Test',
      version: '0.1.0',
      apis: [
        api({
          id: 'api-idempotency-test.missing',
          path: '/missing-key-source',
          handler: './api/missing-key-source',
          auth: 'auth',
          methods: ['POST'],
          input: payload,
          output: payload,
          idempotency: { required: true },
        }),
        api({
          id: 'api-idempotency-test.invalid',
          path: '/invalid-key-source',
          handler: './api/invalid-key-source',
          auth: 'auth',
          methods: ['POST'],
          input: payload,
          output: payload,
          idempotency: { required: true, keyFrom: 'body' as never },
        }),
      ],
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
      assets: {},
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
  const payload = payloadSchema('AnonymousPolicyPayload');
  const codes = codesFor(
    defineModule({
      id: 'anonymous-policy-test',
      name: 'Anonymous Policy Test',
      version: '0.1.0',
      apis: [
        api({
          id: 'anonymous-policy-test.missing',
          path: '/missing-rate-limit',
          handler: './api/missing-rate-limit',
          methods: ['POST'],
          auth: 'public',
          input: payload,
          output: payload,
          anonymousPolicy: {},
        }),
        api({
          id: 'anonymous-policy-test.bad',
          path: '/bad-rate-limit',
          handler: './api/bad-rate-limit',
          methods: ['POST'],
          auth: 'public',
          input: payload,
          output: payload,
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
        }),
      ],
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
      pages: [
        page({
          id: 'commercial-test.paid',
          area: 'site',
          path: '/paid',
          frame: 'site',
          component: './pages/PaidPage',
          metadata: './loaders/paid-metadata',
          auth: 'auth',
          commercial: {
            entitlements: [''],
            credits: {
              amount: 0,
            },
          },
        }),
      ],
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
      assets: {
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
      assets: {
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
