import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { FILE_LIMITS } from '@/lib/_core/constants';
import { ValidationError } from '@/lib/_core/errors';
import { requireUserContext } from '@/lib/db';
import { user } from '@/lib/db/schema';
import { withAuth, withErrorHandling, type AuthContext } from '@/lib/middleware';
import { uploadFile } from '@/lib/services/storage/file-storage-service';

const AVATAR_FOLDER = 'avatars';
const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

async function postAvatarHandler(request: NextRequest, context: { auth: AuthContext }) {
  const contentType = request.headers.get('content-type')?.toLowerCase() || '';
  if (!contentType.includes('multipart/form-data')) {
    throw new ValidationError('Unsupported content type. Use multipart/form-data.', {
      field: 'content-type',
      allowedContentTypes: ['multipart/form-data'],
    });
  }

  const formData = await request.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    throw new ValidationError('No avatar file provided', { field: 'file' });
  }

  if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
    throw new ValidationError('Avatar must be a JPEG, PNG, GIF, or WebP image.', {
      field: 'file',
      allowedContentTypes: Array.from(ALLOWED_AVATAR_TYPES),
    });
  }

  if (file.size > FILE_LIMITS.MAX_AVATAR_SIZE_BYTES) {
    throw new ValidationError('Avatar file is too large.', {
      field: 'file',
      maxBytes: FILE_LIMITS.MAX_AVATAR_SIZE_BYTES,
    });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const avatarFile = await uploadFile({
    userId: context.auth.userId,
    file: buffer,
    originalName: file.name || 'avatar.png',
    mimeType: file.type,
    uploadedBy: context.auth.userId,
    uploadedByEmail: context.auth.userEmail,
    folder: AVATAR_FOLDER,
  });

  const avatarUrl = `/api/files/${avatarFile.id}?download=true`;

  await requireUserContext(context.auth.userId, async (database) => {
    await database
      .update(user)
      .set({
        image: avatarUrl,
        updatedAt: new Date(),
      })
      .where(eq(user.id, context.auth.userId));
  });

  return NextResponse.json(
    {
      success: true,
      image: avatarUrl,
      file: avatarFile,
    },
    { status: 201 }
  );
}

export const POST = withAuth(withErrorHandling(postAvatarHandler)) as unknown as (
  request: NextRequest
) => Promise<Response>;
