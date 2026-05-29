import { NextResponse } from 'next/server';
import { resolveHostSessionFromRequest } from '@host/lib/auth';
import { getHostUserFile, updateHostUserFileStatus } from '@host/lib/files';
import { languageFromRequest, localizedPath } from '@host/lib/i18n';
import { checkHostRouteSecurity } from '@host/lib/security';

function unauthorized() {
  return Response.json({ ok: false, code: 'AUTH_REQUIRED' }, { status: 401 });
}

function safeNext(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : null;
}

async function requireFileSession(request: Request) {
  const session = await resolveHostSessionFromRequest(request);
  const securityResponse = await checkHostRouteSecurity(request, 'files.item', { session });
  if (securityResponse) {
    return { response: securityResponse };
  }
  if (!session.user) {
    return { response: unauthorized() };
  }
  return { session };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const resolved = await requireFileSession(request);
  if ('response' in resolved) {
    return resolved.response;
  }
  const { fileId } = await params;
  const detail = await getHostUserFile(resolved.session, fileId);
  if (!detail) {
    return Response.json({ ok: false, code: 'FILE_NOT_FOUND' }, { status: 404 });
  }
  return Response.json({ ok: true, ...detail });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const resolved = await requireFileSession(request);
  if ('response' in resolved) {
    return resolved.response;
  }
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  const action = body?.action;
  if (
    action !== 'archive' &&
    action !== 'delete' &&
    action !== 'publish' &&
    action !== 'restore'
  ) {
    return Response.json({ ok: false, code: 'FILE_ACTION_UNSUPPORTED' }, { status: 400 });
  }
  const { fileId } = await params;
  return Response.json({
    ok: true,
    file: await updateHostUserFileStatus(resolved.session, fileId, action),
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const resolved = await requireFileSession(request);
  if ('response' in resolved) {
    return resolved.response;
  }
  const { fileId } = await params;
  return Response.json({
    ok: true,
    file: await updateHostUserFileStatus(resolved.session, fileId, 'delete'),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const resolved = await requireFileSession(request);
  if ('response' in resolved) {
    return resolved.response;
  }
  const form = await request.formData();
  const action = form.get('action');
  if (
    action !== 'archive' &&
    action !== 'delete' &&
    action !== 'publish' &&
    action !== 'restore'
  ) {
    return Response.json({ ok: false, code: 'FILE_ACTION_UNSUPPORTED' }, { status: 400 });
  }
  const { fileId } = await params;
  await updateHostUserFileStatus(resolved.session, fileId, action);
  const next = safeNext(form.get('next')) ?? localizedPath(languageFromRequest(request), '/dashboard/files');
  return NextResponse.redirect(new URL(next, request.url), 303);
}
