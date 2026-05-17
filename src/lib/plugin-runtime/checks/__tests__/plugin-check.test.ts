import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { definePlugin, Permission, type PermissionValue } from '@ploykit/plugin-sdk';
import { checkPluginTargets } from '../plugin-check';

const tempRoots: string[] = [];

function createPluginRoot(name: string): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ploykit-plugin-check-${name}-`));
  const pluginRoot = path.join(tempRoot, name);
  fs.mkdirSync(pluginRoot, { recursive: true });
  tempRoots.push(tempRoot);
  return pluginRoot;
}

function writePluginFile(pluginRoot: string, relativePath: string, content: string): void {
  const filePath = path.join(pluginRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function createContract(
  pluginRoot: string,
  permissions: readonly PermissionValue[],
  options: {
    egress?: readonly string[];
    services?: Parameters<typeof definePlugin>[0]['services'];
    resourceBindings?: Parameters<typeof definePlugin>[0]['resourceBindings'];
  } = {}
) {
  return definePlugin({
    id: path.basename(pluginRoot),
    name: 'Check Fixture',
    version: '1.0.0',
    permissions,
    egress: options.egress,
    services: options.services,
    resourceBindings: options.resourceBindings,
  });
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('plugin check', () => {
  it('loads a real definePlugin contract from plugin.ts', async () => {
    const fixtureRoot = path.resolve(
      process.cwd(),
      'src/lib/plugin-runtime/checks/__fixtures__/loader-valid'
    );

    const report = await checkPluginTargets(fixtureRoot);

    expect(report.success).toBe(true);
    expect(report.checked).toBe(1);
    expect(report.diagnostics).toEqual([]);
  });

  it('passes when SDK imports and declared ctx permissions line up', async () => {
    const pluginRoot = createPluginRoot('valid-plugin');
    writePluginFile(
      pluginRoot,
      'plugin.ts',
      `
import { definePlugin } from '@ploykit/plugin-sdk';

export default definePlugin({
  id: 'valid-plugin',
  name: 'Valid Plugin',
  version: '1.0.0',
});
`
    );
    writePluginFile(
      pluginRoot,
      'api/todos.ts',
      `
import { defineApi } from '@ploykit/plugin-sdk';

export default defineApi({
  get: async (ctx) => {
    await ctx.files.read('file-1');
    await ctx.storage.collection('todos').findMany();
    await ctx.http.fetch('https://api.example.test/v1/items');
    return new Response('ok');
  },
});
`
    );

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        createContract(
          root,
          [Permission.FilesRead, Permission.StorageRead, Permission.ExternalHttp],
          {
            egress: ['https://api.example.test'],
          }
        ),
    });

    expect(report.success).toBe(true);
    expect(report.diagnostics).toEqual([]);
  });

  it('fails when plugin code imports host internals from nested files', async () => {
    const pluginRoot = createPluginRoot('host-import');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'api/report.ts',
      `
import { db } from '@/lib/db/client.server';

export function report() {
  return db;
}
`
    );

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) => createContract(root, []),
    });

    expect(report.success).toBe(false);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PLUGIN_IMPORT_FORBIDDEN',
          severity: 'error',
          fix: expect.any(String),
        }),
      ])
    );
  });

  it('fails manifest-only legacy plugin directories', async () => {
    const pluginRoot = createPluginRoot('legacy-plugin');
    writePluginFile(pluginRoot, 'manifest.ts', `export default { id: 'legacy-plugin' };`);
    writePluginFile(
      pluginRoot,
      'index.tsx',
      `export default function LegacyPlugin() { return null; }`
    );

    const report = await checkPluginTargets(path.dirname(pluginRoot));

    expect(report.success).toBe(false);
    expect(report.checked).toBe(1);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'LEGACY_PLUGIN_ENTRY_FORBIDDEN',
          severity: 'error',
        }),
      ])
    );
  });

  it('fails definePlugin directories that still keep legacy entry files', async () => {
    const pluginRoot = createPluginRoot('mixed-plugin');
    writePluginFile(
      pluginRoot,
      'plugin.ts',
      `
import { definePlugin } from '@ploykit/plugin-sdk';

export default definePlugin({
  id: 'mixed-plugin',
  name: 'Mixed Plugin',
  version: '1.0.0',
});
`
    );
    writePluginFile(pluginRoot, 'manifest.ts', `export default { id: 'mixed-plugin' };`);

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) => createContract(root, []),
    });

    expect(report.success).toBe(false);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'LEGACY_PLUGIN_ENTRY_FORBIDDEN',
          severity: 'error',
        }),
      ])
    );
  });

  it('fails on dangerous Node APIs and dynamic code execution', async () => {
    const pluginRoot = createPluginRoot('dangerous-plugin');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'api/danger.ts',
      `
import { exec } from 'node:child_process';
const fs = require('node:fs');

export function run() {
  eval('1 + 1');
  fs.existsSync('.');
  return new Function('return 1')();
}
`
    );

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) => createContract(root, []),
    });

    expect(report.success).toBe(false);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'PLUGIN_NODE_IMPORT_FORBIDDEN',
        'PLUGIN_EVAL_FORBIDDEN',
        'PLUGIN_FUNCTION_FORBIDDEN',
      ])
    );
  });

  it('fails direct external fetch and process.env access', async () => {
    const pluginRoot = createPluginRoot('network-plugin');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'api/network.ts',
      `
export async function run() {
  await fetch('https://api.example.com/v1/items');
  await globalThis.fetch('http://legacy.example.com/hook');
  const token = process.env.API_TOKEN;
  return token;
}
`
    );

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) => createContract(root, [Permission.ExternalHttp]),
    });

    expect(report.success).toBe(false);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['PLUGIN_EXTERNAL_FETCH_FORBIDDEN', 'PLUGIN_PROCESS_ENV_FORBIDDEN'])
    );
  });

  it('fails when ctx usage needs a permission not declared by plugin.ts', async () => {
    const pluginRoot = createPluginRoot('missing-permission');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'api/upload.ts',
      `
import { defineApi } from '@ploykit/plugin-sdk';

export default defineApi({
  post: async (ctx) => {
    await ctx.files.createUpload({
      scope: { type: 'user' },
      fileName: 'a.txt',
      contentType: 'text/plain',
      size: 5,
      purpose: 'source',
      body: new TextEncoder().encode('hello'),
    });
    return new Response('ok');
  },
});
`
    );

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) => createContract(root, [Permission.FilesRead]),
    });

    expect(report.success).toBe(false);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
          severity: 'error',
          fix: 'Add Permission.FilesWrite to plugin.ts permissions.',
        }),
      ])
    );
  });

  it('captures billing and notifications capability permissions from ctx usage', async () => {
    const pluginRoot = createPluginRoot('commercial-permissions');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'api/commercial.ts',
      `
export async function run(ctx) {
  const plan = await ctx.billing.getCurrentPlan();
  const canExport = await ctx.billing.hasEntitlement('feature.export');
  await ctx.billing.grantPlan({ planId: 'pro-plan', reason: 'manual-code' });
  await ctx.billing.redeemCode({ code: 'WELCOME-2026' });
  await ctx.notifications.send({ message: canExport ? 'Ready' : 'Upgrade required' });
  return ctx.json({ plan, canExport });
}
`
    );

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        createContract(root, [
          Permission.BillingRead,
          Permission.BillingWrite,
          Permission.NotificationsSend,
        ]),
    });

    expect(report.success).toBe(true);
    expect(
      report.diagnostics.filter((diagnostic) => diagnostic.code === 'PLUGIN_PERMISSION_UNUSED')
    ).toEqual([]);
  });

  it('captures credit capability permissions from ctx usage', async () => {
    const pluginRoot = createPluginRoot('credit-permissions');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'api/credits.ts',
      `
export async function run(ctx) {
  const balance = await ctx.credits.getBalance();
  const consumed = await ctx.credits.consume({
    meter: 'credit-permissions.external-api',
    amount: 1,
    idempotencyKey: 'credit-call-1',
  });
  return ctx.json({ balance, consumed });
}
`
    );

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        createContract(root, [Permission.CreditsRead, Permission.CreditsConsume]),
    });

    expect(report.success).toBe(true);
    expect(
      report.diagnostics.filter((diagnostic) => diagnostic.code === 'PLUGIN_PERMISSION_UNUSED')
    ).toEqual([]);
  });

  it('captures artifact capability permissions from ctx usage', async () => {
    const pluginRoot = createPluginRoot('artifact-permissions');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'api/artifacts.ts',
      `
export async function run(ctx) {
  const scope = { type: 'workspace', id: 'workspace-1' };
  await ctx.artifacts.writeText({
    scope,
    path: 'docs/outline.md',
    content: '# Outline',
    contentType: 'text/markdown',
  });
  const artifact = await ctx.artifacts.readText({
    scope,
    path: 'docs/outline.md',
  });
  const list = await ctx.artifacts.list({ scope });
  const tree = await ctx.artifacts.tree({ scope });
  await ctx.artifacts.updateMetadata({
    scope,
    path: 'docs/outline.md',
    metadata: { indexed: true },
  });
  await ctx.artifacts.delete({ scope, path: 'docs/outline.md' });
  return ctx.json({ artifact, list, tree });
}
`
    );

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        createContract(root, [Permission.ArtifactsRead, Permission.ArtifactsWrite]),
    });

    expect(report.success).toBe(true);
    expect(
      report.diagnostics.filter((diagnostic) => diagnostic.code === 'PLUGIN_PERMISSION_UNUSED')
    ).toEqual([]);
  });

  it('captures RAG capability permissions from ctx usage', async () => {
    const pluginRoot = createPluginRoot('rag-permissions');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'api/rag.ts',
      `
export async function run(ctx) {
  const scope = { type: 'workspace', id: 'workspace-1' };
  await ctx.rag.index({
    scope,
    path: 'docs/source.md',
  });
  const hits = await ctx.rag.search({
    scope,
    query: 'source',
  });
  const pack = await ctx.rag.buildContextPack({
    scope,
    query: 'source',
  });
  await ctx.rag.delete({
    scope,
    path: 'docs/source.md',
  });
  return ctx.json({ hits, pack });
}
`
    );

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) => createContract(root, [Permission.RagRead, Permission.RagWrite]),
    });

    expect(report.success).toBe(true);
    expect(
      report.diagnostics.filter((diagnostic) => diagnostic.code === 'PLUGIN_PERMISSION_UNUSED')
    ).toEqual([]);
  });

  it('captures AI capability permissions from ctx usage', async () => {
    const pluginRoot = createPluginRoot('ai-permissions');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'api/ai.ts',
      `
export async function run(ctx) {
  const draft = await ctx.ai.generateText({
    prompt: 'Write a summary',
    meter: 'ai-permissions.ai.generate',
  });
  const stream = ctx.ai.streamText({
    prompt: 'Stream a summary',
    meter: 'ai-permissions.ai.stream',
  });
  for await (const _event of stream) {}
  const embedding = await ctx.ai.embedText({
    input: draft.text,
    meter: 'ai-permissions.ai.embed',
  });
  return ctx.json({ draft, embedding });
}
`
    );

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        createContract(root, [Permission.AiGenerate, Permission.AiEmbed]),
    });

    expect(report.success).toBe(true);
    expect(
      report.diagnostics.filter((diagnostic) => diagnostic.code === 'PLUGIN_PERMISSION_UNUSED')
    ).toEqual([]);
  });

  it('captures platform capability permissions from ctx usage', async () => {
    const pluginRoot = createPluginRoot('platform-capability-permissions');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'api/platform.ts',
      `
export async function run(ctx) {
  const workspace =
    (await ctx.workspace.current()) ??
    (await ctx.workspace.create({ name: 'Workspace' }));
  const members = await ctx.workspace.members(workspace.id);
  const canManage = await ctx.workspace.hasRole(['owner', 'admin'], workspace.id);
  const run = await ctx.runs.create({
    scope: { type: 'workspace', id: workspace.id },
    title: 'Pipeline',
  });
  await ctx.runs.update(run.id, { status: 'running' });
  await ctx.runs.appendLog(run.id, { level: 'info', message: 'started' });
  await ctx.runs.addResult(run.id, { type: 'external', ref: 'job-1' });
  await ctx.runs.complete(run.id);
  const runList = await ctx.runs.list({ scope: { type: 'workspace', id: workspace.id } });
  const apiKey = await ctx.apiKeys.create({
    name: 'Worker',
    scope: { type: 'workspace', id: workspace.id },
  });
  const apiKeys = await ctx.apiKeys.list({ scope: { type: 'workspace', id: workspace.id } });
  await ctx.apiKeys.revoke(apiKey.id);
  await ctx.rateLimit.check({ bucket: 'platform-capability-permissions.run', limit: 10, window: '1m' });
  await ctx.connectors.upsert({ name: 'demo', baseUrl: 'https://api.example.test' });
  const connectors = await ctx.connectors.list();
  await ctx.connectors.setStatus('demo', 'active');
  const connector = await ctx.connectors.get('demo');
  const call = await ctx.connectors.call('demo', { path: '/run', runId: run.id });
  const callback = await ctx.connectors.createSignedCallback({ connector: 'demo', runId: run.id });
  await ctx.connectors.delete('demo');
  await ctx.workspace.invite({
    workspaceId: workspace.id,
    email: 'editor@example.test',
    role: 'editor',
  });
  return ctx.json({ members, canManage, runList, apiKeys, connectors, connector, call, callback });
}
`
    );

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        createContract(root, [
          Permission.WorkspaceRead,
          Permission.WorkspaceWrite,
          Permission.RunsRead,
          Permission.RunsWrite,
          Permission.ApiKeysRead,
          Permission.ApiKeysWrite,
          Permission.RateLimitCheck,
          Permission.ConnectorsRead,
          Permission.ConnectorsInvoke,
          Permission.ConnectorsManage,
        ]),
    });

    expect(report.success).toBe(true);
    expect(
      report.diagnostics.filter((diagnostic) => diagnostic.code === 'PLUGIN_PERMISSION_UNUSED')
    ).toEqual([]);
  });

  it('warns when plugin.ts declares permissions that are not used', async () => {
    const pluginRoot = createPluginRoot('unused-permission');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'api/ping.ts',
      `
export async function ping(ctx) {
  return ctx.json({ ok: true });
}
`
    );

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) => createContract(root, [Permission.FilesRead]),
    });

    expect(report.success).toBe(true);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PLUGIN_PERMISSION_UNUSED',
          severity: 'warning',
          fix: 'Remove Permission.FilesRead from plugin.ts permissions if it is not needed.',
        }),
      ])
    );
  });

  it('counts contract declarations as permission usage for unused-permission warnings', async () => {
    const pluginRoot = createPluginRoot('contract-permissions');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(pluginRoot, 'pages/Admin.tsx', `export default function AdminPage() {}`);
    writePluginFile(pluginRoot, 'pages/AboutOverride.tsx', `export default function About() {}`);
    writePluginFile(pluginRoot, 'slots/HomeBefore.tsx', `export default function HomeBefore() {}`);
    writePluginFile(pluginRoot, 'api/admin.ts', `export default {};`);
    writePluginFile(pluginRoot, 'jobs/sync.ts', `export default async function sync() {}`);
    writePluginFile(
      pluginRoot,
      'events/requested.ts',
      `export default async function requested() {}`
    );
    writePluginFile(
      pluginRoot,
      'webhooks/ingest.ts',
      `export default async function ingest() { return new Response('ok'); }`
    );

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        definePlugin({
          id: path.basename(root),
          name: 'Contract Permissions',
          version: '1.0.0',
          trustLevel: 'trusted',
          permissions: [
            Permission.BillingRead,
            Permission.EventsEmit,
            Permission.EventsSubscribe,
            Permission.JobsRegister,
            Permission.WebhookReceive,
            Permission.ResourceBindingsRead,
            Permission.ResourceBindingsWrite,
            Permission.NavigationExtend,
            Permission.HostPageExtend,
            Permission.HostPageOverride,
          ],
          routes: {
            pages: [
              {
                path: '/reports',
                component: './pages/Admin',
                permissions: [Permission.BillingRead],
              },
            ],
            apis: [
              {
                path: '/reports',
                handler: './api/admin',
                methods: ['GET'],
                permissions: [Permission.BillingRead],
              },
            ],
          },
          events: {
            publishes: ['contract-permissions.sent'],
            subscribes: {
              'contract-permissions.requested': './events/requested',
            },
          },
          jobs: {
            'contract-permissions.sync': {
              handler: './jobs/sync',
            },
          },
          webhooks: {
            ingest: {
              path: '/ingest',
              handler: './webhooks/ingest',
            },
          },
          resourceBindings: [
            {
              type: 'project',
              scope: 'workspace',
              cardinality: 'one',
            },
          ],
          menu: {
            location: 'site.header',
            label: 'Reports',
            path: '/reports',
          },
          hostPages: {
            slots: [
              {
                page: '/',
                position: 'hero.before',
                component: './slots/HomeBefore',
              },
            ],
            overrides: [
              {
                page: '/about',
                mode: 'main.replace',
                component: './pages/AboutOverride',
                seo: {
                  titleKey: 'about.seo.title',
                  descriptionKey: 'about.seo.description',
                  canonical: '/about',
                },
                i18n: {
                  requiredLocales: ['en', 'zh'],
                },
              },
            ],
          },
        }),
    });

    expect(report.success).toBe(true);
    expect(
      report.diagnostics.filter((diagnostic) => diagnostic.code === 'PLUGIN_PERMISSION_UNUSED')
    ).toEqual([]);
  });

  it('fails when egress is declared without Permission.ExternalHttp', async () => {
    const pluginRoot = createPluginRoot('egress-permission-missing');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        createContract(root, [], {
          egress: ['https://api.example.com'],
        }),
    });

    expect(report.success).toBe(false);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
          severity: 'error',
          fix: 'Add Permission.ExternalHttp to plugin.ts permissions.',
        }),
      ])
    );
  });

  it('fails when declared job, event, or webhook handlers do not exist', async () => {
    const pluginRoot = createPluginRoot('missing-handlers');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        definePlugin({
          id: path.basename(root),
          name: 'Missing Handlers',
          version: '1.0.0',
          permissions: [
            Permission.JobsRegister,
            Permission.EventsSubscribe,
            Permission.WebhookReceive,
          ],
          jobs: {
            'missing-handlers.sync': {
              handler: './jobs/sync',
            },
          },
          events: {
            subscribes: {
              'missing-handlers.requested': './events/requested',
            },
          },
          webhooks: {
            ingest: {
              path: '/ingest',
              handler: './webhooks/ingest',
            },
          },
        }),
    });

    expect(report.success).toBe(false);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'PLUGIN_JOB_HANDLER_NOT_FOUND',
        'PLUGIN_EVENT_HANDLER_NOT_FOUND',
        'PLUGIN_WEBHOOK_HANDLER_NOT_FOUND',
      ])
    );
  });

  it('fails when declared render or sitemap hook handlers do not exist', async () => {
    const pluginRoot = createPluginRoot('missing-hook-handlers');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        definePlugin({
          id: path.basename(root),
          name: 'Missing Hook Handlers',
          version: '1.0.0',
          hooks: {
            renderHead: { handler: './hooks/render-head' },
            sitemap: { handler: './hooks/sitemap' },
          },
        }),
    });

    expect(report.success).toBe(false);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['PLUGIN_HOOK_HANDLER_NOT_FOUND'])
    );
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'hooks.renderHead.handler',
        }),
        expect.objectContaining({
          path: 'hooks.sitemap.handler',
        }),
      ])
    );
  });

  it('accepts declared hook handlers that exist inside the plugin root', async () => {
    const pluginRoot = createPluginRoot('hook-handlers');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'hooks/render-head.ts',
      `export default async function render() {}`
    );
    writePluginFile(pluginRoot, 'hooks/sitemap.ts', `export default async function sitemap() {}`);

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        definePlugin({
          id: path.basename(root),
          name: 'Hook Handlers',
          version: '1.0.0',
          hooks: {
            renderHead: { handler: './hooks/render-head' },
            sitemap: { handler: './hooks/sitemap' },
          },
        }),
    });

    expect(report.success).toBe(true);
    expect(report.diagnostics).toEqual([]);
  });

  it('fails when declared slot components do not exist', async () => {
    const pluginRoot = createPluginRoot('missing-slot-components');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        definePlugin({
          id: path.basename(root),
          name: 'Missing Slot Components',
          version: '1.0.0',
          trustLevel: 'trusted',
          slots: {
            'header:extra': './slots/HeaderExtra',
            'site.home:main.after': { component: './slots/HomeAfter', priority: 20 },
          },
        }),
    });

    expect(report.success).toBe(false);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['PLUGIN_SLOT_COMPONENT_NOT_FOUND'])
    );
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'slots.header:extra.0.component',
        }),
        expect.objectContaining({
          path: 'slots.site.home:main.after.0.component',
        }),
      ])
    );
  });

  it('accepts declared slot components that exist inside the plugin root', async () => {
    const pluginRoot = createPluginRoot('slot-components');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'slots/HeaderExtra.tsx',
      `export default function HeaderExtra() {}`
    );
    writePluginFile(pluginRoot, 'slots/HomeAfter.tsx', `export default function HomeAfter() {}`);

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        definePlugin({
          id: path.basename(root),
          name: 'Slot Components',
          version: '1.0.0',
          trustLevel: 'trusted',
          slots: {
            'header:extra': './slots/HeaderExtra',
            'site.home:main.after': { component: './slots/HomeAfter', priority: 20 },
          },
        }),
    });

    expect(report.success).toBe(true);
    expect(report.diagnostics).toEqual([]);
  });

  it('fails when declared host page slot or override components do not exist', async () => {
    const pluginRoot = createPluginRoot('missing-host-page-components');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        definePlugin({
          id: path.basename(root),
          name: 'Missing Host Page Components',
          version: '1.0.0',
          trustLevel: 'trusted',
          permissions: [Permission.HostPageExtend, Permission.HostPageOverride],
          hostPages: {
            slots: [
              {
                page: '/',
                position: 'hero.before',
                component: './components/HomeBanner',
              },
            ],
            overrides: [
              {
                page: '/about',
                mode: 'main.replace',
                component: './pages/AboutOverride',
                seo: {
                  titleKey: 'about.seo.title',
                  descriptionKey: 'about.seo.description',
                  canonical: '/about',
                },
                i18n: {
                  requiredLocales: ['en', 'zh'],
                },
              },
            ],
          },
        }),
    });

    expect(report.success).toBe(false);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PLUGIN_HOST_PAGE_SLOT_COMPONENT_NOT_FOUND',
          path: 'hostPages.slots.0.component',
        }),
        expect.objectContaining({
          code: 'PLUGIN_HOST_PAGE_OVERRIDE_COMPONENT_NOT_FOUND',
          path: 'hostPages.overrides.0.component',
        }),
      ])
    );
  });

  it('accepts host page slot components from the plugin components directory', async () => {
    const pluginRoot = createPluginRoot('host-page-component-slot');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'components/HomeBanner.tsx',
      `export default function HomeBanner() {}`
    );

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        definePlugin({
          id: path.basename(root),
          name: 'Host Page Component Slot',
          version: '1.0.0',
          trustLevel: 'trusted',
          permissions: [Permission.HostPageExtend],
          hostPages: {
            slots: [
              {
                page: '/',
                position: 'hero.before',
                component: './components/HomeBanner',
              },
            ],
          },
        }),
    });

    expect(report.success).toBe(true);
    expect(report.diagnostics).toEqual([]);
  });

  it('fails when declared page, API, or lifecycle handlers do not exist', async () => {
    const pluginRoot = createPluginRoot('missing-route-handlers');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        definePlugin({
          id: path.basename(root),
          name: 'Missing Route Handlers',
          version: '1.0.0',
          routes: {
            pages: [{ path: '/', component: './pages/Home' }],
            apis: [{ path: '/items', handler: './api/items', methods: ['GET'] }],
          },
          lifecycle: {
            install: './lifecycle/install',
          },
        }),
    });

    expect(report.success).toBe(false);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'PLUGIN_PAGE_COMPONENT_NOT_FOUND',
        'PLUGIN_API_HANDLER_NOT_FOUND',
        'PLUGIN_LIFECYCLE_HANDLER_NOT_FOUND',
      ])
    );
  });

  it('fails when declared frontend assets are missing or exceed their size limit', async () => {
    const pluginRoot = createPluginRoot('asset-boundary');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(pluginRoot, 'assets/icon.png', 'png');
    writePluginFile(pluginRoot, 'assets/large.json', '{"too":"large"}');

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        definePlugin({
          id: path.basename(root),
          name: 'Asset Boundary',
          version: '1.0.0',
          resources: {
            assets: [
              './assets/icon.png',
              './assets/missing.png',
              { path: './assets/large.json', maxBytes: 2 },
            ],
          },
        }),
    });

    expect(report.success).toBe(false);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PLUGIN_ASSET_FILE_NOT_FOUND',
          severity: 'error',
        }),
        expect.objectContaining({
          code: 'PLUGIN_ASSET_SIZE_EXCEEDED',
          severity: 'error',
        }),
      ])
    );
  });

  it('fails runtime route conflicts and menu paths that do not point at page routes', async () => {
    const pluginRoot = createPluginRoot('route-conflicts');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(pluginRoot, 'pages/Settings.tsx', `export default function Settings() {}`);
    writePluginFile(pluginRoot, 'pages/SettingsDuplicate.tsx', `export default function Dupe() {}`);
    writePluginFile(pluginRoot, 'api/items.ts', `export default {};`);
    writePluginFile(pluginRoot, 'api/items-duplicate.ts', `export default {};`);

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) => ({
        id: path.basename(root),
        permissions: [],
        routes: {
          pages: [
            { path: '/settings', component: './pages/Settings', layout: 'dashboard' },
            { path: '/settings/', component: './pages/SettingsDuplicate', layout: 'dashboard' },
          ],
          apis: [
            { path: '/items', handler: './api/items', methods: ['GET'] },
            { path: '/items/', handler: './api/items-duplicate', methods: ['GET'] },
          ],
        },
        menu: {
          location: 'dashboard.sidebar',
          label: 'Missing',
          path: '/missing',
        },
      }),
    });

    expect(report.success).toBe(false);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'PLUGIN_RUNTIME_PAGE_ROUTE_CONFLICT',
        'PLUGIN_RUNTIME_API_ROUTE_CONFLICT',
        'PLUGIN_MENU_ROUTE_UNKNOWN',
      ])
    );
  });

  it('accepts plugin-local menu i18n keys without direct labels', async () => {
    const pluginRoot = createPluginRoot('menu-i18n');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(pluginRoot, 'pages/Home.tsx', `export default function Home() {}`);

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) => ({
        id: path.basename(root),
        permissions: [Permission.NavigationExtend],
        routes: {
          pages: [{ path: '/', component: './pages/Home', layout: 'dashboard' }],
        },
        resources: {
          locales: {
            en: './locales/en.json',
            zh: './locales/zh.json',
          },
        },
        menu: {
          location: 'dashboard.sidebar',
          labelKey: 'menu.console',
          fallbackLabel: 'Console',
          groupKey: 'menu.groups.apps',
          fallbackGroup: 'Apps',
          path: '/',
        },
      }),
    });

    expect(report.success).toBe(true);
    expect(report.diagnostics).toEqual([]);
  });

  it('fails ambiguous dynamic page, API, and webhook route patterns', async () => {
    const pluginRoot = createPluginRoot('dynamic-route-conflicts');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(pluginRoot, 'pages/Item.tsx', `export default function Item() {}`);
    writePluginFile(
      pluginRoot,
      'pages/ItemDuplicate.tsx',
      `export default function ItemDuplicate() {}`
    );
    writePluginFile(pluginRoot, 'api/item.ts', `export default {};`);
    writePluginFile(pluginRoot, 'api/item-static.ts', `export default {};`);
    writePluginFile(pluginRoot, 'webhooks/events.ts', `export default function handler() {}`);
    writePluginFile(pluginRoot, 'webhooks/provider.ts', `export default function handler() {}`);

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) => ({
        id: path.basename(root),
        permissions: [Permission.WebhookReceive],
        routes: {
          pages: [
            { path: '/items/:id', component: './pages/Item', layout: 'dashboard' },
            { path: '/items/[itemId]', component: './pages/ItemDuplicate', layout: 'dashboard' },
          ],
          apis: [
            { path: '/items/:id', handler: './api/item', methods: ['GET'] },
            { path: '/items/new', handler: './api/item-static', methods: ['GET'] },
          ],
        },
        webhooks: {
          events: {
            path: '/events/[...path]',
            handler: './webhooks/events',
            methods: ['POST'],
          },
          provider: {
            path: '/events/:provider',
            handler: './webhooks/provider',
            methods: ['POST'],
          },
        },
      }),
    });

    expect(report.success).toBe(false);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PLUGIN_RUNTIME_PAGE_ROUTE_CONFLICT',
          severity: 'error',
          details: expect.objectContaining({ samplePath: '/items/value' }),
        }),
        expect.objectContaining({
          code: 'PLUGIN_RUNTIME_API_ROUTE_CONFLICT',
          severity: 'error',
          details: expect.objectContaining({ samplePath: '/items/new' }),
        }),
        expect.objectContaining({
          code: 'PLUGIN_RUNTIME_WEBHOOK_ROUTE_CONFLICT',
          severity: 'error',
          details: expect.objectContaining({ samplePath: '/events/value' }),
        }),
      ])
    );
  });

  it('surfaces definePlugin validation diagnostics without hiding them behind load failure', async () => {
    const pluginRoot = createPluginRoot('real-dynamic-route-conflict');
    writePluginFile(
      pluginRoot,
      'plugin.ts',
      `
import { definePlugin } from '@ploykit/plugin-sdk';

export default definePlugin({
  id: 'real-dynamic-route-conflict',
  name: 'Real Dynamic Route Conflict',
  version: '1.0.0',
  routes: {
    apis: [
      { path: '/items/:id', handler: './api/item', methods: ['GET'] },
      { path: '/items/new', handler: './api/item-new', methods: ['GET'] },
    ],
  },
});
`
    );

    const report = await checkPluginTargets(pluginRoot);

    expect(report.success).toBe(false);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PLUGIN_RUNTIME_API_ROUTE_CONFLICT',
          severity: 'error',
          path: 'routes.apis.1.methods.0',
        }),
      ])
    );
    expect(report.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PLUGIN_CONTRACT_LOAD_FAILED',
        }),
      ])
    );
  });

  it('fails static ctx.http.fetch origins that are missing from egress', async () => {
    const pluginRoot = createPluginRoot('egress-missing');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'api/sync.ts',
      `
export async function sync(ctx) {
  await ctx.http.fetch('https://api.example.com/v1/items');
}
`
    );

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        createContract(root, [Permission.ExternalHttp], {
          egress: ['https://other.example.com'],
        }),
    });

    expect(report.success).toBe(false);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PLUGIN_EGRESS_ORIGIN_MISSING',
          severity: 'error',
          fix: 'Add "https://api.example.com" to plugin.ts egress and keep Permission.ExternalHttp declared.',
        }),
        expect.objectContaining({
          code: 'PLUGIN_EGRESS_ORIGIN_UNUSED',
          severity: 'warning',
        }),
      ])
    );
  });

  it('warns when declared egress origins are not used by static ctx.http.fetch calls', async () => {
    const pluginRoot = createPluginRoot('egress-unused');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'api/sync.ts',
      `
export async function sync(ctx) {
  await ctx.http.fetch('https://api.example.com/v1/items');
}
`
    );

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        createContract(root, [Permission.ExternalHttp], {
          egress: ['https://api.example.com', 'https://unused.example.com'],
        }),
    });

    expect(report.success).toBe(true);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PLUGIN_EGRESS_ORIGIN_UNUSED',
          severity: 'warning',
        }),
      ])
    );
  });

  it('warns when ctx.http.fetch uses a dynamic URL that only runtime egress can verify', async () => {
    const pluginRoot = createPluginRoot('dynamic-egress');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'api/sync.ts',
      `
export async function sync(ctx) {
  const path = '/v1/items';
  await ctx.http.fetch(new URL(path, 'https://api.example.com'));
}
`
    );

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        createContract(root, [Permission.ExternalHttp], {
          egress: ['https://api.example.com'],
        }),
    });

    expect(report.success).toBe(true);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PLUGIN_EGRESS_DYNAMIC_URL_UNVERIFIED',
          severity: 'warning',
          details: expect.objectContaining({
            declaredOrigins: ['https://api.example.com'],
          }),
        }),
      ])
    );
  });

  it('checks internal service declarations against static ctx.services calls', async () => {
    const pluginRoot = createPluginRoot('service-check');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'api/project.ts',
      `
export async function project(ctx) {
  return ctx.services.json('core-api', '/v1/projects/project-1', { method: 'POST' });
}
`
    );

    const failed = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        createContract(root, [Permission.ServicesInvoke], {
          services: [{ name: 'core-api', methods: ['GET'], paths: ['/v1/projects/:projectId'] }],
        }),
    });

    expect(failed.success).toBe(false);
    expect(failed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PLUGIN_SERVICE_METHOD_FORBIDDEN',
          severity: 'error',
        }),
      ])
    );

    const passed = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        createContract(root, [Permission.ServicesInvoke], {
          services: [{ name: 'core-api', methods: ['POST'], paths: ['/v1/projects/:projectId'] }],
        }),
    });

    expect(passed.success).toBe(true);
  });

  it('checks templated ctx.services paths against service declarations', async () => {
    const pluginRoot = createPluginRoot('service-template-check');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'api/project.ts',
      `
export async function project(ctx) {
  const projectId = ctx.request.params.projectId;
  return ctx.services.json('core-api', \`/v1/projects/\${projectId}\`);
}
`
    );

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        createContract(root, [Permission.ServicesInvoke], {
          services: [{ name: 'core-api', methods: ['GET'], paths: ['/v1/projects/:projectId'] }],
        }),
    });

    expect(report.success).toBe(true);
    expect(report.diagnostics).toEqual([]);
  });

  it('checks object-form ctx.services templates against service declarations', async () => {
    const pluginRoot = createPluginRoot('service-object-template-check');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'api/project.ts',
      `
export async function project(ctx) {
  return ctx.services.requestJson('core-api', {
    method: 'POST',
    template: '/v1/projects/:projectId/jobs/:jobId',
    params: { projectId: 'project-1', jobId: 'job-1' }
  });
}
`
    );

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        createContract(root, [Permission.ServicesInvoke], {
          services: [
            {
              name: 'core-api',
              methods: ['POST'],
              paths: ['/v1/projects/:projectId/jobs/:jobId'],
            },
          ],
        }),
    });

    expect(report.success).toBe(true);
    expect(report.diagnostics).toEqual([]);
  });

  it('infers static origins from URL objects with static absolute URLs', async () => {
    const pluginRoot = createPluginRoot('url-object-egress');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'api/sync.ts',
      `
export async function sync(ctx) {
  await ctx.http.fetch(new URL('https://api.example.com/v1/items'));
}
`
    );

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        createContract(root, [Permission.ExternalHttp], {
          egress: ['https://api.example.com'],
        }),
    });

    expect(report.success).toBe(true);
    expect(report.diagnostics).toEqual([]);
  });

  it('warns and conservatively tracks permissions for dynamic ctx capability access', async () => {
    const pluginRoot = createPluginRoot('dynamic-capability');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'api/write.ts',
      `
export async function write(ctx) {
  const operation = 'insert';
  await ctx.storage.collection('items')[operation]({ title: 'Hello' });
}
`
    );

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        createContract(root, [Permission.StorageRead, Permission.StorageWrite]),
    });

    expect(report.success).toBe(true);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PLUGIN_CAPABILITY_DYNAMIC_ACCESS_UNVERIFIED',
          severity: 'warning',
          details: expect.objectContaining({
            accessPath: 'ctx.storage.collection.*',
            assumedPermissions: [Permission.StorageRead, Permission.StorageWrite],
          }),
        }),
      ])
    );
    expect(
      report.diagnostics.filter((diagnostic) => diagnostic.code === 'PLUGIN_PERMISSION_UNUSED')
    ).toEqual([]);
  });

  it('fails ordinary plugin directories that declare system trust', async () => {
    const pluginRoot = createPluginRoot('system-trust');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);

    const report = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) =>
        definePlugin({
          id: path.basename(root),
          name: 'System Trust',
          version: '1.0.0',
          trustLevel: 'system',
        }),
    });

    expect(report.success).toBe(false);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PLUGIN_SYSTEM_TRUST_FORBIDDEN',
          severity: 'error',
        }),
      ])
    );
  });

  it('fails undeclared external package imports and rejects dependency manifests that the host has not installed', async () => {
    const pluginRoot = createPluginRoot('external-import');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'api/format.ts',
      `
import slugify from 'slugify';

export function format(value: string) {
  return slugify(value);
}
`
    );

    const failed = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) => createContract(root, []),
    });

    expect(failed.success).toBe(false);
    expect(failed.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PLUGIN_IMPORT_EXTERNAL_UNDECLARED',
          severity: 'error',
        }),
      ])
    );

    writePluginFile(
      pluginRoot,
      'plugin.dependencies.json',
      JSON.stringify({ dependencies: { slugify: '^1.6.6' } })
    );

    const rejected = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) => createContract(root, []),
    });

    expect(rejected.success).toBe(false);
    expect(rejected.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PLUGIN_DEPENDENCY_NOT_INSTALLED',
          path: 'dependencies.slugify',
          severity: 'error',
        }),
      ])
    );
  });

  it('accepts external package imports when the dependency is declared and installed by the host', async () => {
    const pluginRoot = createPluginRoot('installed-external-import');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'components/Flow.tsx',
      `
import { ReactFlow } from '@xyflow/react';

export default function Flow() {
  return ReactFlow;
}
`
    );
    writePluginFile(
      pluginRoot,
      'plugin.dependencies.json',
      JSON.stringify({ dependencies: { '@xyflow/react': '^12.3.6' } })
    );

    const passed = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) => createContract(root, []),
    });

    expect(passed.success).toBe(true);
    expect(passed.diagnostics).toEqual([]);
  });

  it('rejects transitive or dev-only packages as plugin runtime dependencies', async () => {
    const pluginRoot = createPluginRoot('transitive-external-import');
    writePluginFile(pluginRoot, 'plugin.ts', `export default {};`);
    writePluginFile(
      pluginRoot,
      'api/format.ts',
      `
import semver from 'semver';

export function format(value: string) {
  return semver.valid(value);
}
`
    );
    writePluginFile(
      pluginRoot,
      'plugin.dependencies.json',
      JSON.stringify({ dependencies: { semver: '^7.7.2' } })
    );

    const rejected = await checkPluginTargets(pluginRoot, {
      loadContract: async (root) => createContract(root, []),
    });

    expect(rejected.success).toBe(false);
    expect(rejected.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PLUGIN_DEPENDENCY_NOT_DECLARED_BY_HOST',
          path: 'dependencies.semver',
          severity: 'error',
        }),
      ])
    );
  });
});
