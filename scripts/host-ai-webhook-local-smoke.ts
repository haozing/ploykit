import { createHmac } from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  createWebhookModuleAiProvider,
  resolveHostAiProviderConfig,
} from '../apps/host-next/lib/ai-provider';

const checkedAt = new Date().toISOString();
const secret = 'local-ai-webhook-secret';

function readRequestBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function verifySignature(body: string, signature: string | string[] | undefined): boolean {
  if (typeof signature !== 'string') {
    return false;
  }
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  return signature === expected;
}

async function withLocalWebhook<TResult>(run: (url: string) => Promise<TResult>): Promise<TResult> {
  const received: Array<{ operation?: unknown; signed: boolean }> = [];
  const server = http.createServer(async (request, response) => {
    const body = await readRequestBody(request);
    const signed = verifySignature(body, request.headers['x-ploykit-ai-signature']);
    const payload = JSON.parse(body) as {
      operation?: string;
      prompt?: string;
      text?: string;
      model?: string;
    };
    received.push({ operation: payload.operation, signed });

    response.setHeader('content-type', 'application/json');
    if (!signed) {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: { message: 'signature required' } }));
      return;
    }
    if (payload.operation === 'generateText') {
      response.end(
        JSON.stringify({
          text: `webhook-ai:${payload.prompt ?? ''}`,
          model: payload.model,
          usage: { inputTokens: 2, outputTokens: 3 },
        })
      );
      return;
    }
    if (payload.operation === 'embedText') {
      response.end(
        JSON.stringify({
          embedding: [String(payload.text ?? '').length, 1, 0],
          model: payload.model,
          usage: { inputTokens: 1 },
        })
      );
      return;
    }
    response.statusCode = 400;
    response.end(JSON.stringify({ error: { message: 'unknown operation' } }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('LOCAL_AI_WEBHOOK_LISTEN_FAILED');
  }

  try {
    const result = await run(`http://127.0.0.1:${address.port}/ai`);
    if (received.length !== 2 || received.some((item) => !item.signed)) {
      throw new Error('LOCAL_AI_WEBHOOK_SIGNATURE_MISMATCH');
    }
    return result;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const checks: Array<{
  id: string;
  ok: boolean;
  durationMs: number;
  detail: Record<string, unknown>;
  error?: string;
}> = [];
const startedAt = Date.now();

try {
  const result = await withLocalWebhook(async (webhookUrl) => {
    const env = {
      PLOYKIT_AI_PROVIDER: 'webhook',
      PLOYKIT_AI_WEBHOOK_URL: webhookUrl,
      PLOYKIT_AI_WEBHOOK_SECRET: secret,
      PLOYKIT_AI_TEXT_MODEL: 'local-text',
      PLOYKIT_AI_EMBEDDING_MODEL: 'local-embedding',
    };
    const config = resolveHostAiProviderConfig(env);
    const provider = createWebhookModuleAiProvider(config, { env });
    const text = await provider.generateText({
      prompt: 'hello provider',
      model: 'local-text',
    });
    const embedding = await provider.embedText({
      text: 'hello provider',
      model: 'local-embedding',
    });
    return { config, text, embedding };
  });

  checks.push({
    id: 'ai-webhook-provider',
    ok:
      result.config.configured &&
      result.text.text === 'webhook-ai:hello provider' &&
      result.embedding.embedding.length === 3,
    durationMs: Date.now() - startedAt,
    detail: {
      mode: result.config.mode,
      textModel: result.text.model,
      embeddingModel: result.embedding.model,
      signed: result.config.webhookSecretConfigured,
    },
  });
} catch (error) {
  checks.push({
    id: 'ai-webhook-provider',
    ok: false,
    durationMs: Date.now() - startedAt,
    detail: {},
    error: error instanceof Error ? error.message : String(error),
  });
}

const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'ai-webhook-local',
  checkedAt.replace(/[:.]/g, '-')
);
const latestPath = path.resolve(process.cwd(), '.runtime', 'ai-webhook-local', 'latest.json');
const reportPath = path.join(outputDir, 'ai-webhook-local-smoke.json');
const report = {
  ok: checks.every((check) => check.ok),
  required: true,
  profile: 'local-ai-webhook',
  checkedAt,
  checks,
  artifacts: {
    report: reportPath,
    latest: latestPath,
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(latestPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
fs.copyFileSync(reportPath, latestPath);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ok ? 0 : 1;
