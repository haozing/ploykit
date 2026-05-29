import { NextResponse } from 'next/server';
import { resolveHostSessionFromRequest } from '@host/lib/auth';
import { listHostUserFiles, uploadHostUserFile } from '@host/lib/files';
import { checkHostRouteSecurity } from '@host/lib/security';
import type { ModuleFilePurpose } from '@ploykit/module-sdk';
import type { RuntimeStoreFileRecord } from '@/lib/module-runtime';

function unauthorized() {
  return Response.json({ ok: false, code: 'AUTH_REQUIRED' }, { status: 401 });
}

function safeNext(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : null;
}

export async function GET(request: Request) {
  const session = await resolveHostSessionFromRequest(request);
  const securityResponse = await checkHostRouteSecurity(request, 'files.collection', { session });
  if (securityResponse) {
    return securityResponse;
  }

  if (!session.user) {
    return unauthorized();
  }
  const url = new URL(request.url);
  return Response.json({
    ok: true,
    files: await listHostUserFiles(session, {
      q: url.searchParams.get('q') ?? undefined,
      moduleId: url.searchParams.get('moduleId') ?? undefined,
      purpose: (url.searchParams.get('purpose') ?? undefined) as ModuleFilePurpose | undefined,
      status: (url.searchParams.get('status') ?? undefined) as
        | RuntimeStoreFileRecord['status']
        | undefined,
    }),
  });
}

export async function POST(request: Request) {
  const session = await resolveHostSessionFromRequest(request);
  const securityResponse = await checkHostRouteSecurity(request, 'files.collection', { session });
  if (securityResponse) {
    return securityResponse;
  }

  if (!session.user) {
    return unauthorized();
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof Blob)) {
    return Response.json({ ok: false, code: 'FILE_REQUIRED' }, { status: 400 });
  }

  let uploaded;
  try {
    uploaded = await uploadHostUserFile(session, {
      moduleId: typeof form.get('moduleId') === 'string' ? String(form.get('moduleId')) : undefined,
      name: 'name' in file && typeof file.name === 'string' ? file.name : 'upload.bin',
      purpose: typeof form.get('purpose') === 'string'
        ? (String(form.get('purpose')) as ModuleFilePurpose)
        : undefined,
      contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      content: await file.arrayBuffer(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('QUOTA')) {
      return Response.json({ ok: false, code: 'FILE_QUOTA_EXCEEDED', message }, { status: 413 });
    }
    throw error;
  }
  const next = safeNext(form.get('next'));
  if (next) {
    return NextResponse.redirect(new URL(next, request.url), 303);
  }
  return Response.json({ ok: true, ...uploaded });
}
