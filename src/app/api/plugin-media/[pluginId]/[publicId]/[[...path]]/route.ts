import { NextResponse } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client.server';
import { pluginFiles, type PluginFile } from '@/lib/db/schema/plugin-platform';
import { NotFoundError } from '@/lib/_core/errors';
import { withErrorHandling } from '@/lib/middleware';
import { getInitializedBlobStore } from '@/lib/services/storage/init.server';
import { sanitizeDownloadFileName } from '@/lib/services/storage/upload-policy';

interface RouteContext {
  params: Promise<{
    pluginId: string;
    publicId: string;
    path?: string[];
  }>;
}

async function getPublicPluginFile(pluginId: string, publicId: string): Promise<PluginFile> {
  const [file] = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_user_id', 'system', true)`);
    await tx.execute(sql`SELECT set_config('app.current_plugin_id', ${pluginId}, true)`);
    return tx
      .select()
      .from(pluginFiles)
      .where(
        and(
          eq(pluginFiles.pluginId, pluginId),
          eq(pluginFiles.publicId, publicId),
          eq(pluginFiles.visibility, 'public'),
          eq(pluginFiles.status, 'ready'),
          isNull(pluginFiles.deletedAt)
        )
      )
      .limit(1);
  });

  if (!file) {
    throw new NotFoundError('Plugin media', `${pluginId}/${publicId}`);
  }

  return file;
}

function contentDisposition(file: PluginFile): string {
  const disposition = file.contentDisposition === 'attachment' ? 'attachment' : 'inline';
  const fileName = sanitizeDownloadFileName(file.publicFileName || file.fileName);
  return `${disposition}; filename="${fileName}"`;
}

async function handlePublicPluginMedia(
  _request: Request,
  context: RouteContext
): Promise<Response> {
  const { pluginId, publicId } = await context.params;
  const file = await getPublicPluginFile(pluginId, publicId);
  const blob = await getInitializedBlobStore().get(file.storageKey);
  const body = Buffer.isBuffer(blob.body) ? new Uint8Array(blob.body) : blob.body;
  const size = blob.size ?? file.size;

  return new NextResponse(body, {
    headers: {
      'Content-Type': blob.contentType || file.contentType,
      'Content-Disposition': contentDisposition(file),
      'Content-Length': String(size),
      'Cache-Control': file.publicCacheControl || 'public, max-age=3600',
    },
  });
}

export const GET = withErrorHandling(handlePublicPluginMedia);
