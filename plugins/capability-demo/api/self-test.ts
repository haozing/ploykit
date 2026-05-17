import { defineApi, z, type PluginResourceScope } from '@ploykit/plugin-sdk';

export const dynamic = 'force-dynamic';

const selfTestSchema = z
  .object({
    seed: z.string().min(1).optional(),
    includeAi: z.boolean().default(true),
    includeExternal: z.boolean().default(true),
    createApiKey: z.boolean().default(true),
    returnApiKey: z.boolean().default(false),
  })
  .default({
    includeAi: true,
    includeExternal: true,
    createApiKey: true,
    returnApiKey: false,
  });

type CheckStatus = 'passed' | 'failed' | 'skipped';

interface CapabilityCheck {
  id: string;
  capability: string;
  status: CheckStatus;
  durationMs: number;
  evidence?: Record<string, unknown>;
  reason?: string;
  error?: {
    code?: string;
    message: string;
    statusCode?: number;
  };
}

interface DemoStorageItem {
  [key: string]: unknown;
  id: string;
  title: string;
  status: 'open' | 'done' | 'archived';
  sequence: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const SELFTEST_METER = 'capability-demo.selftest.request';
const CREDIT_METER = 'capability-demo.external-api';

function codeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function statusCodeOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const raw = (error as { statusCode?: unknown; status?: unknown }).statusCode;
  const fallback = (error as { status?: unknown }).status;
  return typeof raw === 'number' ? raw : typeof fallback === 'number' ? fallback : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shortKey(value: string | undefined): string | undefined {
  return value ? `${value.slice(0, 12)}...` : undefined;
}

async function readFileBytes(body: ReadableStream | Buffer): Promise<number> {
  if (body instanceof ReadableStream) {
    return (await new Response(body).arrayBuffer()).byteLength;
  }

  return body.byteLength;
}

async function drainStream(
  stream: AsyncIterable<{ type: string; text?: string }>
): Promise<string> {
  let text = '';
  for await (const event of stream) {
    if (event.type === 'text-delta' && event.text) {
      text += event.text;
    }
  }
  return text;
}

function isExpectedUnavailable(error: unknown): boolean {
  return (
    codeOf(error) === 'PLUGIN_AI_PROVIDER_UNCONFIGURED' ||
    codeOf(error) === 'PLUGIN_BILLING_REDEMPTION_UNAVAILABLE' ||
    codeOf(error) === 'PLUGIN_BILLING_ADMIN_REQUIRED' ||
    statusCodeOf(error) === 501
  );
}

function tally(checks: CapabilityCheck[]): Record<CheckStatus, number> {
  return checks.reduce(
    (acc, check) => {
      acc[check.status] += 1;
      return acc;
    },
    { passed: 0, failed: 0, skipped: 0 }
  );
}

export default defineApi({
  async post(ctx) {
    const input = await ctx.request.json(selfTestSchema);
    const seed =
      input.seed ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const checks: CapabilityCheck[] = [];
    let workspaceScope: PluginResourceScope | undefined;
    let runId: string | undefined;
    let apiKeyForRuntime:
      | {
          id: string;
          key: string;
          scope: PluginResourceScope;
          permissions: string[];
        }
      | undefined;

    async function check(
      id: string,
      capability: string,
      run: () => Promise<Record<string, unknown> | void>,
      options: { expectedUnavailable?: boolean } = {}
    ): Promise<void> {
      const startedAt = Date.now();
      try {
        const evidence = (await run()) ?? undefined;
        checks.push({
          id,
          capability,
          status: 'passed',
          durationMs: Date.now() - startedAt,
          evidence,
        });
      } catch (error) {
        if (options.expectedUnavailable && isExpectedUnavailable(error)) {
          checks.push({
            id,
            capability,
            status: 'skipped',
            durationMs: Date.now() - startedAt,
            reason: messageOf(error),
            error: {
              code: codeOf(error),
              message: messageOf(error),
              statusCode: statusCodeOf(error),
            },
          });
          return;
        }

        checks.push({
          id,
          capability,
          status: 'failed',
          durationMs: Date.now() - startedAt,
          error: {
            code: codeOf(error),
            message: messageOf(error),
            statusCode: statusCodeOf(error),
          },
        });
      }
    }

    ctx.jobs.register?.('capability-demo.selftest.job', async () => undefined, {
      timeoutMs: 5000,
      retries: 0,
    });

    await check('context.request', 'Plugin request/user/auth context', async () => ({
      pluginId: ctx.plugin.id,
      version: ctx.plugin.version,
      method: ctx.request.method,
      userId: ctx.user?.id,
      apiKeyId: ctx.auth?.apiKey?.id,
    }));

    await check('workspace.crud', 'Workspace scope and membership', async () => {
      const before = await ctx.workspace.current();
      const workspace = await ctx.workspace.create({
        name: `Capability Demo ${seed}`,
        slug: `cap-demo-${seed}`,
        metadata: { seed, capabilityDemo: true },
      });
      workspaceScope = { type: 'workspace', id: workspace.id };
      const [list, members, canRead, canManage, invitation] = await Promise.all([
        ctx.workspace.list(),
        ctx.workspace.members(workspace.id),
        ctx.workspace.hasRole(['owner', 'admin', 'editor', 'viewer'], workspace.id),
        ctx.workspace.hasRole(['owner', 'admin'], workspace.id),
        ctx.workspace.invite({
          workspaceId: workspace.id,
          email: `capability-demo+${seed}@example.test`,
          role: 'viewer',
        }),
      ]);

      return {
        previousCurrentWorkspaceId: before?.id,
        workspaceId: workspace.id,
        listed: list.some((item) => item.id === workspace.id),
        memberCount: members.length,
        canRead,
        canManage,
        invitationStatus: invitation.status,
      };
    });

    const scope: PluginResourceScope =
      workspaceScope ?? (ctx.user?.id ? { type: 'user', id: ctx.user.id } : { type: 'user' });

    await check('storage.crud', 'Plugin storage CRUD and transaction', async () => {
      await ctx.storage.ensureCollections();
      const collection = ctx.storage.collection<DemoStorageItem>('capability_demo_items');
      const created = await collection.insert({
        title: `Self-test ${seed}`,
        status: 'open',
        sequence: 1,
        metadata: { seed },
      });
      const found = await collection.findById(created.id);
      const updated = await collection.update(created.id, { status: 'done', sequence: 2 });
      const queried = await collection.findMany({
        where: { status: 'done' },
        orderBy: { sequence: 'desc' },
        limit: 10,
      });
      const transactionResult = await ctx.storage.transaction(async (storage) => {
        const txCollection = storage.collection<DemoStorageItem>('capability_demo_items');
        return txCollection.insert({
          title: `Tx ${seed}`,
          status: 'open',
          sequence: 3,
          metadata: { tx: true },
        });
      });
      await collection.delete(created.id);
      await collection.delete(transactionResult.id);

      return {
        createdId: created.id,
        found: found?.id === created.id,
        updatedStatus: updated.status,
        queryCount: queried.length,
        transactionId: transactionResult.id,
      };
    });

    await check('config.secrets', 'Config defaults and encrypted secrets', async () => {
      const defaultMode = await ctx.config.get('mode');
      await ctx.config.set?.('selfTestLastSeed', seed);
      const configValue = await ctx.config.get('selfTestLastSeed');
      await ctx.config.delete?.('selfTestLastSeed');
      await ctx.secrets.set?.('self-test-token', `secret-${seed}`);
      const secretValue = await ctx.secrets.get('self-test-token');
      await ctx.secrets.delete?.('self-test-token');

      return {
        defaultMode,
        configRoundTrip: configValue === seed,
        secretRoundTrip: secretValue === `secret-${seed}`,
      };
    });

    await check('rate-limit', 'Rate limit bucket', async () => {
      const result = await ctx.rateLimit.check({
        bucket: `capability-demo.self-test.${seed}.{route}`,
        limit: 100,
        window: '1m',
        cost: 1,
      });
      return { allowed: result.allowed, remaining: result.remaining };
    });

    await check('runs.lifecycle', 'Runs lifecycle and task center records', async () => {
      const run = await ctx.runs.create({
        scope,
        title: `Capability demo self-test ${seed}`,
        visibility: 'user-visible',
        inputs: [{ type: 'storage', ref: seed, label: 'Self-test seed' }],
        metadata: { seed },
        idempotencyKey: `capability-demo:${seed}:run`,
      });
      runId = run.id;
      await ctx.runs.update(run.id, { status: 'running', progress: 25, metadata: { seed } });
      await ctx.runs.appendLog(run.id, {
        level: 'info',
        message: 'self-test run started',
        metadata: { seed },
      });
      await ctx.runs.addResult(run.id, {
        type: 'external',
        ref: `self-test:${seed}`,
        label: 'Self-test marker',
      });
      const completed = await ctx.runs.complete(run.id, { seed, completed: true });
      const fetched = await ctx.runs.get(run.id);
      const listed = await ctx.runs.list({ scope, status: 'succeeded', limit: 20 });
      const cancelRun = await ctx.runs.create({
        scope,
        title: `Capability demo cancel ${seed}`,
        visibility: 'internal',
        metadata: { seed, branch: 'cancel' },
      });
      const cancelRequested = await ctx.runs.requestCancel(cancelRun.id, 'self-test cancel');
      const failRun = await ctx.runs.create({
        scope,
        title: `Capability demo fail ${seed}`,
        visibility: 'internal',
        metadata: { seed, branch: 'fail' },
      });
      const failed = await ctx.runs.fail(failRun.id, {
        code: 'SELF_TEST_EXPECTED_FAILURE',
        message: 'self-test expected failure branch',
        metadata: { seed },
      });

      return {
        runId: run.id,
        completedStatus: completed.status,
        fetchedResults: fetched?.results.length ?? 0,
        listedCount: listed.length,
        cancelStatus: cancelRequested.status,
        failedStatus: failed.status,
      };
    });

    await check('files.lifecycle', 'Files upload/read/sign/archive/delete', async () => {
      const body = Buffer.from(`capability-demo file ${seed}`, 'utf8');
      const readyFile = await ctx.files.createUpload({
        scope,
        fileName: `self-test-${seed}.txt`,
        contentType: 'text/plain',
        size: body.byteLength,
        purpose: 'source',
        body,
        runId,
        metadata: { seed },
      });
      const read = await ctx.files.read(readyFile.id);
      const byteLength = await readFileBytes(read.body);
      const downloaded = await ctx.files.createSignedDownloadUrl(readyFile.id, {
        expiresInSeconds: 300,
      });
      const listedReady = await ctx.files.list({
        scope,
        purpose: 'source',
        status: 'ready',
        limit: 20,
      });
      const pendingFile = await ctx.files.createUpload({
        scope,
        fileName: `pending-${seed}.txt`,
        contentType: 'text/plain',
        size: 0,
        purpose: 'temp',
        metadata: { seed },
      });
      const uploadUrl = await ctx.files.createSignedUploadUrl(pendingFile.id, {
        expiresInSeconds: 300,
      });
      const completedPending = await ctx.files.completeUpload({
        fileId: pendingFile.id,
        size: 0,
        metadata: { completedBy: 'self-test' },
      });
      const archived = await ctx.files.archive(readyFile.id);
      await ctx.files.delete(pendingFile.id);

      return {
        readyFileId: readyFile.id,
        readBytes: byteLength,
        listedReady: listedReady.length,
        signedDownload: downloaded.includes('/download'),
        signedUpload: uploadUrl.includes('/upload'),
        completedPendingStatus: completedPending.status,
        archivedStatus: archived.status,
      };
    });

    await check('artifacts.rag', 'Artifacts and RAG indexing/search/context/delete', async () => {
      const path = `self-test/${seed}/source.md`;
      const content = `Alpha planning note.\n\nBeta execution note for ${seed}.\n\nGamma review note.`;
      const artifact = await ctx.artifacts.writeText({
        scope,
        path,
        content,
        contentType: 'text/markdown',
        metadata: { seed, stage: 'source' },
      });
      const read = await ctx.artifacts.readText({ scope, path });
      const list = await ctx.artifacts.list({ scope, prefix: `self-test/${seed}`, limit: 10 });
      const tree = await ctx.artifacts.tree({ scope, prefix: `self-test/${seed}`, limit: 10 });
      const metadata = await ctx.artifacts.updateMetadata({
        scope,
        path,
        metadata: { reviewed: true },
        merge: true,
      });
      const indexed = await ctx.rag.index({
        scope,
        path,
        metadata: { seed },
        chunkSize: 80,
        chunkOverlap: 10,
      });
      const hits = await ctx.rag.search({ scope, query: 'Beta execution', topK: 5 });
      const contextPack = await ctx.rag.buildContextPack({
        scope,
        query: 'Beta execution',
        topK: 5,
        maxCharacters: 500,
      });
      await ctx.rag.delete({ scope, sourceId: indexed.sourceId });
      await ctx.artifacts.delete({ scope, path });

      return {
        artifactId: artifact.id,
        readBack: read?.content.includes(seed),
        listCount: list.length,
        treeCount: tree.length,
        metadataReviewed: metadata.metadata.reviewed === true,
        chunkCount: indexed.chunkCount,
        hitCount: hits.length,
        contextSources: contextPack.sources.length,
      };
    });

    await check('metering.ledger', 'Metering authorize/commit/refund/void/reconcile', async () => {
      const authorization = await ctx.metering.authorize({
        meter: SELFTEST_METER,
        amount: 1,
        scope,
        runId,
        idempotencyKey: `capability-demo:${seed}:meter:authorize`,
        metadata: { seed },
      });
      const commit = await ctx.metering.commit({
        meter: SELFTEST_METER,
        amount: 1,
        scope,
        runId,
        idempotencyKey: `capability-demo:${seed}:meter:commit`,
        metadata: { seed },
      });
      const refund = await ctx.metering.refund({
        meter: SELFTEST_METER,
        amount: 1,
        scope,
        runId,
        idempotencyKey: `capability-demo:${seed}:meter:refund`,
        metadata: { seed },
      });
      const voided = await ctx.metering.void({
        meter: SELFTEST_METER,
        amount: 1,
        scope,
        runId,
        idempotencyKey: `capability-demo:${seed}:meter:void`,
        metadata: { seed },
      });
      const reconcile = await ctx.metering.reconcile({ meter: SELFTEST_METER });

      return {
        authorized: authorization.authorized,
        creditCost: authorization.creditCost,
        usageId: commit.usageId,
        refundAdjusted: refund.adjusted,
        voidAdjusted: voided.adjusted,
        usageAmount: reconcile.usageAmount,
      };
    });

    await check('credits.consume', 'Credits balance and consumption', async () => {
      const before = await ctx.credits.getBalance();
      if (!before.unlimited && before.balance < 1) {
        return {
          skippedByBalance: true,
          metric: before.metric,
          balance: before.balance,
        };
      }
      const consumed = await ctx.credits.consume({
        meter: CREDIT_METER,
        amount: 1,
        idempotencyKey: `capability-demo:${seed}:credits`,
        metadata: { seed },
      });
      const after = await ctx.credits.getBalance();

      return {
        metric: before.metric,
        balanceBefore: before.balance,
        consumed: consumed.consumed,
        balanceAfter: after.balance,
      };
    });

    await check('billing.entitlements', 'Billing plan and entitlement read gates', async () => {
      const plan = await ctx.billing.getCurrentPlan();
      const hasFreePlan = await ctx.billing.hasEntitlement('plan:free');
      const hasExportFeature = await ctx.billing.hasEntitlement('feature.export');
      return {
        planId: plan?.id,
        planStatus: plan?.status,
        hasFreePlan,
        hasExportFeature,
      };
    });

    await check(
      'billing.redeem-code',
      'Billing redeemCode host boundary',
      async () => {
        const redemption = await ctx.billing.redeemCode({
          code: `SELFTEST-${seed}`,
          metadata: { seed },
        });
        return { redeemed: redemption.redeemed, redemptionId: redemption.redemptionId };
      },
      { expectedUnavailable: true }
    );

    await check(
      'billing.grant-plan',
      'Billing grantPlan admin/system guard',
      async () => {
        const plan = await ctx.billing.getCurrentPlan();
        if (!plan?.id) {
          throw Object.assign(new Error('No current plan is available to grant.'), {
            code: 'PLUGIN_BILLING_GRANT_PLAN_NO_CURRENT_PLAN',
            statusCode: 501,
          });
        }
        const granted = await ctx.billing.grantPlan({
          planId: plan.id,
          reason: 'Capability demo self-test admin/system guard',
          idempotencyKey: `capability-demo:${seed}:grant-plan`,
        });
        return { entitlementId: granted.entitlementId, status: granted.status };
      },
      { expectedUnavailable: true }
    );

    if (input.includeAi) {
      await check(
        'ai.generate-stream-embed',
        'AI generateText/streamText/embedText',
        async () => {
          const generated = await ctx.ai.generateText({
            model: 'host.default.generate',
            prompt: `Summarize capability seed ${seed}.`,
            meter: 'capability-demo.ai.generate',
            creditAmount: 0,
            metadata: { seed, mode: 'self-test' },
          });
          const streamedText = await drainStream(
            ctx.ai.streamText({
              model: 'host.default.generate',
              prompt: `Stream capability seed ${seed}.`,
              meter: 'capability-demo.ai.generate',
              creditAmount: 0,
              metadata: { seed, mode: 'self-test-stream' },
            })
          );
          const embedded = await ctx.ai.embedText({
            model: 'host.default.embed',
            input: [`Embedding ${seed}`, generated.text],
            meter: 'capability-demo.ai.embed',
            creditAmount: 0,
            metadata: { seed, mode: 'self-test' },
          });
          return {
            model: generated.model,
            textLength: generated.text.length,
            streamedCharacters: streamedText.length,
            embeddings: embedded.embeddings.length,
          };
        },
        { expectedUnavailable: true }
      );
    } else {
      checks.push({
        id: 'ai.generate-stream-embed',
        capability: 'AI generateText/streamText/embedText',
        status: 'skipped',
        durationMs: 0,
        reason: 'includeAi=false',
      });
    }

    await check('usage.audit.notification.ui', 'Usage/audit/notification/UI toast', async () => {
      await ctx.usage.increment('capability-demo.selftest.usage', 1, {
        unit: 'request',
        idempotencyKey: `capability-demo:${seed}:usage`,
        metadata: { seed },
      });
      await ctx.audit.record('capability-demo.selftest.audit', { seed, scope });
      const notification = await ctx.notifications.send({
        channel: 'in-app',
        subject: 'Capability demo self-test',
        message: `Self-test ${seed} completed host notification probe.`,
        metadata: { seed },
      });
      await ctx.ui.toast.info('Capability demo self-test notification probe completed');
      return { notificationId: notification.id, queued: notification.queued };
    });

    await check('events.jobs', 'Events emit/subscribe and jobs enqueue/register', async () => {
      const dynamicJobName = 'capability-demo.selftest.dynamic-job';
      ctx.jobs.register?.(dynamicJobName, async () => undefined, {
        timeoutMs: 5000,
        retries: 0,
      });
      ctx.events.on?.('capability-demo.selftest.event', async () => undefined);
      await ctx.events.emit('capability-demo.selftest.event', { seed, scope });
      ctx.events.off?.('capability-demo.selftest.event');
      const dynamicJob = await ctx.jobs.enqueue(dynamicJobName, { seed, dynamic: true });
      const declaredJob = await ctx.jobs.enqueue('capability-demo.selftest.job', {
        seed,
        declared: true,
      });

      return {
        dynamicJobId: dynamicJob.id,
        declaredJobId: declaredJob.id,
      };
    });

    if (input.includeExternal) {
      await check('http.external', 'External HTTP egress guard', async () => {
        const response = await ctx.http.fetch('https://example.com/', {
          method: 'GET',
          headers: { accept: 'text/html', 'user-agent': 'ploykit-capability-demo/0.1' },
        });
        const text = await response.text();
        return { status: response.status, ok: response.ok, bytes: text.length };
      });

      await check('connectors.lifecycle-call', 'Connectors CRUD/call/callback', async () => {
        const connectorName = `self-test-${seed}`.replace(/[^a-zA-Z0-9._:-]/g, '-');
        const upserted = await ctx.connectors.upsert({
          name: connectorName,
          type: 'http',
          baseUrl: 'https://example.com',
          scope,
          auth: { type: 'none' },
          egress: { allowedHosts: ['example.com'], allowedMethods: ['GET'] },
          retry: { count: 0, backoffMs: 0, retryableStatusCodes: [] },
          redaction: { requestHeaders: ['authorization'], responseHeaders: [] },
          timeoutMs: 30000,
          metadata: { seed },
        });
        const listed = await ctx.connectors.list({ scope, includeDisabled: true });
        const disabled = await ctx.connectors.setStatus(connectorName, 'disabled', { scope });
        await ctx.connectors.setStatus(connectorName, 'active', { scope });
        const call = await ctx.connectors.call(connectorName, {
          method: 'GET',
          path: '/',
          scope,
          runId,
          metadata: { seed },
        });
        const callback = await ctx.connectors.createSignedCallback({
          connector: connectorName,
          runId,
          scope,
          expiresInSeconds: 300,
          metadata: { seed },
        });
        await ctx.connectors.delete(connectorName, { scope });

        return {
          connector: upserted.name,
          listed: listed.some((item) => item.name === connectorName),
          disabledStatus: disabled.status,
          callStatus: call.status,
          callOk: call.ok,
          callbackHasToken: Boolean(callback.token),
        };
      });
    } else {
      checks.push({
        id: 'http.external',
        capability: 'External HTTP egress guard',
        status: 'skipped',
        durationMs: 0,
        reason: 'includeExternal=false',
      });
      checks.push({
        id: 'connectors.lifecycle-call',
        capability: 'Connectors CRUD/call/callback',
        status: 'skipped',
        durationMs: 0,
        reason: 'includeExternal=false',
      });
    }

    if (input.createApiKey) {
      await check('api-keys.lifecycle', 'Plugin API keys create/list/revoke', async () => {
        const activeKey = await ctx.apiKeys.create({
          name: `Capability Demo Runtime ${seed}`,
          scope,
          permissions: ['POST:/api-key-echo', 'route:POST:/api-key-echo'],
          metadata: { seed, purpose: 'runtime-echo' },
        });
        apiKeyForRuntime = {
          id: activeKey.id,
          key: activeKey.key,
          scope: activeKey.scope,
          permissions: activeKey.permissions,
        };

        const revokeKey = await ctx.apiKeys.create({
          name: `Capability Demo Revoke ${seed}`,
          scope,
          permissions: ['POST:/api-key-echo', 'route:POST:/api-key-echo'],
          metadata: { seed, purpose: 'revoke-probe' },
        });
        const listed = await ctx.apiKeys.list({ scope });
        await ctx.apiKeys.revoke(revokeKey.id);

        return {
          activeKeyId: activeKey.id,
          activeKeyPreview: shortKey(activeKey.key),
          revokedKeyId: revokeKey.id,
          listed: listed.length,
          permissions: activeKey.permissions,
        };
      });
    } else {
      checks.push({
        id: 'api-keys.lifecycle',
        capability: 'Plugin API keys create/list/revoke',
        status: 'skipped',
        durationMs: 0,
        reason: 'createApiKey=false',
      });
    }

    const counts = tally(checks);
    return ctx.json({
      ok: counts.failed === 0,
      seed,
      generatedAt: new Date().toISOString(),
      statusCounts: counts,
      workspaceScope,
      runId,
      apiKey: apiKeyForRuntime
        ? {
            id: apiKeyForRuntime.id,
            key: input.returnApiKey ? apiKeyForRuntime.key : undefined,
            keyPreview: shortKey(apiKeyForRuntime.key),
            scope: apiKeyForRuntime.scope,
            permissions: apiKeyForRuntime.permissions,
          }
        : null,
      checks,
    });
  },
});
