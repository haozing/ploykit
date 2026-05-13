import { testPlugin } from '@ploykit/plugin-sdk/testing';
import plugin from '../plugin';
import runApi from '../api/run';
import csvConvertApi from '../api/csv-convert';
import seoCheckApi from '../api/seo-check';
import selfTestApi from '../api/self-test';

export default testPlugin(plugin, async ({ ctx, host }) => {
  host.setRequest({
    method: 'POST',
    json: {
      workspaceSlug: 'workspace-1',
      path: 'docs/source.md',
      content: 'Alpha planning note.\n\nBeta execution note.\n\nGamma review note.',
      query: 'Beta execution',
      code: 'WELCOME-2026',
    },
  });

  if (!runApi.post) {
    throw new Error('Capability demo API must expose a POST handler.');
  }

  const response = await runApi.post(ctx);
  const payload = await host.readJson<{
    workspace: { id: string; memberCount: number; canManageWorkspace: boolean };
    run: { id: string; status: string } | null;
    apiKey: { id: string; keyPreview: string; listed: number };
    connector: { name: string; status: string } | null;
    managedConnector: { name: string; status: string };
    managedConnectors: Array<{ name: string }>;
    disabledConnector: { name: string; status: string };
    connectorCall: { ok: boolean; status: number };
    callback: { url: string; token: string };
    files: {
      source: { id: string; status: string };
      sourceReadBytes: number;
      sourceDownloadUrl: string;
      sourcesListed: number;
      result: { id: string; status: string };
      resultsListed: number;
    };
    metering: {
      authorization: { authorized: boolean; creditCost: number };
      commit: { usageId: string; creditCost: number };
      reconcile: { usageAmount: number };
    };
    artifact: { path: string; version: number };
    artifactRead: { path: string; content: string } | null;
    artifactList: Array<{ path: string }>;
    artifactTree: Array<{ name: string; parentPath: string }>;
    indexed: { chunkCount: number; sourcePath?: string };
    hits: Array<{ content: string }>;
    contextPack: { characterCount: number; sourceCount: number };
    generated: { text: string; usage?: { creditsConsumed?: number } };
    embedded: { embeddings: unknown[]; usage?: { creditsConsumed?: number } };
    manualCredit: { amount: number; meter: string };
    balance: { balance: number };
    redemption: { redeemed: boolean };
  }>(response);

  if (response?.status !== 200) {
    throw new Error(`Expected demo run to return 200, got ${response?.status}`);
  }

  if (payload.artifact.path !== 'docs/source.md' || payload.artifact.version !== 1) {
    throw new Error('Artifact write did not return the expected source file.');
  }

  if (!payload.artifactRead?.content.includes('Beta execution')) {
    throw new Error('Artifact read did not return the written content.');
  }

  if (!payload.artifactList.some((entry) => entry.path === 'docs/source.md')) {
    throw new Error('Artifact list did not include the written source file.');
  }

  if (!payload.artifactTree.some((entry) => entry.name === 'source.md')) {
    throw new Error('Artifact tree did not include the written source file.');
  }

  if (payload.indexed.chunkCount < 1 || payload.indexed.sourcePath !== 'docs/source.md') {
    throw new Error('RAG index did not index the artifact source.');
  }

  if (!payload.hits.some((hit) => hit.content.includes('Beta execution'))) {
    throw new Error('RAG search did not return the expected source chunk.');
  }

  if (payload.contextPack.characterCount <= 0 || payload.contextPack.sourceCount <= 0) {
    throw new Error('RAG context pack should include at least one source.');
  }

  if (!payload.generated.text.includes('Beta execution')) {
    throw new Error('AI generation did not receive the RAG context.');
  }

  if (payload.generated.usage?.creditsConsumed !== 1) {
    throw new Error('AI generation should consume one credit in fake host.');
  }

  if (payload.embedded.embeddings.length !== 2 || payload.embedded.usage?.creditsConsumed !== 1) {
    throw new Error('AI embedding did not return two vectors with credit usage.');
  }

  if (
    payload.manualCredit.amount !== 1 ||
    payload.manualCredit.meter !== 'capability-demo.external-api'
  ) {
    throw new Error('Manual credit deduction did not use the expected meter.');
  }

  if (!payload.redemption.redeemed) {
    throw new Error('Billing redeemCode should report a redeemed code in fake host.');
  }

  if (!payload.workspace.id || !payload.workspace.canManageWorkspace) {
    throw new Error('Workspace capability did not create or resolve a manageable workspace.');
  }

  if (!payload.run || payload.run.status !== 'succeeded') {
    throw new Error('Run ledger did not complete the demo run.');
  }

  if (
    !payload.apiKey.id ||
    !payload.apiKey.keyPreview.includes('...') ||
    payload.apiKey.listed < 1
  ) {
    throw new Error('API key capability did not create/list a key.');
  }

  if (!payload.connector || payload.connector.name !== 'demo-service') {
    throw new Error('Connector lookup did not return the demo connector.');
  }

  if (
    payload.managedConnector.name !== 'managed-demo-service' ||
    payload.managedConnectors.length < 1 ||
    payload.disabledConnector.status !== 'disabled'
  ) {
    throw new Error('Connector management did not upsert/list/disable the demo connector.');
  }

  if (!payload.connectorCall.ok || payload.connectorCall.status !== 200) {
    throw new Error('Connector call did not return a successful response.');
  }

  if (!payload.callback.url || !payload.callback.token) {
    throw new Error('Connector callback signing did not return URL and token.');
  }

  if (
    payload.files.source.status !== 'ready' ||
    payload.files.result.status !== 'ready' ||
    payload.files.sourceReadBytes <= 0 ||
    !payload.files.sourceDownloadUrl.includes('/download') ||
    payload.files.sourcesListed < 1 ||
    payload.files.resultsListed < 1
  ) {
    throw new Error('Files 2.0 did not create/read/list signed source and result files.');
  }

  if (
    !payload.metering.authorization.authorized ||
    !payload.metering.commit.usageId ||
    payload.metering.commit.creditCost !== 2 ||
    payload.metering.reconcile.usageAmount < 2
  ) {
    throw new Error('Metering did not authorize, commit, and reconcile the OCR meter.');
  }

  host.setRequest({
    method: 'POST',
    json: {
      fileName: 'items.csv',
      csv: 'name,count\nAlpha,1\nBeta,2',
    },
  });

  if (!csvConvertApi.post) {
    throw new Error('CSV convert API must expose a POST handler.');
  }
  const csvResponse = await csvConvertApi.post(ctx);
  const csvPayload = await host.readJson<{
    rows: Array<Record<string, string>>;
    sourceFileId: string;
    resultFileId: string;
    metering: { meter: string; usageId: string };
  }>(csvResponse);

  if (
    csvResponse.status !== 200 ||
    csvPayload.rows.length !== 2 ||
    csvPayload.rows[1].name !== 'Beta' ||
    !csvPayload.sourceFileId ||
    !csvPayload.resultFileId ||
    csvPayload.metering.meter !== 'capability-demo.csv.request'
  ) {
    throw new Error('CSV conversion API did not create files and meter the request.');
  }

  host.setRequest({
    method: 'POST',
    json: {
      url: 'https://example.com/',
    },
  });

  if (!seoCheckApi.post) {
    throw new Error('SEO check API must expose a POST handler.');
  }
  const seoResponse = await seoCheckApi.post(ctx);
  const seoPayload = await host.readJson<{ ok: boolean; status: number; url: string }>(seoResponse);

  if (seoResponse.status !== 200 || !seoPayload.ok || seoPayload.url !== 'https://example.com/') {
    throw new Error('SEO check API did not perform the declared external HTTP request.');
  }

  host.setRequest({
    method: 'POST',
    json: {
      seed: 'fake-self-test',
      includeAi: true,
      includeExternal: true,
      createApiKey: true,
      returnApiKey: true,
    },
  });

  if (!selfTestApi.post) {
    throw new Error('Self-test API must expose a POST handler.');
  }
  const selfTestResponse = await selfTestApi.post(ctx);
  const selfTestPayload = await host.readJson<{
    ok: boolean;
    statusCounts: { failed: number; passed: number; skipped: number };
    checks: Array<{ id: string; status: string }>;
    apiKey: { key?: string } | null;
  }>(selfTestResponse);

  if (
    selfTestResponse.status !== 200 ||
    !selfTestPayload.ok ||
    selfTestPayload.statusCounts.failed !== 0 ||
    !selfTestPayload.checks.some((check) => check.id === 'storage.crud') ||
    !selfTestPayload.checks.some((check) => check.id === 'events.jobs') ||
    !selfTestPayload.apiKey?.key
  ) {
    throw new Error('Self-test API did not exercise the expanded capability surface.');
  }

  const operations: Record<string, string[]> = {
    artifacts: host.state.artifacts.map((entry) => entry.operation),
    files: host.state.files.map((entry) => entry.operation),
    rag: host.state.rag.map((entry) => entry.operation),
    ai: host.state.ai.map((entry) => entry.operation),
    credits: host.state.credits.map((entry) => entry.operation),
    metering: host.state.metering.map((entry) => entry.operation),
    billing: host.state.billing.map((entry) => entry.operation),
    usage: host.state.usage.map((entry) => entry.metric),
    audit: host.state.audit.map((entry) => entry.action),
    toasts: host.state.toasts.map((entry) => entry.type),
    workspace: host.state.workspace.map((entry) => entry.operation),
    runs: host.state.runs.map((entry) => entry.operation),
    connectors: host.state.connectors.map((entry) => entry.operation),
    apiKeys: host.state.apiKeys.map((entry) => entry.operation),
    rateLimit: host.state.rateLimit.map((entry) => entry.bucket),
    http: host.state.httpRequests.map((entry) => entry.url),
    events: host.state.events.map((entry) => entry.event),
    jobs: host.state.jobs.map((entry) => entry.name),
    registeredJobs: host.state.registeredJobs.map((entry) => entry.name),
    notifications: host.state.notifications.map((entry) => entry.message),
  };

  const required: Record<string, string[]> = {
    artifacts: ['writeText', 'readText', 'list', 'tree'],
    files: ['createUpload', 'read', 'createSignedDownloadUrl', 'list'],
    rag: ['index', 'search', 'buildContextPack'],
    ai: ['generateText', 'embedText'],
    credits: ['consume', 'getBalance'],
    metering: ['authorize', 'commit', 'reconcile'],
    billing: ['getCurrentPlan', 'hasEntitlement', 'redeemCode'],
    usage: ['capability-demo.pipeline.run', 'capability-demo.csv.request'],
    audit: [
      'capability-demo.pipeline.run',
      'capability-demo.csv.convert',
      'capability-demo.seo-check.request',
    ],
    toasts: ['success'],
    workspace: ['current', 'create', 'members', 'hasRole'],
    runs: ['create', 'update', 'appendLog', 'addResult', 'get'],
    connectors: ['get', 'upsert', 'list', 'setStatus', 'delete', 'call', 'createSignedCallback'],
    apiKeys: ['create', 'list'],
    rateLimit: ['capability-demo.pipeline.run', 'capability-demo.csv.convert'],
    http: ['https://example.com/'],
    events: ['capability-demo.selftest.event'],
    jobs: ['capability-demo.selftest.dynamic-job', 'capability-demo.selftest.job'],
    registeredJobs: ['capability-demo.selftest.job', 'capability-demo.selftest.dynamic-job'],
    notifications: ['Self-test fake-self-test completed host notification probe.'],
  };

  for (const [key, expectedValues] of Object.entries(required)) {
    const actualValues = operations[key] ?? [];
    for (const expected of expectedValues) {
      if (
        key === 'http'
          ? !actualValues.some((value) => value === expected)
          : !actualValues.includes(expected)
      ) {
        throw new Error(`Capability demo did not record ${key}.${expected}.`);
      }
    }
  }
});
