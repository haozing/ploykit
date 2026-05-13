import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getStorageStats,
  listFiles,
  uploadFile,
} from '@/lib/services/storage/file-storage-service';
import {
  withAuth,
  withErrorHandling,
  withQueryValidation,
  type AuthContext,
} from '@/lib/middleware';
import { createPaginatedListSchema } from '@/lib/validations/common';
import { ValidationError } from '@/lib/_core/errors';

async function postHandler(request: NextRequest, context: { auth: AuthContext }) {
  const contentType = request.headers.get('content-type')?.toLowerCase() || '';
  if (!contentType.includes('multipart/form-data')) {
    throw new ValidationError('Unsupported content type. Use multipart/form-data.', {
      field: 'content-type',
      allowedContentTypes: ['multipart/form-data'],
    });
  }

  const formData = await request.formData();
  const file = formData.get('file');
  const folder = formData.get('folder') as string | null;

  if (!(file instanceof File)) {
    throw new ValidationError('No file provided', { field: 'file' });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const fileMetadata = await uploadFile({
    userId: context.auth.userId,
    file: buffer,
    originalName: file.name,
    mimeType: file.type || 'application/octet-stream',
    uploadedBy: context.auth.userId,
    uploadedByEmail: context.auth.userEmail,
    folder: folder || undefined,
  });

  return NextResponse.json(
    {
      success: true,
      file: fileMetadata,
    },
    { status: 201 }
  );
}

export const POST = withAuth(withErrorHandling(postHandler)) as unknown as (
  request: NextRequest
) => Promise<Response>;

const listFilesSchema = createPaginatedListSchema({
  folder: z.string().optional(),
  offset: z.coerce.number().int().nonnegative().default(0),
  statsOnly: z.coerce.boolean().default(false),
});

async function getHandler(
  request: NextRequest,
  context: {
    auth: AuthContext;
    validated: { query: Record<string, unknown> };
  }
) {
  const { folder, limit, offset, search, statsOnly } = context.validated.query;
  const userId = context.auth.userId;

  if (statsOnly) {
    const stats = await getStorageStats(userId);
    return NextResponse.json({
      success: true,
      stats,
    });
  }

  const result = await listFiles({
    userId,
    folder: folder as string | undefined,
    limit: limit as number | undefined,
    offset: offset as number | undefined,
    searchTerm: search as string | undefined,
  });

  return NextResponse.json({
    success: true,
    files: result.files,
    pagination: {
      limit: limit as number,
      offset: offset as number,
      total: result.total,
      hasMore: (offset as number) + (limit as number) < result.total,
    },
  });
}

export const GET = withAuth(
  withErrorHandling(withQueryValidation(listFilesSchema, getHandler))
) as unknown as (request: NextRequest) => Promise<Response>;
