import { requireAdminRequestContext } from '@host/lib/request-context';
import { checkHostRouteSecurity } from '@host/lib/security';
import { drainHostWorker, enqueueHostDemoJob } from '@host/lib/worker';

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return {};
  }
  const value = await request.json();
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export async function POST(request: Request) {
  const { session } = await requireAdminRequestContext(request, '/admin/runs');
  const securityResponse = await checkHostRouteSecurity(request, 'worker.enqueue', { session });
  if (securityResponse) {
    return securityResponse;
  }

  const url = new URL(request.url);
  const body = await readJsonObject(request);
  const run = await enqueueHostDemoJob(session, {
    moduleId: readString(body.moduleId),
    name: readString(body.name),
    input:
      body.input && typeof body.input === 'object' && !Array.isArray(body.input)
        ? (body.input as Record<string, unknown>)
        : undefined,
    content: readString(body.content),
    idempotencyKey: readString(body.idempotencyKey),
    scheduledAt: readString(body.scheduledAt),
    priority: readNumber(body.priority),
  });
  const drain = url.searchParams.get('drain') === '1' ? await drainHostWorker({ session }) : null;
  return Response.json({ ok: true, run, drain });
}
