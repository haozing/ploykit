import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestingModuleContext } from '@ploykit/module-sdk';
import moduleDefinition from '../module';
import ask from '../actions/ask';
import enqueueReport from '../actions/enqueue-report';
import generateReport from '../jobs/generate-report';
import workflowStatus from '../api/workflow-status';

test('capability-demo declares public, dashboard, data and background capabilities', () => {
  assert.equal(moduleDefinition.id, 'capability-demo');
  assert.equal(moduleDefinition.routes?.site?.[0]?.path, '/demo');
  assert.equal(moduleDefinition.routes?.site?.[0]?.metadata, './loaders/public-tool-metadata');
  assert.equal(moduleDefinition.routes?.dashboard?.[0]?.path, '/capability-demo');
  assert.equal(moduleDefinition.routes?.dashboard?.[1]?.path, '/capability-demo/workflow');
  assert.equal(moduleDefinition.routes?.api?.[0]?.anonymousPolicy?.rateLimit.limit, 10);
  assert.equal(moduleDefinition.routes?.api?.[1]?.path, '/capability-demo/workflow/status');
  assert.equal(moduleDefinition.routes?.dashboard?.[0]?.commercial?.credits?.amount, 1);
  assert.ok(moduleDefinition.data?.tables?.demo_notes);
  assert.ok(moduleDefinition.jobs?.reindex);
  assert.ok(moduleDefinition.jobs?.generate_report);
  assert.ok(moduleDefinition.webhooks?.ingest);
  assert.ok(moduleDefinition.webhooks?.workflow);
});

test('capability-demo ask action uses fake AI and RAG providers', async () => {
  const ctx = createTestingModuleContext({ moduleId: 'capability-demo' });
  await ctx.rag.index({
    id: 'demo-doc',
    content: 'PloyKit modules can use RAG context in actions.',
  });

  const result = await ask.run(ctx, { question: 'PloyKit' });

  assert.equal(result.model, 'test-model');
  assert.match(result.text, /PloyKit modules/);
  assert.match(result.text, /Question: PloyKit/);
});

test('capability-demo owns the merged job/webhook workflow route', async () => {
  const ctx = createTestingModuleContext({ moduleId: 'capability-demo' });
  const queued = await enqueueReport.run(ctx, { title: 'Queued report' });
  const report = await generateReport(ctx, { title: 'Generated report' }, { id: 'run_test' });
  const statusResponse = await workflowStatus.get?.(ctx);
  const status = (await statusResponse?.json()) as {
    ok: boolean;
    moduleId: string;
    job: string;
  };

  assert.equal(queued.ok, true);
  assert.equal(queued.queued, 'generate_report');
  assert.equal(report.ok, true);
  assert.ok(report.artifactId);
  assert.equal(status.ok, true);
  assert.equal(status.moduleId, 'capability-demo');
  assert.equal(status.job, 'generate_report');
});
