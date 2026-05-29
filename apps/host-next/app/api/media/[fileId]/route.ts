import { resolveHostSessionFromRequest } from '@host/lib/auth';
import { getHostRuntime } from '@host/lib/create-host';
import { checkHostRouteSecurity } from '@host/lib/security';
import type { ModuleFileStorageRange } from '@/lib/module-capabilities/files';

function toResponseBody(body: Uint8Array | undefined): BodyInit | null {
  if (!body) {
    return null;
  }
  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  return copy.buffer;
}

function parseRange(header: string | null): ModuleFileStorageRange | undefined {
  if (!header) {
    return undefined;
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!match) {
    return undefined;
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : undefined;
  if (!Number.isFinite(start) || start < 0 || (end !== undefined && end < start)) {
    return undefined;
  }
  return { start, end };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params;
  const url = new URL(request.url);
  const session = await resolveHostSessionFromRequest(request);
  const securityResponse = await checkHostRouteSecurity(request, 'media.file', { session });
  if (securityResponse) {
    return securityResponse;
  }
  const hostRuntime = await getHostRuntime();
  const files = hostRuntime.createFileRuntime(session);
  const file = await hostRuntime.runtimeStore.store.getFile(fileId);
  let token = url.searchParams.get('token') ?? undefined;
  if (
    file &&
    !token &&
    (session.user?.role === 'admin' || file.ownerId === session.userId || file.ownerId === session.user?.id)
  ) {
    token = new URL(files.mediaGateway.createUrl(file), 'http://localhost').searchParams.get('token') ?? undefined;
  }
  const result = await files.mediaGateway.resolve({
    fileId,
    token,
    range: parseRange(request.headers.get('range')),
    disposition: url.searchParams.get('download') === '1' ? 'attachment' : 'inline',
  });
  if (file) {
    await hostRuntime.runtimeStore.store.recordAudit({
      productId: file.productId,
      workspaceId: file.workspaceId,
      moduleId: file.moduleId,
      actorId: session.actorId ?? session.userId ?? session.user?.id,
      type: 'host.file.accessed',
      metadata: {
        fileId,
        status: result.status,
        disposition: url.searchParams.get('download') === '1' ? 'attachment' : 'inline',
        range: request.headers.get('range') ?? undefined,
      },
    });
  }

  return new Response(toResponseBody(result.body), {
    status: result.status,
    headers: result.headers,
  });
}
