import assert from 'node:assert/strict';
import test from 'node:test';
import { defineModule, page } from '@ploykit/module-sdk';
import {
  createModuleCatalogApplyPlan,
  createModuleRuntimeHost,
  diagnoseModuleCatalog,
  normalizeModuleRuntimeContract,
  type ModuleMapArtifact,
} from '../src/lib/module-runtime';

const enabledModule = defineModule({
  id: 'enabled',
  name: 'Enabled Module',
  version: '1.0.0',
  pages: [
    page({
      id: 'enabled.home',
      area: 'dashboard',
      path: '/enabled',
      frame: 'workspace',
      component: './pages/EnabledPage',
      auth: 'public',
    }),
  ],
});

const disabledModule = defineModule({
  id: 'disabled',
  name: 'Disabled Module',
  version: '1.0.0',
  pages: [
    page({
      id: 'disabled.home',
      area: 'dashboard',
      path: '/disabled',
      frame: 'workspace',
      component: './pages/DisabledPage',
      auth: 'public',
    }),
  ],
});

const enabledContract = normalizeModuleRuntimeContract(enabledModule);
const disabledContract = normalizeModuleRuntimeContract(disabledModule);

const artifact: ModuleMapArtifact = {
  kind: 'source',
  modules: {
    enabled: {
      rootDir: 'modules/enabled',
      module: async () => ({ default: enabledModule }),
      pages: {
        'pages/EnabledPage': async () => ({ default: () => 'enabled' }),
      },
      apis: {},
      actions: {},
      surfaces: {},
      lifecycle: {},
      jobs: {},
      events: {},
      webhooks: {},
    },
    disabled: {
      rootDir: 'modules/disabled',
      module: async () => ({ default: disabledModule }),
      pages: {
        'pages/DisabledPage': async () => ({ default: () => 'disabled' }),
      },
      apis: {},
      actions: {},
      surfaces: {},
      lifecycle: {},
      jobs: {},
      events: {},
      webhooks: {},
    },
  },
};

test('P11 catalog filter keeps disabled modules out of runtime routes', async () => {
  const host = await createModuleRuntimeHost(artifact, {
    contracts: [enabledContract, disabledContract],
    catalog: {
      productId: 'demo-product',
      moduleStates: [
        { productId: 'demo-product', moduleId: 'enabled', status: 'enabled' },
        { productId: 'demo-product', moduleId: 'disabled', status: 'disabled' },
      ],
    },
  });

  assert.equal(host.getContract('enabled')?.id, 'enabled');
  assert.equal(host.getContract('disabled'), null);
  assert.deepEqual(
    host.routes.map((route) => route.path),
    ['/enabled']
  );
});

test('P11 catalog apply plan enables bundle modules and diagnoses missing modules', () => {
  const plan = createModuleCatalogApplyPlan({
    artifact,
    product: {
      id: 'demo-product',
      name: 'Demo Product',
      scopeProfile: 'hidden-default',
    },
    bundle: {
      id: 'demo',
      name: 'Demo Bundle',
      requiredModuleIds: ['enabled'],
      modules: [{ moduleId: 'enabled', required: true }, { moduleId: 'missing' }],
    },
    existingStates: [{ productId: 'demo-product', moduleId: 'disabled', status: 'enabled' }],
    disableStale: true,
    now: '2026-05-19T00:00:00.000Z',
  });

  assert.equal(plan.operations.length, 3);
  assert.equal(plan.operations[0]?.type, 'enable');
  assert.equal(plan.operations[2]?.type, 'disable');
  assert.equal(plan.diagnostics[0]?.code, 'MODULE_CATALOG_BUNDLE_MODULE_MISSING');
});

test('P11 catalog doctor reports required disabled modules', () => {
  const diagnostics = diagnoseModuleCatalog({
    artifact,
    contracts: [enabledContract, disabledContract],
    bundles: [
      {
        id: 'demo',
        name: 'Demo Bundle',
        requiredModuleIds: ['disabled'],
        modules: [{ moduleId: 'disabled', required: true }],
      },
    ],
    moduleStates: [{ productId: 'demo-product', moduleId: 'disabled', status: 'disabled' }],
  });

  assert.equal(
    diagnostics.some((item) => item.code === 'MODULE_CATALOG_REQUIRED_MODULE_DISABLED'),
    true
  );
});

test('P11 catalog doctor reports enabled module route alias conflicts', () => {
  const firstModule = defineModule({
    id: 'first-alias-owner',
    name: 'First Alias Owner',
    version: '1.0.0',
    pages: [
      page({
        id: 'first-alias-owner.home',
        area: 'dashboard',
        path: '/first',
        frame: 'workspace',
        component: './pages/FirstPage',
        auth: 'auth',
        aliases: ['/shared-console-path'],
      }),
    ],
  });
  const secondModule = defineModule({
    id: 'second-alias-owner',
    name: 'Second Alias Owner',
    version: '1.0.0',
    pages: [
      page({
        id: 'second-alias-owner.home',
        area: 'dashboard',
        path: '/shared-console-path',
        frame: 'workspace',
        component: './pages/SecondPage',
        auth: 'auth',
      }),
    ],
  });

  const diagnostics = diagnoseModuleCatalog({
    artifact: {
      kind: 'source',
      modules: {
        'first-alias-owner': {
          rootDir: 'modules/first-alias-owner',
          module: async () => ({ default: firstModule }),
          pages: {},
          apis: {},
          actions: {},
          surfaces: {},
          lifecycle: {},
          jobs: {},
          events: {},
          webhooks: {},
        },
        'second-alias-owner': {
          rootDir: 'modules/second-alias-owner',
          module: async () => ({ default: secondModule }),
          pages: {},
          apis: {},
          actions: {},
          surfaces: {},
          lifecycle: {},
          jobs: {},
          events: {},
          webhooks: {},
        },
      },
    },
    contracts: [
      normalizeModuleRuntimeContract(firstModule),
      normalizeModuleRuntimeContract(secondModule),
    ],
  });

  assert.equal(
    diagnostics.some((item) => item.code === 'MODULE_CATALOG_ROUTE_PATH_CONFLICT'),
    true
  );
});
