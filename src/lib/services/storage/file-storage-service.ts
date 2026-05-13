/**
 * File Storage Service (user-Level)
 *
 *
 * Features:
 * - user-level file upload and management
 * - Storage quota checking per user
 * - File metadata management (user-scoped)
 * - Storage cleanup utilities
 * - File listing and search (user-scoped)
 */

import { requireUserContext, withSystemContext } from '@/lib/db';
import { files, type File, type FileRetentionAction } from '@/lib/db/schema';
import { eq, and, like, desc, asc, sql, or, gte, lte, inArray, type SQL } from 'drizzle-orm';
import { logger } from '@/lib/_core/logger';
import { NotFoundError, ValidationError } from '@/lib/_core/errors';
import { nanoid } from 'nanoid';
import { getInitializedBlobStore } from './init.server';
import { getBlobStoreDriver } from './blob-store';
import { sanitizeFolder, validateUploadPolicy } from './upload-policy';
import {
  getUserEntitlement,
  readEffectivePlanLimits,
  setMetric,
} from '@/lib/services/user/user-entitlement-service';
import { AUDIT_ACTIONS, auditLogDurable } from '@/lib/services/audit/audit-service';

// ?
// Types and Interfaces
// ?

/**
 * File metadata (user-owned)
 */
export interface FileMetadata {
  id: string;
  userId: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedByEmail: string;
  path: string;
  folder?: string | null;
  url?: string;
  provider: string;
  retentionAction: FileRetentionAction;
  retentionUntil?: Date | null;
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Upload file options
 */
export interface UploadFileOptions {
  userId: string;
  file: Buffer;
  originalName: string;
  mimeType: string;
  uploadedBy: string;
  uploadedByEmail: string;
  folder?: string;
}

/**
 * List files options
 */
export interface ListFilesOptions {
  userId: string;
  folder?: string;
  limit?: number;
  offset?: number;
  searchTerm?: string;
}

export interface AdminListFilesOptions {
  limit?: number;
  offset?: number;
  searchTerm?: string;
  owner?: string;
  folder?: string;
  provider?: string;
  mimeType?: string;
  minSize?: number;
  maxSize?: number;
  startDate?: Date;
  endDate?: Date;
}

/**
 * Storage statistics
 */
export interface StorageStats {
  totalFiles: number;
  totalSize: number;
  totalSizeMB: number;
  filesByType: Array<{
    mimeType: string;
    count: number;
    size: number;
  }>;
}

export interface PendingFileDeleteCleanupResult {
  scanned: number;
  deleted: number;
  failed: number;
  reclaimedBytes: number;
}

export interface BulkFileOperationResult {
  requested: number;
  affected: number;
  failed: number;
  reclaimedBytes?: number;
}

export interface UserStoragePolicy {
  quotaBytes: number;
  maxFileSizeBytes: number;
  source: 'default' | 'entitlement';
}

// ?
// Constants
// ?

/**
 * Default storage quota per user (in bytes)
 * 5GB = 5 * 1024 * 1024 * 1024 bytes
 */
const DEFAULT_USER_STORAGE_QUOTA = 5 * 1024 * 1024 * 1024;

/**
 * Maximum file size (in bytes)
 * 100MB = 100 * 1024 * 1024 bytes
 */
const MAX_FILE_SIZE = 100 * 1024 * 1024;

const FILE_DELETE_CLEANUP_BATCH_SIZE = 50;
const FILE_DELETE_ERROR_MAX_LENGTH = 1000;
const BYTES_PER_MB = 1024 * 1024;

// ?
// Core Functions
// ?

/**
 * Upload a file
 *
 *
 * @param options Upload options
 * @returns File metadata
 * @throws {ValidationError} If file is too large or quota exceeded
 */
export async function uploadFile(options: UploadFileOptions): Promise<FileMetadata> {
  const { userId, file, originalName, mimeType, uploadedBy, uploadedByEmail, folder } = options;
  const storagePolicy = await getUserStoragePolicy(userId);

  const uploadPolicy = validateUploadPolicy({
    file,
    originalName,
    mimeType,
    folder,
    maxFileSizeBytes:
      storagePolicy.maxFileSizeBytes === -1
        ? Number.MAX_SAFE_INTEGER
        : storagePolicy.maxFileSizeBytes,
  });

  // Check user storage quota
  const stats = await getStorageStats(userId);
  const projectedStorageBytes = stats.totalSize + file.length;
  if (storagePolicy.quotaBytes !== -1 && projectedStorageBytes > storagePolicy.quotaBytes) {
    const quotaMB = storagePolicy.quotaBytes / BYTES_PER_MB;
    const usedMB = stats.totalSizeMB;
    throw new ValidationError(
      `Storage quota exceeded. You have used ${usedMB.toFixed(2)}MB of ${quotaMB}MB`
    );
  }

  // Generate unique file ID and name
  const fileId = nanoid();
  const fileName = `${fileId}-${uploadPolicy.safeOriginalName}`;
  const filePath = uploadPolicy.safeFolder ? `${uploadPolicy.safeFolder}/${fileName}` : fileName;

  // 1. Write blob store first
  let blobResult;
  try {
    const blobStore = getInitializedBlobStore();
    blobResult = await blobStore.put({
      key: filePath,
      body: file,
      contentType: uploadPolicy.contentType,
    });
    logger.info({ userId, fileName, size: file.length }, 'Blob stored successfully');
  } catch (blobError) {
    logger.error({ userId, fileName, error: blobError }, 'Blob store failed');
    throw new ValidationError('Failed to store file. Please try again.');
  }

  // 2. Insert file metadata
  let insertedFile;
  try {
    insertedFile = await requireUserContext(userId, async (database) => {
      const [row] = await database
        .insert(files)
        .values({
          id: fileId,
          userId,
          fileName,
          originalName: uploadPolicy.safeOriginalName,
          mimeType: uploadPolicy.contentType,
          size: file.length,
          uploadedBy,
          uploadedByEmail,
          path: filePath,
          folder: uploadPolicy.safeFolder ?? null,
          provider: getBlobStoreDriver() || 'local',
        })
        .returning();

      return row;
    });
  } catch (dbError) {
    // 3. Compensate: delete blob if DB write fails
    logger.error(
      { userId, fileName, error: dbError },
      'DB metadata insert failed, compensating blob delete'
    );
    try {
      const blobStore = getInitializedBlobStore();
      await blobStore.delete(filePath);
    } catch (compensateError) {
      logger.error({ filePath, error: compensateError }, 'Blob compensation delete failed');
    }
    throw new ValidationError('Failed to save file metadata. Please try again.');
  }

  logger.info(
    { fileId, userId, fileName, blobSize: blobResult.size },
    'File uploaded successfully'
  );

  await syncStorageUsageMetric(userId, projectedStorageBytes);
  await auditFileUploaded(toFileMetadata(insertedFile), uploadedBy, uploadedByEmail);

  return toFileMetadata(insertedFile);
}

/**
 * List files for a user
 *
 *
 * @param options List options
 * @returns Files list with pagination info
 */
export async function listFiles(options: ListFilesOptions): Promise<{
  files: FileMetadata[];
  total: number;
  totalSize: number;
}> {
  const { userId, folder, limit = 50, offset = 0, searchTerm } = options;
  const safeFolder = sanitizeFolder(folder);

  // Build query conditions
  const conditions = [eq(files.userId, userId), eq(files.deleteStatus, 'active')];

  if (safeFolder) {
    conditions.push(eq(files.folder, safeFolder));
  }

  if (searchTerm) {
    conditions.push(like(files.originalName, `%${searchTerm}%`));
  }

  // Execute query
  const filesList = await requireUserContext(userId, async (database) => {
    return await database.query.files.findMany({
      where: and(...conditions),
      limit,
      offset,
      orderBy: [desc(files.createdAt)],
    });
  });

  // Get total count
  const [{ count }] = await requireUserContext(userId, async (database) => {
    return await database
      .select({ count: sql<number>`count(*)` })
      .from(files)
      .where(and(...conditions));
  });

  // Get total size
  const [{ totalSize }] = await requireUserContext(userId, async (database) => {
    return await database
      .select({ totalSize: sql<number>`coalesce(sum(${files.size}), 0)` })
      .from(files)
      .where(and(...conditions));
  });

  return {
    files: filesList.map(toFileMetadata),
    total: Number(count),
    totalSize: Number(totalSize),
  };
}

/**
 * Get file by ID
 *
 * @param fileId File ID
 * @param userId Optional user ID for ownership check
 * @returns File metadata or null if not found
 */
export async function getFileById(fileId: string, userId?: string): Promise<FileMetadata | null> {
  const conditions = [eq(files.id, fileId), eq(files.deleteStatus, 'active')];

  if (userId) {
    conditions.push(eq(files.userId, userId));
  }

  const file = userId
    ? await requireUserContext(userId, async (database) => {
        return await database.query.files.findFirst({
          where: and(...conditions),
        });
      })
    : await withSystemContext(async (database) => {
        return await database.query.files.findFirst({
          where: and(...conditions),
        });
      });

  return file ? toFileMetadata(file) : null;
}

/**
 * Delete a file
 *
 *
 * @param fileId File ID
 * @param userId user ID (for ownership verification)
 * @param deletedBy user ID of who is deleting
 * @param deletedByEmail Email of who is deleting
 * @throws {NotFoundError} If file not found or user doesn't own it
 */
export async function deleteFile(
  fileId: string,
  userId: string,
  deletedBy: string,
  deletedByEmail: string
): Promise<void> {
  const file = await markFilePendingDelete(fileId, userId);

  if (!file) {
    throw new NotFoundError('File not found or you do not have permission to delete it');
  }

  const result = await deletePendingFileStorageAndMetadata(file, 'user_request');

  if (result.deleted) {
    await syncStorageUsageMetric(userId);
    await auditFileDeleted(file, deletedBy, deletedByEmail);
    logger.info({ fileId, userId, deletedBy, deletedByEmail }, 'File deleted successfully');
    return;
  }

  logger.warn(
    { fileId, userId, deletedBy, deletedByEmail, error: result.error },
    'File delete queued for cleanup retry'
  );
}

export async function cleanupPendingFileDeletes(
  options: {
    limit?: number;
    userId?: string;
  } = {}
): Promise<PendingFileDeleteCleanupResult> {
  const limit = Math.max(1, Math.min(options.limit ?? FILE_DELETE_CLEANUP_BATCH_SIZE, 500));
  const conditions = [eq(files.deleteStatus, 'pending_delete')];

  if (options.userId) {
    conditions.push(eq(files.userId, options.userId));
  }

  const pendingFiles = await withSystemContext(async (database) => {
    return await database.query.files.findMany({
      where: and(...conditions),
      limit,
      orderBy: [asc(files.deleteRequestedAt), asc(files.createdAt)],
    });
  });

  let deleted = 0;
  let failed = 0;
  let reclaimedBytes = 0;

  for (const file of pendingFiles) {
    const result = await deletePendingFileStorageAndMetadata(file, 'cleanup');
    if (result.deleted) {
      deleted += 1;
      reclaimedBytes += file.size;
    } else {
      failed += 1;
    }
  }

  logger.info(
    {
      scanned: pendingFiles.length,
      deleted,
      failed,
      reclaimedMB: reclaimedBytes / 1024 / 1024,
    },
    'Pending file delete cleanup completed'
  );

  return {
    scanned: pendingFiles.length,
    deleted,
    failed,
    reclaimedBytes,
  };
}

export async function bulkDeleteFiles(
  fileIds: string[],
  deletedBy: string,
  deletedByEmail: string
): Promise<BulkFileOperationResult> {
  if (fileIds.length === 0) {
    return { requested: 0, affected: 0, failed: 0, reclaimedBytes: 0 };
  }

  const now = new Date();
  const pendingFiles = await withSystemContext(async (database) => {
    return database
      .update(files)
      .set({
        deleteStatus: 'pending_delete',
        deleteRequestedAt: now,
        deleteLastError: null,
        updatedAt: now,
      })
      .where(and(inArray(files.id, fileIds), eq(files.deleteStatus, 'active')))
      .returning();
  });

  let deleted = 0;
  let reclaimedBytes = 0;

  for (const file of pendingFiles) {
    const result = await deletePendingFileStorageAndMetadata(file, 'user_request');
    if (result.deleted) {
      deleted += 1;
      reclaimedBytes += file.size;
      await auditFileDeleted(file, deletedBy, deletedByEmail);
    }
  }

  return {
    requested: fileIds.length,
    affected: deleted,
    failed: fileIds.length - deleted,
    reclaimedBytes,
  };
}

export async function applyFileRetentionPolicy(options: {
  retentionDays: number;
  action: Exclude<FileRetentionAction, 'none'>;
  limit?: number;
  folder?: string;
  provider?: string;
}): Promise<BulkFileOperationResult> {
  const cutoff = new Date(Date.now() - options.retentionDays * 24 * 60 * 60 * 1000);
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const conditions: SQL[] = [
    eq(files.deleteStatus, 'active'),
    lte(files.createdAt, cutoff),
    or(sql`${files.retentionUntil} IS NULL`, lte(files.retentionUntil, new Date()))!,
  ];

  if (options.folder) {
    conditions.push(eq(files.folder, sanitizeFolder(options.folder) || options.folder));
  }

  if (options.provider) {
    conditions.push(eq(files.provider, options.provider));
  }

  const candidates = await withSystemContext(async (database) => {
    return database.query.files.findMany({
      where: and(...conditions),
      orderBy: [asc(files.createdAt)],
      limit,
    });
  });

  if (candidates.length === 0) {
    return {
      requested: 0,
      affected: 0,
      failed: 0,
      reclaimedBytes: 0,
    };
  }

  if (options.action === 'archive') {
    const now = new Date();
    await withSystemContext(async (database) => {
      await database
        .update(files)
        .set({
          retentionAction: 'archive',
          archivedAt: now,
          updatedAt: now,
        })
        .where(
          inArray(
            files.id,
            candidates.map((file) => file.id)
          )
        );
    });

    return {
      requested: candidates.length,
      affected: candidates.length,
      failed: 0,
    };
  }

  return bulkDeleteFiles(
    candidates.map((file) => file.id),
    'system',
    'system@ploykit.local'
  );
}

/**
 * Get storage statistics for a user
 *
 *
 * @param userId user ID
 * @returns Storage statistics
 */
export async function getStorageStats(userId: string): Promise<StorageStats> {
  // Total files and size
  const [stats] = await requireUserContext(userId, async (database) => {
    return await database
      .select({
        totalFiles: sql<number>`count(*)`,
        totalSize: sql<number>`coalesce(sum(${files.size}), 0)`,
      })
      .from(files)
      .where(and(eq(files.userId, userId), eq(files.deleteStatus, 'active')));
  });

  // Files by type
  const filesByType = await requireUserContext(userId, async (database) => {
    return await database
      .select({
        mimeType: files.mimeType,
        count: sql<number>`count(*)`,
        size: sql<number>`sum(${files.size})`,
      })
      .from(files)
      .where(and(eq(files.userId, userId), eq(files.deleteStatus, 'active')))
      .groupBy(files.mimeType);
  });

  return {
    totalFiles: Number(stats.totalFiles),
    totalSize: Number(stats.totalSize),
    totalSizeMB: Number(stats.totalSize) / 1024 / 1024,
    filesByType: filesByType.map((item) => ({
      mimeType: item.mimeType,
      count: Number(item.count),
      size: Number(item.size),
    })),
  };
}

/**
 * Clean up orphaned files for a user
 *
 *
 * Removes files that:
 * - Are older than 90 days and not accessed
 * - Belong to deleted users (already handled by CASCADE)
 *
 * @param userId user ID
 * @returns Cleanup statistics
 */
export async function cleanupOrphanedFiles(userId: string): Promise<{
  cleaned: number;
  reclaimedMB: number;
}> {
  // Find old files (older than 90 days)
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const oldFiles = await requireUserContext(userId, async (database) => {
    return await database.query.files.findMany({
      where: and(
        eq(files.userId, userId),
        eq(files.deleteStatus, 'active'),
        sql`${files.createdAt} < ${ninetyDaysAgo}`
      ),
    });
  });

  if (oldFiles.length === 0) {
    return { cleaned: 0, reclaimedMB: 0 };
  }

  const now = new Date();

  // Queue files first, then let the same pending-delete path clean blobs and metadata.
  await requireUserContext(userId, async (database) => {
    await database
      .update(files)
      .set({
        deleteStatus: 'pending_delete',
        deleteRequestedAt: now,
        deleteLastError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(files.userId, userId),
          eq(files.deleteStatus, 'active'),
          sql`${files.createdAt} < ${ninetyDaysAgo}`
        )
      );
  });

  const cleanup = await cleanupPendingFileDeletes({
    userId,
    limit: oldFiles.length,
  });

  logger.info(
    {
      userId,
      cleaned: cleanup.deleted,
      failed: cleanup.failed,
      reclaimedMB: cleanup.reclaimedBytes / 1024 / 1024,
    },
    'Cleaned up orphaned files'
  );

  return {
    cleaned: cleanup.deleted,
    reclaimedMB: cleanup.reclaimedBytes / 1024 / 1024,
  };
}

/**
 * Get file download path/URL
 *
 * @param file File metadata
 * @returns File path or URL
 */
export function getFilePath(file: FileMetadata): string {
  return `/api/files/${file.id}?download=true`;
}

export async function getUserStoragePolicy(userId: string): Promise<UserStoragePolicy> {
  const entitlement = await getUserEntitlement(userId);

  if (!entitlement) {
    return {
      quotaBytes: DEFAULT_USER_STORAGE_QUOTA,
      maxFileSizeBytes: MAX_FILE_SIZE,
      source: 'default',
    };
  }

  const limits = readEffectivePlanLimits(entitlement.plan.limits, entitlement.billingInterval);

  return {
    quotaBytes: resolveStorageLimitBytes(
      limits,
      [],
      ['platform.storageBytes'],
      DEFAULT_USER_STORAGE_QUOTA
    ),
    maxFileSizeBytes: resolveStorageLimitBytes(
      limits,
      [],
      ['platform.maxFileSizeBytes'],
      MAX_FILE_SIZE
    ),
    source: 'entitlement',
  };
}

// ?
// Helper Functions
// ?

type PendingFileDeleteSource = 'user_request' | 'cleanup';

async function markFilePendingDelete(fileId: string, userId: string): Promise<File | undefined> {
  const now = new Date();
  const [file] = await requireUserContext(userId, async (database) => {
    return await database
      .update(files)
      .set({
        deleteStatus: 'pending_delete',
        deleteRequestedAt: now,
        deleteLastError: null,
        updatedAt: now,
      })
      .where(and(eq(files.id, fileId), eq(files.userId, userId), eq(files.deleteStatus, 'active')))
      .returning();
  });

  return file;
}

async function deletePendingFileStorageAndMetadata(
  file: File,
  source: PendingFileDeleteSource
): Promise<{ deleted: boolean; error?: string }> {
  try {
    const blobStore = getInitializedBlobStore();
    await blobStore.delete(file.path);
  } catch (error) {
    await recordPendingFileDeleteFailure(file.id, error);
    const message = formatDeleteError(error);
    logger.error({ fileId: file.id, path: file.path, source, error }, 'Blob delete failed');
    return { deleted: false, error: message };
  }

  try {
    await withSystemContext(async (database) => {
      await database
        .delete(files)
        .where(and(eq(files.id, file.id), eq(files.deleteStatus, 'pending_delete')));
    });
    return { deleted: true };
  } catch (error) {
    await recordPendingFileDeleteFailure(file.id, error);
    const message = formatDeleteError(error);
    logger.error(
      { fileId: file.id, path: file.path, source, error },
      'File metadata delete failed'
    );
    return { deleted: false, error: message };
  }
}

function resolveStorageLimitBytes(
  limits: Record<string, number>,
  _mbKeys: string[],
  byteKeys: string[],
  fallbackBytes: number
): number {
  for (const key of byteKeys) {
    const value = toFiniteLimit(limits[key]);
    if (value !== null) {
      return value === -1 ? -1 : Math.floor(value);
    }
  }

  return fallbackBytes;
}

function toFiniteLimit(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function syncStorageUsageMetric(userId: string, totalBytes?: number): Promise<void> {
  try {
    const storageBytes = totalBytes ?? (await getStorageStats(userId)).totalSize;
    const tracked = await setMetric(userId, 'platform.storageBytes', storageBytes);
    if (!tracked) {
      logger.warn({ userId, storageBytes }, 'Storage usage metric was not updated');
    }
  } catch (error) {
    logger.warn({ userId, error }, 'Failed to sync storage usage metric');
  }
}

async function auditFileUploaded(
  file: FileMetadata,
  actorId: string,
  actorEmail: string
): Promise<void> {
  await auditStorageEvent({
    file,
    actorId,
    actorEmail,
    action: AUDIT_ACTIONS.FILE_UPLOADED,
    metadata: {
      size: file.size,
      mimeType: file.mimeType,
      folder: file.folder,
      path: file.path,
    },
  });
}

async function auditFileDeleted(file: File, actorId: string, actorEmail: string): Promise<void> {
  await auditStorageEvent({
    file: toFileMetadata(file),
    actorId,
    actorEmail,
    action: AUDIT_ACTIONS.FILE_DELETED,
    metadata: {
      size: file.size,
      mimeType: file.mimeType,
      folder: file.folder,
      path: file.path,
    },
  });
}

async function auditStorageEvent(options: {
  file: FileMetadata;
  actorId: string;
  actorEmail: string;
  action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
  metadata: Record<string, unknown>;
}): Promise<void> {
  try {
    await auditLogDurable({
      userId: options.actorId,
      userEmail: options.actorEmail,
      action: options.action,
      resource: 'file',
      resourceId: options.file.id,
      resourceName: options.file.originalName,
      status: 'success',
      metadata: {
        ownerUserId: options.file.userId,
        fileName: options.file.fileName,
        ...options.metadata,
      },
    });
  } catch (error) {
    logger.warn(
      {
        fileId: options.file.id,
        action: options.action,
        error,
      },
      'Failed to write file audit log'
    );
  }
}

async function recordPendingFileDeleteFailure(fileId: string, error: unknown): Promise<void> {
  await withSystemContext(async (database) => {
    await database
      .update(files)
      .set({
        deleteAttempts: sql`${files.deleteAttempts} + 1`,
        deleteLastError: formatDeleteError(error),
        updatedAt: new Date(),
      })
      .where(eq(files.id, fileId));
  });
}

function formatDeleteError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, FILE_DELETE_ERROR_MAX_LENGTH);
}

/**
 * Convert database File to FileMetadata
 */
function toFileMetadata(file: File): FileMetadata {
  return {
    id: file.id,
    userId: file.userId,
    fileName: file.fileName,
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    uploadedBy: file.uploadedBy,
    uploadedByEmail: file.uploadedByEmail,
    path: file.path,
    folder: file.folder,
    provider: file.provider,
    retentionAction: file.retentionAction,
    retentionUntil: file.retentionUntil,
    archivedAt: file.archivedAt,
    url: getFilePath(file as FileMetadata),
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

// ?
// Admin Functions
// ?

/**
 * Get all files (admin only)
 *
 * @param options List options without userId requirement
 * @returns Files list
 */
export async function getAllFiles(options: AdminListFilesOptions = {}): Promise<{
  files: FileMetadata[];
  total: number;
}> {
  const {
    limit = 50,
    offset = 0,
    searchTerm,
    owner,
    folder,
    provider,
    mimeType,
    minSize,
    maxSize,
    startDate,
    endDate,
  } = options;

  const conditions: SQL[] = [eq(files.deleteStatus, 'active')];

  if (searchTerm) {
    conditions.push(like(files.originalName, `%${searchTerm}%`));
  }

  if (owner) {
    const ownerCondition = or(
      eq(files.userId, owner),
      eq(files.uploadedBy, owner),
      like(files.uploadedByEmail, `%${owner}%`)
    );
    if (ownerCondition) {
      conditions.push(ownerCondition);
    }
  }

  if (folder) {
    conditions.push(eq(files.folder, sanitizeFolder(folder) || folder));
  }

  if (provider) {
    conditions.push(eq(files.provider, provider));
  }

  if (mimeType) {
    conditions.push(like(files.mimeType, `%${mimeType}%`));
  }

  if (typeof minSize === 'number') {
    conditions.push(gte(files.size, minSize));
  }

  if (typeof maxSize === 'number') {
    conditions.push(lte(files.size, maxSize));
  }

  if (startDate) {
    conditions.push(gte(files.createdAt, startDate));
  }

  if (endDate) {
    conditions.push(lte(files.createdAt, endDate));
  }

  const filesList = await withSystemContext(async (database) => {
    return await database.query.files.findMany({
      where: and(...conditions),
      limit,
      offset,
      orderBy: [desc(files.createdAt)],
    });
  });

  const [{ count }] = await withSystemContext(async (database) => {
    return await database
      .select({ count: sql<number>`count(*)` })
      .from(files)
      .where(and(...conditions));
  });

  return {
    files: filesList.map(toFileMetadata),
    total: Number(count),
  };
}

/**
 * Get global storage statistics (admin only)
 *
 * @returns Global storage stats
 */
export async function getGlobalStorageStats(): Promise<StorageStats> {
  const [stats] = await withSystemContext(async (database) => {
    return await database
      .select({
        totalFiles: sql<number>`count(*)`,
        totalSize: sql<number>`coalesce(sum(${files.size}), 0)`,
      })
      .from(files)
      .where(eq(files.deleteStatus, 'active'));
  });

  const filesByType = await withSystemContext(async (database) => {
    return await database
      .select({
        mimeType: files.mimeType,
        count: sql<number>`count(*)`,
        size: sql<number>`sum(${files.size})`,
      })
      .from(files)
      .where(eq(files.deleteStatus, 'active'))
      .groupBy(files.mimeType);
  });

  return {
    totalFiles: Number(stats.totalFiles),
    totalSize: Number(stats.totalSize),
    totalSizeMB: Number(stats.totalSize) / 1024 / 1024,
    filesByType: filesByType.map((item) => ({
      mimeType: item.mimeType,
      count: Number(item.count),
      size: Number(item.size),
    })),
  };
}
