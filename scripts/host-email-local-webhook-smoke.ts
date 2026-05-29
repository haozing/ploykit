import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const secret = `ploykit-local-email-${randomUUID()}`;
const providerRef = `email_local_${randomUUID()}`;
const to = 'local-webhook@example.com';

interface SmokeCheck {
  id: string;
  ok: boolean;
  detail?: unknown;
  error?: string;
}

interface WebhookRequestEvidence {
  ok: boolean;
  method?: string;
  path?: string;
  signatureValid: boolean;
  contentTypeValid: boolean;
  payloadValid: boolean;
  providerRef: string;
  payload?: Record<string, unknown>;
  error?: string;
}

interface ChildResult {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function signBody(body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function parseJsonFromOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  const objectStart = trimmed.indexOf('{');
  if (objectStart < 0) {
    return trimmed;
  }
  try {
    return JSON.parse(trimmed.slice(objectStart));
  } catch {
    return trimmed;
  }
}

function payloadIsValid(payload: Record<string, unknown>): boolean {
  const metadata = payload.metadata;
  return (
    payload.to === to &&
    typeof payload.from === 'string' &&
    payload.subject !== undefined &&
    typeof payload.subject === 'string' &&
    payload.subject.startsWith('PloyKit email smoke') &&
    payload.text === 'PloyKit host email provider smoke test.' &&
    metadata !== null &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).smoke === 'host-email'
  );
}

function runEmailSmoke(webhookUrl: string): Promise<ChildResult> {
  return new Promise((resolve) => {
    const child = spawn(npm, ['run', 'host:email-smoke', '--', '--required', '--to', to], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PLOYKIT_EMAIL_PROVIDER: 'webhook',
        PLOYKIT_EMAIL_WEBHOOK_URL: webhookUrl,
        PLOYKIT_EMAIL_WEBHOOK_SECRET: secret,
        PLOYKIT_EMAIL_FROM: 'PloyKit Local <no-reply@ploykit.local>',
      },
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, 15_000);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ status: 1, stdout, stderr: stderr || error.message, timedOut });
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, timedOut });
    });
  });
}

function webhookRequestTimeout(): Promise<WebhookRequestEvidence> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () =>
        resolve({
          ok: false,
          signatureValid: false,
          contentTypeValid: false,
          payloadValid: false,
          providerRef,
          error: 'webhook_request_timeout',
        }),
      16_000
    );
    timer.unref();
  });
}

let resolveRequest: (value: WebhookRequestEvidence) => void = () => {};
const requestEvidence = new Promise<WebhookRequestEvidence>((resolve) => {
  resolveRequest = resolve;
});

const server = createServer(async (request, response) => {
  const body = await readRequestBody(request);
  let payload: Record<string, unknown> = {};
  let parseError: string | undefined;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch (error) {
    parseError = error instanceof Error ? error.message : 'invalid_json';
  }

  const signatureHeader = request.headers['x-ploykit-email-signature'];
  const signature =
    typeof signatureHeader === 'string'
      ? signatureHeader
      : Array.isArray(signatureHeader)
        ? signatureHeader[0]
        : '';
  const methodValid = request.method === 'POST';
  const pathValid = request.url === '/email';
  const signatureValid = signature === signBody(body);
  const contentTypeValid = String(request.headers['content-type'] ?? '').includes('application/json');
  const payloadValid = !parseError && payloadIsValid(payload);
  const ok = methodValid && pathValid && signatureValid && contentTypeValid && payloadValid;

  response.statusCode = ok ? 202 : 400;
  response.setHeader('content-type', 'application/json');
  response.setHeader('x-ploykit-provider-ref', providerRef);
  response.end(JSON.stringify({ ok, providerRef }));

  resolveRequest({
    ok,
    method: request.method,
    path: request.url,
    signatureValid,
    contentTypeValid,
    payloadValid,
    providerRef,
    payload,
    error: parseError,
  });
});

await new Promise<void>((resolve) => {
  server.listen(0, '127.0.0.1', resolve);
});

const address = server.address() as AddressInfo;
const webhookUrl = `http://127.0.0.1:${address.port}/email`;
const child = await runEmailSmoke(webhookUrl);
const webhook = await Promise.race<WebhookRequestEvidence>([
  requestEvidence,
  webhookRequestTimeout(),
]);

await new Promise<void>((resolve) => {
  server.close(() => resolve());
});

const emailReport = parseJsonFromOutput(child.stdout);
const checks: SmokeCheck[] = [
  {
    id: 'local-webhook-listen',
    ok: address.address === '127.0.0.1' && address.port > 0,
    detail: { webhookUrl },
  },
  {
    id: 'email-required-smoke',
    ok:
      child.status === 0 &&
      !child.timedOut &&
      typeof emailReport === 'object' &&
      emailReport !== null &&
      (emailReport as { ok?: unknown }).ok === true,
    detail: emailReport,
    error: child.timedOut ? 'host:email-smoke timed out' : child.stderr.trim() || undefined,
  },
  {
    id: 'local-webhook-request',
    ok: webhook.ok,
    detail: webhook,
    error: webhook.error,
  },
];

const report = {
  ok: checks.every((check) => check.ok),
  profile: 'local-webhook',
  checkedAt: new Date().toISOString(),
  webhookUrl,
  checks,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ok ? 0 : 1;
