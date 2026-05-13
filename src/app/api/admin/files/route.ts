import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  applyFileRetentionPolicy,
  bulkDeleteFiles,
  uploadFile,
  getAllFiles,
  getGlobalStorageStats,
} from '@/lib/services/storage/file-storage-service';
import {
  withAdminGuard,
  withErrorHandling,
  withQueryValidation,
  type AuthContext,
} from '@/lib/middleware';
import { ValidationError } from '@/lib/_core/errors';
import { AUDIT_ACTIONS, auditLogDurable } from '@/lib/services/audit/audit-service';
import { getClientIP } from '@/lib/shared/api-helpers';

/**
 * POST /api/admin/files
 * Upload a new file
 *
 * @requires Authentication
 */
async function postHandler(request: NextRequest, context: { auth: AuthContext }) {
  const contentType = request.headers.get('content-type')?.toLowerCase() || '';
  if (!contentType.includes('multipart/form-data')) {
    throw new ValidationError('Unsupported content type. Use multipart/form-data.', {
      field: 'content-type',
      allowedContentTypes: ['multipart/form-data'],
    });
  }

  // Get form data
  const formData = await request.formData();
  const file = formData.get('file');
  const folder = formData.get('folder') as string | null;

  if (!(file instanceof File)) {
    throw new ValidationError('No file provided', { field: 'file' });
  }

  // Use authenticated user's ID directly
  const userId = context.auth.userId;

  // Convert File to Buffer
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Upload file
  const fileMetadata = await uploadFile({
    userId,
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

// Type assertion needed for Next.js 15+ route handler validation
export const POST = withAdminGuard(withErrorHandling(postHandler)) as unknown as (
  request: NextRequest
) => Promise<Response>;

/**
 * GET /api/admin/files
 * List files globally
 *
 * Query params:
 * - limit: number (default: 50)
 * - offset: number (default: 0)
 * - search: string (search term)
 * - owner: string (owner/user id or uploader email)
 * - mimeType: string (partial MIME type)
 * - minSize: number (bytes)
 * - maxSize: number (bytes)
 * - startDate: ISO date
 * - endDate: ISO date
 * - statsOnly: boolean (return only global storage stats)
 *
 * @requires Authentication
 */
const listFilesSchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().min(1).max(100).default(20),
    search: z.string().min(1).max(100).optional(),
    offset: z.coerce.number().int().nonnegative().default(0),
    statsOnly: z.coerce.boolean().default(false),
    owner: z.string().trim().min(1).max(255).optional(),
    folder: z.string().trim().min(1).max(255).optional(),
    provider: z.string().trim().min(1).max(50).optional(),
    mimeType: z.string().trim().min(1).max(100).optional(),
    minSize: z.coerce.number().int().nonnegative().optional(),
    maxSize: z.coerce.number().int().nonnegative().optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })
  .refine(
    (query) =>
      query.minSize === undefined || query.maxSize === undefined || query.minSize <= query.maxSize,
    {
      path: ['maxSize'],
      message: 'maxSize must be greater than or equal to minSize',
    }
  )
  .refine(
    (query) =>
      query.startDate === undefined ||
      query.endDate === undefined ||
      query.startDate <= query.endDate,
    {
      path: ['endDate'],
      message: 'endDate must be after startDate',
    }
  );

async function getHandler(
  request: NextRequest,
  context: { auth: AuthContext; validated: { query: Record<string, unknown> } }
) {
  const {
    limit,
    offset,
    search,
    statsOnly,
    owner,
    folder,
    provider,
    mimeType,
    minSize,
    maxSize,
    startDate,
    endDate,
  } = context.validated.query;

  // If stats only, return storage statistics
  if (statsOnly) {
    const stats = await getGlobalStorageStats();
    return NextResponse.json({
      success: true,
      stats,
    });
  }

  // List files
  const result = await getAllFiles({
    limit: limit as number | undefined,
    offset: offset as number | undefined,
    searchTerm: search as string | undefined,
    owner: owner as string | undefined,
    folder: folder as string | undefined,
    provider: provider as string | undefined,
    mimeType: mimeType as string | undefined,
    minSize: minSize as number | undefined,
    maxSize: maxSize as number | undefined,
    startDate: startDate as Date | undefined,
    endDate: endDate as Date | undefined,
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

// Type assertion needed for Next.js 15+ route handler validation
export const GET = withAdminGuard(
  withErrorHandling(withQueryValidation(listFilesSchema, getHandler))
) as unknown as (request: NextRequest) => Promise<Response>;

const bulkFilesSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('delete'),
    fileIds: z.array(z.string().min(1)).min(1).max(100),
  }),
  z.object({
    action: z.literal('retention'),
    retentionDays: z.number().int().min(1).max(3650),
    retentionAction: z.enum(['archive', 'delete']),
    limit: z.number().int().min(1).max(500).default(100),
    folder: z.string().trim().min(1).max(255).optional(),
    provider: z.string().trim().min(1).max(50).optional(),
  }),
]);

export const PATCH = withAdminGuard(
  withErrorHandling(async (request: NextRequest, context: { auth: AuthContext }) => {
    const body = bulkFilesSchema.parse(await request.json());

    if (body.action === 'delete') {
      const result = await bulkDeleteFiles(
        body.fileIds,
        context.auth.userId,
        context.auth.userEmail
      );
      await auditLogDurable({
        userId: context.auth.userId,
        userEmail: context.auth.userEmail,
        action: AUDIT_ACTIONS.FILE_BULK_DELETE,
        resource: 'file',
        status: 'success',
        ipAddress: getClientIP(request),
        metadata: { ...result },
      });

      return NextResponse.json({ success: true, ...result });
    }

    const result = await applyFileRetentionPolicy({
      retentionDays: body.retentionDays,
      action: body.retentionAction,
      limit: body.limit,
      folder: body.folder,
      provider: body.provider,
    });

    await auditLogDurable({
      userId: context.auth.userId,
      userEmail: context.auth.userEmail,
      action: AUDIT_ACTIONS.FILE_RETENTION_RUN,
      resource: 'file',
      status: 'success',
      ipAddress: getClientIP(request),
      metadata: {
        ...result,
        retentionDays: body.retentionDays,
        retentionAction: body.retentionAction,
        folder: body.folder,
        provider: body.provider,
      },
    });

    return NextResponse.json({ success: true, ...result });
  })
) as unknown as (request: NextRequest) => Promise<Response>;
