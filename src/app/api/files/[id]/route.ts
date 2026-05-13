import { NextResponse } from 'next/server';
import { deleteFile, getFileById } from '@/lib/services/storage/file-storage-service';
import { getInitializedBlobStore } from '@/lib/services/storage/init.server';
import { sanitizeDownloadFileName } from '@/lib/services/storage/upload-policy';
import {
  withAuth,
  withErrorHandling,
  withParamsValidation,
  withValidation,
  type AuthContext,
} from '@/lib/middleware';
import { NotFoundError } from '@/lib/_core/errors';
import { fileDownloadQuerySchema, fileIdParamsSchema } from '@/lib/validations/file';

const getValidationSchemas = {
  params: fileIdParamsSchema,
  query: fileDownloadQuerySchema,
};

export const GET = withAuth(
  withErrorHandling(
    withValidation(getValidationSchemas, async (_request, context) => {
      const { auth, validated } = context as typeof context & { auth: AuthContext };
      const { id } = validated.params!;
      const { download } = validated.query || {};

      const file = await getFileById(id, auth.userId);

      if (!file) {
        throw new NotFoundError('File', id);
      }

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
      }

      return NextResponse.json(
        {
          success: true,
          file,
        },
        { status: 200 }
      );
    })
  )
);

export const DELETE = withAuth(
  withErrorHandling(
    withParamsValidation(fileIdParamsSchema, async (_request, context) => {
      const { auth, validated } = context as typeof context & { auth: AuthContext };
      const { id } = validated.params!;

      const file = await getFileById(id, auth.userId);

      if (!file) {
        throw new NotFoundError('File', id);
      }

      await deleteFile(id, auth.userId, auth.userId, auth.userEmail);

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
