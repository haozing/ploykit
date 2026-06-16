import assert from 'node:assert/strict';
import test from 'node:test';
import { defineModule, Permission, type ModuleContext } from '@ploykit/module-sdk';
import { createModuleHost, type ModuleMapArtifact } from '../src/lib/module-runtime';
import { generateDashboardModuleMetadataForTest } from '../apps/host-next/app/(dashboard)/dashboard/[[...modulePath]]/page';
import { artifact } from './host-runtime-fixtures';

test('createModuleHost resolves page routes with loader data and metadata', async () => {
  const host = await createModuleHost({ artifact });

  const result = await host.resolvePageRoute({
    kind: 'dashboard',
    request: new Request('http://localhost/dashboard/alpha', { method: 'GET' }),
    pathname: '/dashboard/alpha',
    session: {
      user: { id: 'user_3', role: 'user' },
    },
  });

  if (!result.ok) {
    throw new Error(result.message);
  }

  assert.equal(result.ok, true);
  assert.equal(result.page.moduleId, 'host-test');
  assert.deepEqual(result.page.params, { slug: 'alpha' });
  assert.deepEqual(result.page.loaderData, { slug: 'alpha', userId: 'user_3' });
  assert.deepEqual(result.page.metadata, { title: 'Dashboard alpha' });
  assert.deepEqual((result.page.component as () => unknown)(), { view: 'dashboard' });
});

test('createModuleHost resolves page route metadata without running page loader', async () => {
  let componentLoads = 0;
  let pageLoaderRuns = 0;
  let metadataRuns = 0;
  const metadataOnlyArtifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'metadata-only-test': {
        module: async () => ({
          default: defineModule({
            id: 'metadata-only-test',
            name: 'Metadata Only Test',
            version: '0.1.0',
            routes: {
              dashboard: [
                {
                  path: '/metadata-only/:slug',
                  component: './pages/MetadataPage',
                  loader: './loaders/page-state',
                  metadata: './loaders/page-metadata',
                  auth: 'auth',
                },
              ],
            },
          }),
        }),
        pages: {
          'pages/MetadataPage': async () => {
            componentLoads += 1;
            return {
              default: function MetadataPage() {
                return { view: 'metadata-only' };
              },
            };
          },
        },
        loaders: {
          'loaders/page-state': async () => ({
            default: () => {
              pageLoaderRuns += 1;
              throw new Error('metadata resolver should not run page loader');
            },
          }),
          'loaders/page-metadata': async () => ({
            default: (ctx: ModuleContext) => {
              metadataRuns += 1;
              return { title: `Metadata ${ctx.request.params.slug}` };
            },
          }),
        },
      },
    },
  };
  const host = await createModuleHost({ artifact: metadataOnlyArtifact });

  const result = await host.resolvePageRouteMetadata({
    kind: 'dashboard',
    request: new Request('http://localhost/metadata-only/alpha', { method: 'GET' }),
    pathname: '/metadata-only/alpha',
    session: {
      user: { id: 'metadata-user', role: 'user' },
    },
  });

  if (!result.ok) {
    throw new Error(result.message);
  }

  assert.deepEqual(result.page.params, { slug: 'alpha' });
  assert.deepEqual(result.page.metadata, { title: 'Metadata alpha' });
  assert.equal(componentLoads, 0);
  assert.equal(pageLoaderRuns, 0);
  assert.equal(metadataRuns, 1);
});

test('dashboard generateMetadata resolves metadata-only routes without page loaders', async () => {
  let metadataCalls = 0;
  let pageRouteCalls = 0;
  const session = {
    user: { id: 'metadata-user', role: 'user' as const },
  };
  const host = {
    runtime: {
      contracts: [
        {
          id: 'metadata-only-test',
          name: 'Metadata Only Test',
          version: '0.1.0',
        },
      ],
      routes: [
        {
          kind: 'dashboard',
          moduleId: 'metadata-only-test',
          path: '/metadata-only',
        },
      ],
    },
    resolveNavigation() {
      return [
        {
          moduleId: 'metadata-only-test',
          item: {
            path: '/metadata-only',
            fallbackGroup: 'Tools',
          },
        },
      ];
    },
    getContract() {
      return {
        id: 'metadata-only-test',
        name: 'Metadata Only Test',
        version: '0.1.0',
        description: 'Metadata-only route',
      };
    },
    resolvePageRouteMetadata(input: { pathname: string; session: typeof session }) {
      metadataCalls += 1;
      assert.equal(input.pathname, '/metadata-only');
      assert.equal(input.session.user?.id, 'metadata-user');
      return Promise.resolve({
        ok: true as const,
        status: 200 as const,
        page: {
          moduleId: 'metadata-only-test',
          kind: 'dashboard' as const,
          route: {
            path: '/metadata-only',
            component: './pages/MetadataOnly',
            loader: './loaders/page-state',
            metadata: './loaders/page-metadata',
            auth: 'auth' as const,
          },
          matchedPath: '/metadata-only',
          routeSource: 'route' as const,
          canonicalPath: '/metadata-only',
          params: {},
          contract: {
            id: 'metadata-only-test',
            name: 'Metadata Only Test',
            version: '0.1.0',
            description: 'Metadata-only route',
          },
          metadata: {
            title: 'Metadata Only',
            description: 'Loaded from the metadata loader only.',
          },
        },
      });
    },
    resolvePageRoute() {
      pageRouteCalls += 1;
      throw new Error('dashboard generateMetadata must not resolve the full page route');
    },
  };

  const metadata = await generateDashboardModuleMetadataForTest(
    {
      params: Promise.resolve({ modulePath: ['metadata-only'] }),
    },
    {
      getHost: () => host as never,
      createRequest: () => new Request('http://localhost/dashboard/metadata-only'),
      createSession: () => session,
      applySessionPermissions: (_host, nextSession) => nextSession,
    }
  );

  assert.deepEqual(metadata, {
    title: 'Metadata Only',
    description: 'Loaded from the metadata loader only.',
    robots: {
      index: false,
      follow: false,
    },
  });
  assert.equal(metadataCalls, 1);
  assert.equal(pageRouteCalls, 0);
});

test('createModuleHost keeps module chrome when dashboard loader fails', async () => {
  const host = await createModuleHost({ artifact });

  const result = await host.resolvePageRoute({
    kind: 'dashboard',
    request: new Request('http://localhost/module-loader-error', { method: 'GET' }),
    pathname: '/module-loader-error',
    session: {
      user: { id: 'user_loader_error', role: 'user' },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(result.code, 'MODULE_PAGE_HANDLER_ERROR');
  assert.equal(result.routeContext?.moduleId, 'host-test');
  assert.equal(result.routeContext?.route.path, '/module-loader-error');
  assert.deepEqual(result.routeContext?.metadata, {
    title: 'Module chrome page',
    shell: {
      area: 'dashboard',
      chrome: 'none',
    },
  });
});

test('createModuleHost includes matched route context when metadata fails', async () => {
  const host = await createModuleHost({ artifact });

  const result = await host.resolvePageRoute({
    kind: 'dashboard',
    request: new Request('http://localhost/module-metadata-error', { method: 'GET' }),
    pathname: '/module-metadata-error',
    session: {
      user: { id: 'user_metadata_error', role: 'user' },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(result.code, 'MODULE_PAGE_HANDLER_ERROR');
  assert.equal(result.routeContext?.moduleId, 'host-test');
  assert.equal(result.routeContext?.route.path, '/module-metadata-error');
  assert.equal(result.routeContext?.metadata, undefined);
});

test('createModuleHost resolves public aliases for site routes', async () => {
  const host = await createModuleHost({ artifact });

  const result = await host.resolvePageRoute({
    kind: 'site',
    request: new Request('http://localhost/public-host-test', { method: 'GET' }),
    pathname: '/public-host-test',
  });

  if (!result.ok) {
    throw new Error(result.message);
  }

  assert.equal(result.page.route.path, '/tools/host-test');
  assert.equal(result.page.params.publicAlias, undefined);
  assert.deepEqual((result.page.component as () => unknown)(), { view: 'public-tool' });
});

test('createModuleHost resolves dashboard aliases to canonical routes', async () => {
  const host = await createModuleHost({
    artifact,
    resolveSession: async () => ({
      user: { id: 'user_alias', role: 'user' },
      permissions: [Permission.DataDocumentRead],
      data: {
        productId: 'product_1',
        userId: 'user_alias',
        actorId: 'user_alias',
      },
    }),
  });

  const result = await host.resolvePageRoute({
    kind: 'dashboard',
    request: new Request('http://localhost/dashboard/workspace-dashboard', { method: 'GET' }),
    pathname: '/workspace-dashboard',
  });

  if (!result.ok) {
    throw new Error(result.message);
  }

  assert.equal(result.page.route.path, '/workspace');
  assert.equal(result.page.matchedPath, '/workspace-dashboard');
  assert.equal(result.page.canonicalPath, '/workspace');
  assert.equal(result.page.routeSource, 'alias');
  assert.deepEqual(result.page.params, {});
  assert.deepEqual(result.page.loaderData, { workspace: true, userId: 'user_alias' });
  assert.deepEqual((result.page.component as () => unknown)(), { view: 'workspace-dashboard' });
});

test('createModuleHost prefers static dashboard aliases over dynamic canonical routes', async () => {
  const host = await createModuleHost({
    artifact,
    resolveSession: async () => ({
      user: { id: 'user_alias_static', role: 'user' },
      permissions: [Permission.DataDocumentRead],
      data: {
        productId: 'product_1',
        userId: 'user_alias_static',
        actorId: 'user_alias_static',
      },
    }),
  });

  const result = await host.resolvePageRoute({
    kind: 'dashboard',
    request: new Request('http://localhost/dashboard/special', { method: 'GET' }),
    pathname: '/dashboard/special',
  });

  if (!result.ok) {
    throw new Error(result.message);
  }

  assert.equal(result.page.routeSource, 'alias');
  assert.deepEqual(result.page.params, {});
  assert.deepEqual((result.page.component as () => unknown)(), { view: 'workspace-dashboard' });
});
