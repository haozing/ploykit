import { defineApi, z } from '@ploykit/plugin-sdk';

const runSchema = z.object({
  workspaceSlug: z.string().min(1).default('demo-workspace'),
  path: z.string().min(1).default('docs/source.md'),
  content: z
    .string()
    .min(1)
    .default('Alpha planning note.\n\nBeta execution note.\n\nGamma review note.'),
  query: z.string().min(1).default('Beta execution'),
  code: z.string().min(1).default('WELCOME-2026'),
});

export default defineApi({
  async post(ctx) {
    const input = await ctx.request.json(runSchema);
    const workspace =
      (await ctx.workspace.current()) ??
      (await ctx.workspace.create({
        name: 'Capability Demo Workspace',
        slug: input.workspaceSlug,
        metadata: { demo: true },
      }));
    const scope = { type: 'workspace' as const, id: workspace.id };
    const members = await ctx.workspace.members(workspace.id);
    const canManageWorkspace = await ctx.workspace.hasRole(['owner', 'admin'], workspace.id);
    await ctx.rateLimit.check({
      bucket: 'capability-demo.pipeline.run',
      limit: 100,
      window: '1m',
    });
    const apiKey = await ctx.apiKeys.create({
      name: 'Capability Demo Key',
      scope,
      permissions: ['pipeline:run'],
      metadata: { demo: true },
    });
    const apiKeys = await ctx.apiKeys.list({ scope });
    const run = await ctx.runs.create({
      scope,
      title: 'Capability demo pipeline',
      visibility: 'user-visible',
      inputs: [{ type: 'artifact', ref: input.path, label: 'Source markdown' }],
      costs: [
        {
          meter: 'capability-demo.ocr.page',
          amount: 2,
          unit: 'page',
          metadata: { demo: 'pdf-ocr-simulation' },
        },
      ],
      metadata: { path: input.path, demo: true },
      idempotencyKey: `capability-demo:${scope.id}:${input.path}:run`,
    });
    await ctx.runs.update(run.id, { status: 'running', progress: 10 });
    await ctx.runs.appendLog(run.id, {
      level: 'info',
      message: 'Capability demo started',
      metadata: { scope },
    });
    const sourceBytes = Buffer.from(input.content, 'utf8');
    const sourceFile = await ctx.files.createUpload({
      scope,
      fileName: 'source.md',
      contentType: 'text/markdown',
      size: sourceBytes.byteLength,
      purpose: 'source',
      body: sourceBytes,
      runId: run.id,
      metadata: { path: input.path, demo: 'source-upload' },
    });
    const sourceFileRead = await ctx.files.read(sourceFile.id);
    const sourceReadBytes =
      sourceFileRead.body instanceof ReadableStream
        ? (await new Response(sourceFileRead.body).arrayBuffer()).byteLength
        : sourceFileRead.body.byteLength;
    const sourceFileUrl = await ctx.files.createSignedDownloadUrl(sourceFile.id, {
      expiresInSeconds: 600,
    });
    const sourceFiles = await ctx.files.list({
      scope,
      purpose: 'source',
      runId: run.id,
    });

    const meteringAuthorization = await ctx.metering.authorize({
      meter: 'capability-demo.ocr.page',
      amount: 2,
      runId: run.id,
      idempotencyKey: `capability-demo:${scope.id}:${input.path}:ocr:authorize`,
      metadata: { workflow: 'capability-demo', pages: 2 },
    });
    const meteringCommit = await ctx.metering.commit({
      meter: 'capability-demo.ocr.page',
      amount: 2,
      runId: run.id,
      idempotencyKey: `capability-demo:${scope.id}:${input.path}:ocr:commit`,
      metadata: { workflow: 'capability-demo', pages: 2 },
    });
    const meteringReconcile = await ctx.metering.reconcile({
      meter: 'capability-demo.ocr.page',
    });

    const artifact = await ctx.artifacts.writeText({
      scope,
      path: input.path,
      content: input.content,
      contentType: 'text/markdown',
      metadata: {
        kind: 'capability-demo-source',
        stage: 'source',
      },
    });
    const artifactRead = await ctx.artifacts.readText({
      scope,
      path: input.path,
    });
    const artifactList = await ctx.artifacts.list({
      scope,
      prefix: 'docs',
    });
    const artifactTree = await ctx.artifacts.tree({
      scope,
      prefix: 'docs',
    });

    const indexed = await ctx.rag.index({
      scope,
      path: input.path,
      metadata: {
        kind: 'capability-demo-source',
      },
    });
    const hits = await ctx.rag.search({
      scope,
      query: input.query,
      topK: 3,
    });
    const contextPack = await ctx.rag.buildContextPack({
      scope,
      query: input.query,
      topK: 3,
      maxCharacters: 1200,
    });

    const generated = await ctx.ai.generateText({
      model: 'host.default.generate',
      messages: [
        {
          role: 'system',
          content: 'Summarize the provided context in one short paragraph.',
        },
        {
          role: 'user',
          content: contextPack.content,
        },
      ],
      meter: 'capability-demo.ai.generate',
      creditAmount: 1,
      metadata: {
        workflow: 'capability-demo',
      },
    });
    const embedded = await ctx.ai.embedText({
      input: [input.query, generated.text],
      model: 'host.default.embed',
      meter: 'capability-demo.ai.embed',
      creditAmount: 1,
      metadata: {
        workflow: 'capability-demo',
      },
    });

    const manualCredit = await ctx.credits.consume({
      meter: 'capability-demo.external-api',
      amount: 1,
      idempotencyKey: `capability-demo:${scope.id}:${input.path}:external`,
      metadata: {
        reason: 'manual external API simulation',
      },
    });
    const balance = await ctx.credits.getBalance();
    const plan = await ctx.billing.getCurrentPlan();
    const hasExport = await ctx.billing.hasEntitlement('feature.export');
    const redemption = await ctx.billing.redeemCode({
      code: input.code,
      metadata: {
        workflow: 'capability-demo',
      },
    });
    const connector = await ctx.connectors.get('demo-service');
    const managedConnector = await ctx.connectors.upsert({
      name: 'managed-demo-service',
      baseUrl: 'https://connector.test',
      scope,
      metadata: { demo: true },
    });
    const managedConnectors = await ctx.connectors.list({ scope, includeDisabled: true });
    const disabledConnector = await ctx.connectors.setStatus('managed-demo-service', 'disabled', {
      scope,
    });
    await ctx.connectors.delete('managed-demo-service', { scope });
    const connectorCall = await ctx.connectors.call('demo-service', {
      method: 'POST',
      path: '/run',
      json: { query: input.query },
      files: [{ fileId: sourceFile.id, name: 'source' }],
      runId: run.id,
      meter: 'capability-demo.connector.demo-service',
      creditAmount: 1,
      idempotencyKey: `capability-demo:${scope.id}:${input.path}:connector`,
      metadata: { workflow: 'capability-demo' },
    });
    const callback = await ctx.connectors.createSignedCallback({
      connector: 'demo-service',
      runId: run.id,
    });
    const resultContent = `# Capability Demo Result\n\n${generated.text}`;
    const resultBytes = Buffer.from(resultContent, 'utf8');
    const resultFile = await ctx.files.createUpload({
      scope,
      fileName: 'summary.md',
      contentType: 'text/markdown',
      size: resultBytes.byteLength,
      purpose: 'result',
      body: resultBytes,
      runId: run.id,
      metadata: { generatedCharacters: generated.text.length },
    });
    const resultFiles = await ctx.files.list({
      scope,
      purpose: 'result',
      runId: run.id,
    });
    await ctx.runs.addResult(run.id, {
      type: 'artifact',
      ref: artifact.path,
      metadata: { artifactId: artifact.id },
    });
    await ctx.runs.addResult(run.id, {
      type: 'file',
      ref: resultFile.id,
      label: 'Generated summary',
      metadata: { fileName: resultFile.fileName },
    });
    await ctx.runs.complete(run.id, { generatedCharacters: generated.text.length });
    const completedRun = await ctx.runs.get(run.id);

    await ctx.usage.increment('capability-demo.pipeline.run', 1, {
      unit: 'run',
      metadata: {
        scope,
      },
    });
    await ctx.audit.record('capability-demo.pipeline.run', {
      scope,
      path: input.path,
      hits: hits.length,
      generatedCharacters: generated.text.length,
      embeddingCount: embedded.embeddings.length,
    });
    await ctx.ui.toast.success('Capability demo completed');

    return ctx.json({
      workspace: {
        id: workspace.id,
        memberCount: members.length,
        canManageWorkspace,
      },
      run: completedRun,
      apiKey: {
        id: apiKey.id,
        keyPreview: `${apiKey.key.slice(0, 12)}...`,
        listed: apiKeys.length,
      },
      connector,
      managedConnector,
      managedConnectors,
      disabledConnector,
      connectorCall,
      callback,
      files: {
        source: sourceFile,
        sourceReadBytes,
        sourceDownloadUrl: sourceFileUrl,
        sourcesListed: sourceFiles.length,
        result: resultFile,
        resultsListed: resultFiles.length,
      },
      metering: {
        authorization: meteringAuthorization,
        commit: meteringCommit,
        reconcile: meteringReconcile,
      },
      artifact: {
        id: artifact.id,
        path: artifact.path,
        version: artifact.version,
        hash: artifact.hash,
      },
      artifactRead: artifactRead
        ? {
            id: artifactRead.id,
            path: artifactRead.path,
            content: artifactRead.content,
          }
        : null,
      artifactList,
      artifactTree,
      indexed,
      hits,
      contextPack: {
        characterCount: contextPack.characterCount,
        sourceCount: contextPack.sources.length,
      },
      generated,
      embedded,
      manualCredit,
      balance,
      plan,
      hasExport,
      redemption,
    });
  },
});
