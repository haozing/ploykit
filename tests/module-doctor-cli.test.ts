import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const runtimeDir = path.join('.runtime', 'test-modules', 'doctor-http');

function writeFixture(files: Record<string, string>): string {
  const fixtureRoot = path.join(runtimeDir, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(fixtureRoot, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  }
  return fixtureRoot;
}

function runDoctor(moduleRoot: string) {
  const result = childProcess.spawnSync(
    process.execPath,
    ['scripts/ploykit-module.mjs', 'doctor', moduleRoot],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    }
  );
  return {
    status: result.status,
    body: JSON.parse(result.stdout),
    stderr: result.stderr,
  };
}

test('module doctor catches ctx.http.fetch without permission and egress policy', () => {
  const moduleRoot = writeFixture({
    'module.ts': `
      import { defineModule } from '@ploykit/module-sdk';
      export default defineModule({
        id: 'doctor-http-missing',
        name: 'Doctor HTTP Missing',
        version: '0.1.0',
        actions: {
          callApi: {
            handler: './actions/call-api',
            auth: 'auth',
          },
        },
      });
    `,
    'actions/call-api.ts': `
      import { action } from '@ploykit/module-sdk';
      export default action(async (ctx) => {
        return ctx.http.fetch('https://api.example.com/v1');
      });
    `,
  });

  const result = runDoctor(moduleRoot);
  const codes = result.body.diagnostics.map((diagnostic: { code: string }) => diagnostic.code);

  assert.equal(result.status, 1, result.stderr);
  assert.ok(codes.includes('MODULE_HTTP_PERMISSION_MISSING'));
  assert.ok(codes.includes('MODULE_HTTP_EGRESS_MISSING'));
});

test('module doctor validates egress permission and explicit origins', () => {
  const moduleRoot = writeFixture({
    'module.ts': `
      import { defineModule } from '@ploykit/module-sdk';
      export default defineModule({
        id: 'doctor-egress-invalid',
        name: 'Doctor Egress Invalid',
        version: '0.1.0',
        egress: ['https://*.example.com/path'],
      });
    `,
  });

  const result = runDoctor(moduleRoot);
  const codes = result.body.diagnostics.map((diagnostic: { code: string }) => diagnostic.code);

  assert.equal(result.status, 1, result.stderr);
  assert.ok(codes.includes('MODULE_EGRESS_PERMISSION_REQUIRED'));
  assert.ok(codes.includes('MODULE_EGRESS_ORIGIN_INVALID'));
});

test('module doctor catches public site routes without SEO metadata or cache policy', () => {
  const moduleRoot = writeFixture({
    'module.ts': `
      import { defineModule } from '@ploykit/module-sdk';
      export default defineModule({
        id: 'doctor-public-site',
        name: 'Doctor Public Site',
        version: '0.1.0',
        routes: {
          site: [
            {
              path: '/doctor-public-site',
              component: './pages/PublicSitePage',
              auth: 'public',
            },
            {
              path: '/doctor-private-cache',
              component: './pages/PrivateCachePage',
              metadata: './loaders/private-cache-metadata',
              auth: 'public',
              cache: { strategy: 'private', revalidateSeconds: 0 },
            },
          ],
        },
      });
    `,
    'pages/PublicSitePage.ts': 'export default function PublicSitePage() { return null; }',
    'pages/PrivateCachePage.ts': 'export default function PrivateCachePage() { return null; }',
    'loaders/private-cache-metadata.ts': 'export default function metadata() { return {}; }',
  });

  const result = runDoctor(moduleRoot);
  const codes = result.body.diagnostics.map((diagnostic: { code: string }) => diagnostic.code);

  assert.equal(result.status, 1, result.stderr);
  assert.ok(codes.includes('MODULE_PUBLIC_SITE_METADATA_REQUIRED'));
  assert.ok(codes.includes('MODULE_PUBLIC_SITE_CACHE_REQUIRED'));
  assert.ok(codes.includes('MODULE_PUBLIC_ROUTE_PRIVATE_CACHE'));
  assert.ok(codes.includes('MODULE_ROUTE_CACHE_REVALIDATE_INVALID'));
});

test('module doctor validates public API anonymous policy details', () => {
  const moduleRoot = writeFixture({
    'module.ts': `
      import { defineModule } from '@ploykit/module-sdk';
      export default defineModule({
        id: 'doctor-public-api',
        name: 'Doctor Public API',
        version: '0.1.0',
        routes: {
          api: [
            {
              path: '/missing-policy',
              handler: './api/missing-policy',
              methods: ['POST'],
              auth: 'public',
            },
            {
              path: '/bad-policy',
              handler: './api/bad-policy',
              methods: ['POST'],
              auth: 'public',
              commercial: { credits: { amount: 1 } },
              anonymousPolicy: {
                rateLimit: { bucket: 'ip', limit: 0, window: 'soon' },
                maxUploadBytes: 0,
                captcha: 'sometimes',
                allowHighCostActions: true,
              },
            },
          ],
        },
      });
    `,
    'api/missing-policy.ts': "import { defineApi } from '@ploykit/module-sdk'; export default defineApi({ post(ctx) { return ctx.json({ ok: true }); } });",
    'api/bad-policy.ts': "import { defineApi } from '@ploykit/module-sdk'; export default defineApi({ post(ctx) { return ctx.json({ ok: true }); } });",
  });

  const result = runDoctor(moduleRoot);
  const codes = result.body.diagnostics.map((diagnostic: { code: string }) => diagnostic.code);

  assert.equal(result.status, 1, result.stderr);
  assert.ok(codes.includes('MODULE_PUBLIC_API_ANONYMOUS_POLICY_REQUIRED'));
  assert.ok(codes.includes('MODULE_PUBLIC_API_RATE_LIMIT_INVALID'));
  assert.ok(codes.includes('MODULE_PUBLIC_API_RATE_LIMIT_WINDOW_INVALID'));
  assert.ok(codes.includes('MODULE_PUBLIC_API_UPLOAD_LIMIT_INVALID'));
  assert.ok(codes.includes('MODULE_PUBLIC_API_CAPTCHA_INVALID'));
  assert.ok(codes.includes('MODULE_PUBLIC_API_HIGH_COST_ANONYMOUS_FORBIDDEN'));
});

test('module doctor requires ctx capability contract metadata declarations', () => {
  const moduleRoot = writeFixture({
    'module.ts': `
      import { defineModule, Permission } from '@ploykit/module-sdk';
      export default defineModule({
        id: 'doctor-contract-metadata',
        name: 'Doctor Contract Metadata',
        version: '0.1.0',
        permissions: [
          Permission.ConfigRead,
          Permission.SecretsRead,
          Permission.ServicesInvoke,
          Permission.ResourceBindingsRead,
        ],
        actions: {
          readProvider: {
            handler: './actions/read-provider',
            auth: 'auth',
          },
        },
      });
    `,
    'actions/read-provider.ts': `
      import { action } from '@ploykit/module-sdk';
      export default action(async (ctx) => {
        await ctx.config.require('region');
        await ctx.secrets.require('api_key');
        await ctx.services.invoke('ai', 'generate', { prompt: 'hello' });
        await ctx.resourceBindings.get('bucket');
        return { ok: true };
      });
    `,
  });

  const result = runDoctor(moduleRoot);
  const codes = result.body.diagnostics.map((diagnostic: { code: string }) => diagnostic.code);

  assert.equal(result.status, 1, result.stderr);
  assert.ok(codes.includes('MODULE_CONFIG_DECLARATION_MISSING'));
  assert.ok(codes.includes('MODULE_SECRET_CONFIG_DECLARATION_MISSING'));
  assert.ok(codes.includes('MODULE_SERVICE_REQUIREMENT_MISSING'));
  assert.ok(codes.includes('MODULE_RESOURCE_BINDING_DECLARATION_MISSING'));
});

test('module doctor forbids ctx.http for privileged service modules', () => {
  const moduleRoot = writeFixture({
    'module.ts': `
      import { defineModule, Permission } from '@ploykit/module-sdk';
      export default defineModule({
        contractVersion: 2,
        id: 'doctor-privileged-service',
        name: 'Doctor Privileged Service',
        version: '0.1.0',
        permissions: [Permission.ExternalHttp, Permission.ServicesInvoke],
        egress: ['https://signed-api.example'],
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
              requestId: '\${ctx.request.id}',
            },
            operations: {
              'admin.request': {
                auth: { type: 'bearer', secret: 'bearerToken' },
                signing: { type: 'hmac-sha256', secret: 'hmacSecret' },
              },
            },
          },
        },
        actions: {
          call: {
            handler: './actions/call',
            auth: 'auth',
          },
        },
      });
    `,
    'actions/call.ts': `
      import { action } from '@ploykit/module-sdk';
      export default action(async (ctx) => {
        return ctx.http.fetch('https://signed-api.example/admin/request');
      });
    `,
  });

  const result = runDoctor(moduleRoot);
  const codes = result.body.diagnostics.map((diagnostic: { code: string }) => diagnostic.code);

  assert.equal(result.status, 1, result.stderr);
  assert.ok(codes.includes('MODULE_PRIVILEGED_HTTP_FORBIDDEN'));
});

test('module doctor validates notification read and send permissions separately', () => {
  const sendModuleRoot = writeFixture({
    'module.ts': `
      import { defineModule, Permission } from '@ploykit/module-sdk';
      export default defineModule({
        id: 'doctor-notification-send',
        name: 'Doctor Notification Send',
        version: '0.1.0',
        permissions: [Permission.NotificationsRead],
        actions: {
          notify: {
            handler: './actions/notify',
            auth: 'auth',
          },
        },
      });
    `,
    'actions/notify.ts': `
      import { action } from '@ploykit/module-sdk';
      export default action(async (ctx) => {
        await ctx.notifications.send({ userId: 'user_1', title: 'Ready' });
        return { ok: true };
      });
    `,
  });
  const sendResult = runDoctor(sendModuleRoot);
  const sendCodes = sendResult.body.diagnostics.map((diagnostic: { code: string }) => diagnostic.code);

  assert.equal(sendResult.status, 1, sendResult.stderr);
  assert.ok(sendCodes.includes('MODULE_NOTIFICATIONS_SEND_PERMISSION_MISSING'));

  const readModuleRoot = writeFixture({
    'module.ts': `
      import { defineModule, Permission } from '@ploykit/module-sdk';
      export default defineModule({
        id: 'doctor-notification-read',
        name: 'Doctor Notification Read',
        version: '0.1.0',
        permissions: [Permission.NotificationsSend],
        actions: {
          inbox: {
            handler: './actions/inbox',
            auth: 'auth',
          },
        },
      });
    `,
    'actions/inbox.ts': `
      import { action } from '@ploykit/module-sdk';
      export default action(async (ctx) => ctx.notifications.list());
    `,
  });
  const readResult = runDoctor(readModuleRoot);
  const readCodes = readResult.body.diagnostics.map((diagnostic: { code: string }) => diagnostic.code);

  assert.equal(readResult.status, 1, readResult.stderr);
  assert.ok(readCodes.includes('MODULE_NOTIFICATIONS_READ_PERMISSION_MISSING'));
});

test('module doctor reuses SDK contract validation gates', () => {
  const moduleRoot = writeFixture({
    'module.ts': `
      import { defineModule, Permission } from '@ploykit/module-sdk';
      export default defineModule({
        id: 'doctor-sdk-validator',
        name: 'Doctor SDK Validator',
        version: '0.1.0',
        dependencies: {
          npm: {
            zod: '',
          },
        },
        routes: {
          api: [
            {
              path: '/doctor-sdk-validator',
              handler: './api/validator',
              auth: 'auth',
              permissions: [Permission.FilesRead],
            },
          ],
        },
        actions: {
          callExternal: {
            handler: './actions/call-external',
            sideEffect: 'external',
          },
        },
      });
    `,
    'api/validator.ts': "import { defineApi } from '@ploykit/module-sdk'; export default defineApi({ get(ctx) { return ctx.json({ ok: true }); } });",
    'actions/call-external.ts': "import { action } from '@ploykit/module-sdk'; export default action(async () => ({ ok: true }));",
  });

  const result = runDoctor(moduleRoot);
  const codes = result.body.diagnostics.map((diagnostic: { code: string }) => diagnostic.code);

  assert.equal(result.status, 1, result.stderr);
  assert.ok(codes.includes('MODULE_ENTRY_PERMISSION_NOT_DECLARED'));
  assert.ok(codes.includes('MODULE_ACTION_IDEMPOTENCY_REQUIRED'));
  assert.ok(codes.includes('MODULE_DEPENDENCY_VERSION_REQUIRED'));
});

test('module doctor rejects unsafe module npm dependency declarations', () => {
  const moduleRoot = writeFixture({
    'module.ts': `
      import { defineModule } from '@ploykit/module-sdk';
      export default defineModule({
        id: 'doctor-unsafe-dependencies',
        name: 'Doctor Unsafe Dependencies',
        version: '0.1.0',
        dependencies: {
          npm: {
            BadName: '^1.0.0',
            local: 'file:../local-package',
            workspace: 'workspace:*',
            remote: 'https://example.com/package.tgz',
            git: 'github:owner/repo',
            alias: 'npm:react@^19.0.0',
          },
        },
      });
    `,
  });

  const result = runDoctor(moduleRoot);
  const codes = result.body.diagnostics.map((diagnostic: { code: string }) => diagnostic.code);

  assert.equal(result.status, 1, result.stderr);
  assert.ok(codes.includes('MODULE_DEPENDENCY_NAME_INVALID'));
  assert.ok(codes.includes('MODULE_DEPENDENCY_SOURCE_FORBIDDEN'));
  assert.ok(codes.includes('MODULE_DEPENDENCY_ALIAS_FORBIDDEN'));
});

test('module doctor requires static dependencies.npm declarations', () => {
  const moduleRoot = writeFixture({
    'module.ts': `
      import { defineModule } from '@ploykit/module-sdk';
      const npm = { react: '^19.0.0' };
      export default defineModule({
        id: 'doctor-dynamic-dependencies',
        name: 'Doctor Dynamic Dependencies',
        version: '0.1.0',
        dependencies: { npm },
      });
    `,
  });

  const result = runDoctor(moduleRoot);
  const codes = result.body.diagnostics.map((diagnostic: { code: string }) => diagnostic.code);

  assert.equal(result.status, 1, result.stderr);
  assert.ok(codes.includes('MODULE_DEPENDENCY_STATIC_DECLARATION_REQUIRED'));
});

test('module doctor does not evaluate contracts after source boundary errors', () => {
  const moduleRoot = writeFixture({
    'module.ts': `
      import fs from 'node:fs';
      import { defineModule } from '@ploykit/module-sdk';

      const dynamicSpecifier = 'node:path';
      void import(dynamicSpecifier);
      fs.writeFileSync(new URL('./side-effect.txt', import.meta.url), 'executed');

      export default defineModule({
        id: 'doctor-source-boundary',
        name: 'Doctor Source Boundary',
        version: '0.1.0',
      });
    `,
  });

  const result = runDoctor(moduleRoot);
  const codes = result.body.diagnostics.map((diagnostic: { code: string }) => diagnostic.code);

  assert.equal(result.status, 1, result.stderr);
  assert.ok(codes.includes('MODULE_NODE_BUILTIN_FORBIDDEN'));
  assert.ok(codes.includes('MODULE_DYNAMIC_IMPORT_FORBIDDEN'));
  assert.ok(codes.includes('MODULE_CONTRACT_EVALUATION_SKIPPED'));
  assert.equal(fs.existsSync(path.join(moduleRoot, 'side-effect.txt')), false);
});

test('module doctor validates data migrations and lifecycle handlers', () => {
  const moduleRoot = writeFixture({
    'module.ts': `
      import { defineModule, table, text } from '@ploykit/module-sdk';
      export default defineModule({
        id: 'doctor-data-lifecycle',
        name: 'Doctor Data Lifecycle',
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
          install: './lifecycle/install',
        },
      });
    `,
    'lifecycle/start.ts': 'export default async function start() {}',
    'lifecycle/install.ts': 'export async function install() {}',
  });

  const result = runDoctor(moduleRoot);
  const codes = result.body.diagnostics.map((diagnostic: { code: string }) => diagnostic.code);

  assert.equal(result.status, 1, result.stderr);
  assert.ok(codes.includes('MODULE_DATA_MIGRATIONS_REQUIRED'));
  assert.ok(codes.includes('MODULE_LIFECYCLE_HOOK_UNKNOWN'));
  assert.ok(codes.includes('MODULE_LIFECYCLE_HANDLER_EXPORT_REQUIRED'));
});

test('module doctor emits structured diagnostics and summary for split contract parts', () => {
  const moduleRoot = writeFixture({
    'module.ts': `
      import { defineModule } from '@ploykit/module-sdk';
      export default defineModule({
        id: 'doctor-split-contract',
        name: 'Doctor Split Contract',
        version: '0.1.0',
        parts: {
          routes: './routes',
        },
        routes: {},
      });
    `,
    'routes.ts': 'export const notRoutes = [];',
  });

  const result = runDoctor(moduleRoot);
  const warning = result.body.diagnostics.find(
    (diagnostic: { code: string }) => diagnostic.code === 'MODULE_PART_EXPORT_UNCLEAR'
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.body.summary.parts.includes('routes'));
  assert.equal(typeof result.body.summary.sourceHash, 'string');
  assert.equal(typeof result.body.summary.contractDigest, 'string');
  assert.equal(warning.category, 'contract');
  assert.equal(warning.subsystem, 'module');
});
