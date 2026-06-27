import {
  action,
  api,
  defineApi,
  defineModule,
  page,
  Permission,
  schema,
  stringField,
  type ModuleContext,
} from '@ploykit/module-sdk';
import type { ModuleMapArtifact } from '../src/lib/module-runtime';

export interface TestMessage {
  id: string;
  message: string;
}

const payloadSchema = schema({
  name: 'HostRuntimePayload',
  fields: {
    value: stringField(),
  },
});

export const testModule = defineModule({
  id: 'host-test',
  name: 'Host Test Module',
  version: '0.1.0',
  permissions: [
    Permission.DataDocumentRead,
    Permission.DataDocumentWrite,
    Permission.SurfaceContribute,
  ],
  data: {
    version: 1,
    documents: {
      test_messages: {
        scope: 'user',
        fields: {
          message: 'string',
        },
      },
    },
  },
  assets: {},
  pages: [
    page({
      id: 'host-test.public-tool',
      area: 'site',
      path: '/tools/host-test',
      frame: 'site',
      component: './pages/PublicToolPage',
      metadata: './loaders/public-tool-metadata',
      auth: 'public',
      cache: {
        strategy: 'public',
        revalidateSeconds: 300,
        tags: ['host-test'],
      },
      publicAliases: ['/public-host-test'],
    }),
    page({
      id: 'host-test.dashboard',
      area: 'dashboard',
      path: '/dashboard/:slug',
      frame: 'workspace',
      component: './pages/DashboardPage',
      loader: './loaders/dashboard-state',
      metadata: './loaders/dashboard-metadata',
      auth: 'auth',
    }),
    page({
      id: 'host-test.workspace',
      area: 'dashboard',
      path: '/workspace',
      frame: 'workspace',
      component: './pages/WorkspaceDashboardPage',
      loader: './loaders/workspace-state',
      metadata: './loaders/workspace-metadata',
      auth: 'auth',
      aliases: ['/workspace-dashboard', '/dashboard/special'],
    }),
    page({
      id: 'host-test.sections',
      area: 'dashboard',
      path: '/sections/[section]',
      frame: 'workspace',
      component: './pages/DashboardPage',
      loader: './loaders/section-default-state',
      loaderByParam: {
        section: {
          agents: './loaders/section-agents-state',
          traces: './loaders/section-traces-state',
        },
      },
      metadata: './loaders/section-default-metadata',
      metadataByParam: {
        section: {
          agents: './loaders/section-agents-metadata',
          traces: './loaders/section-default-metadata',
        },
      },
      cache: {
        strategy: 'private',
        revalidateSeconds: 30,
      },
      cacheByParam: {
        section: {
          agents: {
            strategy: 'private',
            revalidateSeconds: 30,
          },
          traces: {
            strategy: 'private',
            revalidateSeconds: 5,
            tags: ['host-test-traces'],
          },
        },
      },
      auth: 'auth',
    }),
    page({
      id: 'host-test.loader-error',
      area: 'dashboard',
      path: '/module-loader-error',
      frame: 'none',
      component: './pages/ExplodingLoaderPage',
      loader: './loaders/exploding-loader-state',
      metadata: './loaders/module-chrome-metadata',
      auth: 'auth',
    }),
    page({
      id: 'host-test.metadata-error',
      area: 'dashboard',
      path: '/module-metadata-error',
      frame: 'workspace',
      component: './pages/ExplodingMetadataPage',
      metadata: './loaders/exploding-metadata',
      auth: 'auth',
    }),
  ],
  apis: [
    api({
      id: 'host-test.public-limited',
      path: '/public-limited',
      handler: './api/public-limited',
      auth: 'public',
      methods: ['POST'],
      input: payloadSchema,
      output: payloadSchema,
      anonymousPolicy: {
        rateLimit: { bucket: ['ip', 'route'], limit: 1, window: '1m' },
        maxUploadBytes: 8,
        captcha: 'never',
        allowHighCostActions: false,
      },
    }),
    api({
      id: 'host-test.public-high-cost',
      path: '/public-high-cost',
      handler: './api/public-high-cost',
      auth: 'public',
      methods: ['GET'],
      input: payloadSchema,
      output: payloadSchema,
      commercial: { entitlements: ['host-test.pro'] },
      anonymousPolicy: {
        rateLimit: { bucket: 'route', limit: 10, window: '1m' },
        allowHighCostActions: false,
      },
    }),
    api({
      id: 'host-test.state',
      path: '/state',
      handler: './api/state',
      auth: 'auth',
      methods: ['GET'],
      input: payloadSchema,
      output: payloadSchema,
    }),
    api({
      id: 'host-test.machine-state',
      path: '/machine-state',
      handler: './api/machine-state',
      auth: 'auth',
      machineAuth: 'apiKey',
      methods: ['GET'],
      input: payloadSchema,
      output: payloadSchema,
    }),
    api({
      id: 'host-test.hybrid-state',
      path: '/hybrid-state',
      handler: './api/hybrid-state',
      auth: 'auth',
      machineAuth: 'user-or-apiKey',
      methods: ['GET'],
      input: payloadSchema,
      output: payloadSchema,
    }),
  ],
  actions: {
    writeMessage: {
      handler: './actions/write-message',
      input: payloadSchema,
      output: payloadSchema,
      auth: 'auth',
    },
  },
  surfaces: {
    'dashboard.home:widgets': {
      mode: 'panel',
      component: './surfaces/Widget',
      priority: 5,
      visibility: { mode: 'permission', permission: Permission.DataDocumentRead },
    },
  },
});

export const artifact: ModuleMapArtifact = {
  kind: 'source',
  modules: {
    'host-test': {
      module: async () => ({ default: testModule }),
      apis: {
        'api/state': async () => ({
          default: defineApi({
            async get(ctx) {
              const messages = ctx.data.document<TestMessage>('test_messages');
              await messages.insert({ message: 'from-api' });
              return ctx.json({
                ok: true,
                count: await messages.count(),
                moduleId: ctx.module.id,
                userId: ctx.user?.id ?? null,
              });
            },
          }),
        }),
        'api/machine-state': async () => ({
          default: defineApi({
            get(ctx) {
              return ctx.json({
                ok: true,
                moduleId: ctx.module.id,
                userId: ctx.user?.id ?? null,
              });
            },
          }),
        }),
        'api/hybrid-state': async () => ({
          default: defineApi({
            get(ctx) {
              return ctx.json({
                ok: true,
                moduleId: ctx.module.id,
                userId: ctx.user?.id ?? null,
              });
            },
          }),
        }),
        'api/public-limited': async () => ({
          default: defineApi({
            post(ctx) {
              return ctx.json({
                ok: true,
                moduleId: ctx.module.id,
              });
            },
          }),
        }),
        'api/public-high-cost': async () => ({
          default: defineApi({
            get(ctx) {
              return ctx.json({
                ok: true,
                moduleId: ctx.module.id,
              });
            },
          }),
        }),
      },
      actions: {
        'actions/write-message': async () => ({
          default: action<ModuleContext, { message: string }, Record<string, unknown>>(
            async (ctx, input) => {
              const messages = ctx.data.document<TestMessage>('test_messages');
              await messages.insert({ message: input.message });
              return {
                ok: true,
                count: await messages.count(),
                moduleId: ctx.module.id,
                userId: ctx.user?.id ?? null,
              };
            }
          ),
        }),
      },
      pages: {
        'pages/DashboardPage': async () => ({
          default: function DashboardPage() {
            return { view: 'dashboard' };
          },
        }),
        'pages/WorkspaceDashboardPage': async () => ({
          default: function WorkspaceDashboardPage() {
            return { view: 'workspace-dashboard' };
          },
        }),
        'pages/PublicToolPage': async () => ({
          default: function PublicToolPage() {
            return { view: 'public-tool' };
          },
        }),
        'pages/ExplodingLoaderPage': async () => ({
          default: function ExplodingLoaderPage() {
            return { view: 'exploding-loader' };
          },
        }),
        'pages/ExplodingMetadataPage': async () => ({
          default: function ExplodingMetadataPage() {
            return { view: 'exploding-metadata' };
          },
        }),
      },
      loaders: {
        'loaders/dashboard-state': async () => ({
          default: (ctx: ModuleContext) => ({
            slug: ctx.request.params.slug,
            userId: ctx.user?.id ?? null,
          }),
        }),
        'loaders/dashboard-metadata': async () => ({
          default: (ctx: ModuleContext) => ({
            title: `Dashboard ${ctx.request.params.slug}`,
          }),
        }),
        'loaders/workspace-state': async () => ({
          default: (ctx: ModuleContext) => ({
            workspace: true,
            userId: ctx.user?.id ?? null,
          }),
        }),
        'loaders/workspace-metadata': async () => ({
          default: () => ({
            title: 'Workspace dashboard',
          }),
        }),
        'loaders/section-default-state': async () => ({
          default: (ctx: ModuleContext) => ({
            section: ctx.request.params.section,
            source: 'default',
          }),
        }),
        'loaders/section-agents-state': async () => ({
          default: (ctx: ModuleContext) => ({
            section: ctx.request.params.section,
            source: 'agents',
          }),
        }),
        'loaders/section-traces-state': async () => ({
          default: (ctx: ModuleContext) => ({
            section: ctx.request.params.section,
            source: 'traces',
          }),
        }),
        'loaders/section-default-metadata': async () => ({
          default: (ctx: ModuleContext) => ({
            title: `Section ${ctx.request.params.section}`,
            source: 'default',
          }),
        }),
        'loaders/section-agents-metadata': async () => ({
          default: () => ({
            title: 'Agents',
            source: 'agents',
          }),
        }),
        'loaders/public-tool-metadata': async () => ({
          default: () => ({
            title: 'Host Test Tool',
            description: 'Host runtime public tool fixture.',
          }),
        }),
        'loaders/exploding-loader-state': async () => ({
          default: () => {
            throw new Error('database connection failed');
          },
        }),
        'loaders/module-chrome-metadata': async () => ({
          default: () => ({
            title: 'Module chrome page',
            shell: {
              area: 'dashboard',
              chrome: 'none',
            },
          }),
        }),
        'loaders/exploding-metadata': async () => ({
          default: () => {
            throw new Error('metadata failed');
          },
        }),
      },
      surfaces: {
        'surfaces/Widget': async () => ({ default: function Widget() {} }),
      },
    },
  },
};
