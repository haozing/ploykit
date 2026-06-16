import assert from 'node:assert/strict';
import test from 'node:test';
import { defineModule } from '@ploykit/module-sdk';
import {
  createModuleBundleManifest,
  createModuleCapabilityMeter,
  normalizeModuleRuntimeContract,
  type ModuleMapArtifact,
} from '../src/lib/module-runtime';
import {
  createInMemoryModuleCommercialRuntime,
  createInMemoryModuleRagRuntime,
  createStaticModuleAiRuntime,
} from '../src/lib/module-capabilities';

test('module bundle manifest can select enabled modules for production builds', () => {
  const moduleDefinition = defineModule({
    id: 'bundle-test',
    name: 'Bundle Test',
    version: '0.1.0',
    jobs: {
      sync: {
        handler: './jobs/sync',
      },
    },
  });
  const contract = normalizeModuleRuntimeContract(moduleDefinition);
  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'bundle-test': {
        rootDir: 'modules/bundle-test',
        module: async () => ({ default: moduleDefinition }),
        jobs: {
          'jobs/sync': async () => ({ default: async () => ({ ok: true }) }),
        },
      },
      disabled: {
        rootDir: 'modules/disabled',
        module: async () => ({
          default: defineModule({ id: 'disabled', name: 'Disabled', version: '0.1.0' }),
        }),
      },
    },
  };

  const manifest = createModuleBundleManifest({
    artifact,
    contracts: [contract],
    enabledModules: ['bundle-test'],
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });

  assert.equal(manifest.generatedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(manifest.modules.length, 1);
  assert.equal(manifest.modules[0].files.jobs.length, 1);
  assert.equal(manifest.modules[0].capabilities?.jobs, 1);
});

test('AI and capability metering record usage while RAG stays module isolated', async () => {
  const commercial = createInMemoryModuleCommercialRuntime();
  const ai = createStaticModuleAiRuntime({
    usage: (moduleId) => commercial.forModule(moduleId).usage,
    responsePrefix: 'ok: ',
  });
  const rag = createInMemoryModuleRagRuntime();
  const moduleA = rag.forModule('module-a');
  const moduleB = rag.forModule('module-b');
  const capabilityMeter = createModuleCapabilityMeter(commercial.forModule('module-a').usage);

  await moduleA.index({ id: 'a1', content: 'alpha product notes' });
  await moduleB.index({ id: 'b1', content: 'beta product notes' });
  const text = await ai.forModule('module-a').generateText({
    prompt: 'summarize alpha',
    idempotencyKey: 'ai_1',
  });
  const embedding = await ai.forModule('module-a').embedText({ text: 'alpha' });
  await capabilityMeter.record({ kind: 'job.run', idempotencyKey: 'job_1' });

  assert.equal(text.text, 'ok: summarize alpha');
  assert.equal(embedding.embedding.length, 3);
  assert.equal((await moduleA.search({ query: 'alpha' })).length, 1);
  assert.equal((await moduleB.search({ query: 'alpha' })).length, 0);
  assert.equal(commercial.listUsage().length, 3);
});
