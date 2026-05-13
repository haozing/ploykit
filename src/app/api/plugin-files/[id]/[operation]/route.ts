import { createHash, randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client.server';
import { pluginFiles, type PluginFile } from '@/lib/db/schema/plugin-platform';
import { NotFoundError, ValidationError } from '@/lib/_core/errors';
import { withErrorHandling } from '@/lib/middleware';
import { getInitializedBlobStore } from '@/lib/services/storage/init.server';
import { sanitizeDownloadFileName } from '@/lib/services/storage/upload-policy';
import { auditLog, type AuditEventType } from '@/lib/audit/audit-port.server';
import { recordUsage } from '@/lib/usage/usage-ledger.server';
import {
  type PluginFileSignedOperation,
  verifyPluginFileSignedUrl,
} from '@/lib/plugin-runtime/files/plugin-file-signing.server';

interface RouteContext {
  params: Promise<{
    id: string;
    operation: string;
  }>;
}

type PluginFileRequestOperation = Extract<PluginFileSignedOperation, 'upload' | 'download'>;

function parseOperation(value: string): PluginFileRequestOperation {
  if (value === 'upload' || value === 'download') {
    return value;
  }

  throw new NotFoundError('Plugin file operation', value);
}

function assertMethodMatchesOperation(method: string, operation: PluginFileRequestOperation): void {
  const normalizedMethod = method.toUpperCase();

  if (operation === 'download' && normalizedMethod === 'GET') {
    return;
  }

  if (operation === 'upload' && (normalizedMethod === 'POST' || normalizedMethod === 'PUT')) {
    return;
  }

  throw new NotFoundError('Plugin file operation', `${normalizedMethod} ${operation}`);
}

async function getPluginFile(id: string): Promise<PluginFile> {
  const [file] = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_user_id', 'system', true)`);
    return tx
      .select()
      .from(pluginFiles)
      .where(and(eq(pluginFiles.id, id), isNull(pluginFiles.deletedAt)))
      .limit(1);
  });

  if (!file) {
    throw new NotFoundError('Plugin file', id);
  }

  return file;
}

function assertSignedRequest(
  request: NextRequest,
  file: PluginFile,
  operation: PluginFileRequestOperation
): void {
  const verification = verifyPluginFileSignedUrl({
    file,
    operation,
    expires: request.nextUrl.searchParams.get('expires'),
    signature: request.nextUrl.searchParams.get('signature'),
  });

  if (!verification.ok) {
    throw new ValidationError('Plugin file signed URL is invalid or expired.', {
      reason: verification.reason,
      fileId: file.id,
      operation,
    });
  }
}

async function markUploaded(
  file: PluginFile,
  input: {
    size: number;
    hash: string;
    contentType: string;
  }
): Promise<PluginFile> {
  const [updated] = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_user_id', 'system', true)`);
    return tx
      .update(pluginFiles)
      .set({
        size: input.size,
        hash: input.hash,
        contentType: input.contentType,
        status: 'ready',
        uploadedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(pluginFiles.id, file.id),
          eq(pluginFiles.status, 'pending_upload'),
          isNull(pluginFiles.deletedAt)
        )
      )
      .returning();
  });

  if (!updated) {
    throw new ValidationError('Plugin file is not waiting for upload.', {
      fileId: file.id,
      status: file.status,
    });
  }

  return updated;
}

function hashBuffer(buffer: Buffer): string {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

async function auditPluginFile(
  type: AuditEventType,
  action: string,
  file: PluginFile,
  details?: Record<string, unknown>
) {
  await auditLog(type, action, {
    actorId: file.ownerUserId,
    actorType: 'user',
    targetId: file.id,
    targetType: 'plugin_file',
    details: {
      pluginId: file.pluginId,
      scopeType: file.scopeType,
      scopeId: file.scopeId,
      runId: file.runId,
      fileName: file.fileName,
      size: file.size,
      ...details,
    },
  });
}

async function recordPluginFileUsage(
  file: PluginFile,
  input: { action: string; amount: number; unit: string }
) {
  await recordUsage('storage', input.amount, input.unit, {
    userId: file.ownerUserId,
    idempotencyKey: `plugin-file:${file.id}:${input.action}:${randomUUID()}`,
    metadata: {
      pluginId: file.pluginId,
      fileId: file.id,
      scopeType: file.scopeType,
      scopeId: file.scopeId,
      runId: file.runId,
      action: input.action,
    },
  });
}

async function uploadPluginFile(request: NextRequest, file: PluginFile): Promise<Response> {
  if (file.status !== 'pending_upload') {
    throw new ValidationError('Plugin file is not waiting for upload.', {
      fileId: file.id,
      status: file.status,
    });
  }

  const buffer = Buffer.from(await request.arrayBuffer());
  if (buffer.length !== file.size) {
    throw new ValidationError('Uploaded body size does not match the declared file size.', {
      fileId: file.id,
      declaredSize: file.size,
      actualSize: buffer.length,
    });
  }

  const contentType =
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ||
    file.contentType ||
    'application/octet-stream';

  await getInitializedBlobStore().put({
    key: file.storageKey,
    body: buffer,
    contentType,
  });

  const updated = await markUploaded(file, {
    size: buffer.length,
    hash: hashBuffer(buffer),
    contentType,
  });

  await auditPluginFile('file.uploaded', `${updated.pluginId}.files.signedUpload`, updated);
  await recordPluginFileUsage(updated, {
    action: 'upload',
    amount: buffer.length,
    unit: 'byte',
  });

  return NextResponse.json({
    success: true,
    file: {
      id: updated.id,
      status: updated.status,
      size: updated.size,
      hash: updated.hash,
      contentType: updated.contentType,
      uploadedAt: updated.uploadedAt,
    },
  });
}

async function downloadPluginFile(file: PluginFile): Promise<Response> {
  if (file.status !== 'ready') {
    throw new NotFoundError('Ready plugin file', file.id);
  }

  const blob = await getInitializedBlobStore().get(file.storageKey);
  const body = Buffer.isBuffer(blob.body) ? new Uint8Array(blob.body) : blob.body;
  const size = blob.size ?? file.size;

  await auditPluginFile('file.downloaded', `${file.pluginId}.files.signedDownload`, file, {
    size,
  });
  await recordPluginFileUsage(file, {
    action: 'download',
    amount: 1,
    unit: 'count',
  });

  return new NextResponse(body, {
    headers: {
      'Content-Type': blob.contentType || file.contentType,
      'Content-Disposition': `attachment; filename="${sanitizeDownloadFileName(file.fileName)}"`,
      'Content-Length': String(size),
      'Cache-Control': 'private, max-age=0, no-store',
    },
  });
}

async function handlePluginFile(
  request: NextRequest,
  context: RouteContext,
  expectedOperation: PluginFileRequestOperation
): Promise<Response> {
  const { id, operation: rawOperation } = await context.params;
  const operation = parseOperation(rawOperation);
  assertMethodMatchesOperation(request.method, operation);
  if (operation !== expectedOperation) {
    throw new NotFoundError('Plugin file operation', `${request.method} ${operation}`);
  }
  const file = await getPluginFile(id);

  assertSignedRequest(request, file, operation);

  if (operation === 'upload') {
    return uploadPluginFile(request, file);
  }

  return downloadPluginFile(file);
}

export const PUT = withErrorHandling((request: NextRequest, context: RouteContext) =>
  handlePluginFile(request, context, 'upload')
);

export const POST = withErrorHandling((request: NextRequest, context: RouteContext) =>
  handlePluginFile(request, context, 'upload')
);

export const GET = withErrorHandling((request: NextRequest, context: RouteContext) =>
  handlePluginFile(request, context, 'download')
);
