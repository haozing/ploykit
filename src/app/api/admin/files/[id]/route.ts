/**
 * /api/admin/files/[id]
 *
 * File detail management endpoints
 *
 * P1 SECURITY ENDPOINT
 * Full validation with type safety
 * Protected with admin guard
 * User-level file access control
 */

import { NextResponse } from 'next/server';
import { getFileById, deleteFile } from '@/lib/services/storage/file-storage-service';
import { getInitializedBlobStore } from '@/lib/services/storage/init.server';
import { sanitizeDownloadFileName } from '@/lib/services/storage/upload-policy';
import {
  withAdminGuard,
  withErrorHandling,
  withParamsValidation,
  withValidation,
  type AuthContext,
} from '@/lib/middleware';
import { fileIdParamsSchema, fileDownloadQuerySchema } from '@/lib/validations/file';
import { NotFoundError } from '@/lib/_core/errors';

/**
 * GET /api/admin/files/[id]
 * Download a file or get file metadata
 */
const getValidationSchemas = {
  params: fileIdParamsSchema,
  query: fileDownloadQuerySchema,
};

export const GET = withAdminGuard(
  withErrorHandling(
    withValidation(getValidationSchemas, async (request, context) => {
      const { validated } = context as typeof context & { auth: AuthContext };
      const { id } = validated.params!;
      const { download } = validated.query || {};

      // Get file metadata
      const file = await getFileById(id);

      if (!file) {
        throw new NotFoundError('File', id);
      }

      // Admin guard already verified admin status, so we have full access
      if (download === 'true') {
        const blobStore = getInitializedBlobStore();
        const blob = await blobStore.get(file.path);
        const body = Buffer.isBuffer(blob.body) ? new Uint8Array(blob.body) : blob.body;

        return new NextResponse(body, {
          headers: {
            'Content-Type': blob.contentType || file.mimeType,
            'Content-Disposition': `attachment; filename="${sanitizeDownloadFileName(
              file.originalName
            )}"`,
            'Content-Length': String(blob.size ?? file.size),
          },
        });
      } else {
        // Return file metadata
        return NextResponse.json(
          {
            success: true,
            file,
          },
          { status: 200 }
        );
      }
    })
  )
);

/**
 * DELETE /api/admin/files/[id]
 * Delete a file
 */
export const DELETE = withAdminGuard(
  withErrorHandling(
    withParamsValidation(fileIdParamsSchema, async (request, context) => {
      const { validated, auth } = context as typeof context & { auth: AuthContext };
      const { id } = validated.params!;

      const currentUserId = auth.userId;
      const currentUserEmail = auth.userEmail;

      // Get file to check ownership
      const file = await getFileById(id);

      if (!file) {
        throw new NotFoundError('File', id);
      }

      // Admin guard already verified admin status, so we can delete
      // Delete file (service will verify ownership again)
      await deleteFile(id, file.userId, currentUserId, currentUserEmail);

      return NextResponse.json(
        {
          success: true,
          message: 'File deleted successfully',
        },
        { status: 200 }
      );
    })
  )
);
