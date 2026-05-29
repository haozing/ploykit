import type {
  ModuleFileCompleteUploadInput,
  ModuleFileCreateUploadInput,
  ModuleFileListQuery,
  ModuleFileRecord,
  ModuleFilesApi,
} from '@ploykit/module-sdk';
import type { RuntimeStore, RuntimeStoreFileRecord } from '../../module-runtime/stores';
import { createModuleMediaGateway, type ModuleMediaGateway } from './media-gateway';
import {
  bytesFromContent,
  createStorageKey,
  type ModuleFileStorageAdapter,
} from './storage-adapter';
import {
  inferModuleFileContentType,
  runModuleFileAntivirusPolicy,
  validateModuleFileUploadPolicy,
  type ModuleFileUploadPolicy,
} from './upload-policy';

export interface StorageBackedModuleFileRuntime extends ModuleFilesApi {
  forModule(moduleId: string): ModuleFilesApi;
  mediaGateway: ModuleMediaGateway;
  cleanupExpiredUploads(): Promise<RuntimeStoreFileRecord[]>;
  cleanupDeletedFiles(): Promise<RuntimeStoreFileRecord[]>;
  admin: {
    list(query?: {
      moduleId?: string;
      ownerId?: string;
      status?: ModuleFileRecord['status'];
      includeDeleted?: boolean;
    }): Promise<RuntimeStoreFileRecord[]>;
    quarantine(id: string, reason: string): Promise<RuntimeStoreFileRecord>;
    restore(id: string): Promise<RuntimeStoreFileRecord>;
  };
}

export interface ModuleFileQuotaPolicy {
  perUserBytes?: number;
  perWorkspaceBytes?: number;
  perModuleBytes?: number;
}

export interface CreateStorageBackedModuleFileRuntimeOptions {
  store: RuntimeStore;
  storage: ModuleFileStorageAdapter;
  productId: string;
  workspaceId?: string | null;
  ownerId?: string | null;
  uploadPolicy?: ModuleFileUploadPolicy;
  quota?: ModuleFileQuotaPolicy;
  now?: () => Date;
  defaultSignedUrlSeconds?: number;
  mediaSecret?: string;
}

function toIso(now: () => Date): string {
  return now().toISOString();
}

function normalizeExpiresAt(value: ModuleFileCreateUploadInput['expiresAt']): string | undefined {
  if (!value) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function contentSize(input: ModuleFileCompleteUploadInput): number {
  if (input.content === undefined) {
    return input.sizeBytes ?? 0;
  }
  return bytesFromContent(input.content).byteLength;
}

function toModuleFile(record: RuntimeStoreFileRecord): ModuleFileRecord {
  return {
    ...record,
    metadata: { ...record.metadata },
  };
}

function sumFileBytes(files: readonly RuntimeStoreFileRecord[], excludeId?: string): number {
  return files
    .filter((file) => file.id !== excludeId)
    .filter((file) => file.status !== 'deleted')
    .reduce((total, file) => total + file.sizeBytes, 0);
}

function isExpiredUpload(file: RuntimeStoreFileRecord, now: () => Date): boolean {
  return Boolean(file.expiresAt) && new Date(file.expiresAt!).getTime() <= now().getTime();
}

export function createStorageBackedModuleFileRuntime(
  options: CreateStorageBackedModuleFileRuntimeOptions
): StorageBackedModuleFileRuntime {
  const now = options.now ?? (() => new Date());
  const defaultSignedUrlSeconds = options.defaultSignedUrlSeconds ?? 300;
  const policy = options.uploadPolicy ?? {};
  const quota = options.quota ?? {};
  const mediaGateway = createModuleMediaGateway({
    store: options.store,
    storage: options.storage,
    productId: options.productId,
    secret: options.mediaSecret,
    now,
  });

  function assertScope(
    file: RuntimeStoreFileRecord | null,
    moduleId: string
  ): RuntimeStoreFileRecord {
    if (
      !file ||
      file.productId !== options.productId ||
      (file.workspaceId ?? null) !== (options.workspaceId ?? null) ||
      file.moduleId !== moduleId
    ) {
      throw new Error('MODULE_FILE_NOT_FOUND');
    }
    return file;
  }

  async function assertQuota(input: {
    moduleId: string;
    ownerId?: string | null;
    sizeBytes: number;
    fileId?: string;
  }): Promise<void> {
    if (input.sizeBytes <= 0) {
      return;
    }

    if (quota.perUserBytes !== undefined && input.ownerId) {
      const userFiles = await options.store.listFiles({
        productId: options.productId,
        workspaceId: options.workspaceId,
        ownerId: input.ownerId,
        includeDeleted: false,
      });
      if (sumFileBytes(userFiles, input.fileId) + input.sizeBytes > quota.perUserBytes) {
        throw new Error('MODULE_FILE_QUOTA_USER_EXCEEDED');
      }
    }

    if (quota.perWorkspaceBytes !== undefined) {
      const workspaceFiles = await options.store.listFiles({
        productId: options.productId,
        workspaceId: options.workspaceId,
        includeDeleted: false,
      });
      if (
        sumFileBytes(workspaceFiles, input.fileId) + input.sizeBytes >
        quota.perWorkspaceBytes
      ) {
        throw new Error('MODULE_FILE_QUOTA_WORKSPACE_EXCEEDED');
      }
    }

    if (quota.perModuleBytes !== undefined) {
      const moduleFiles = await options.store.listFiles({
        productId: options.productId,
        workspaceId: options.workspaceId,
        moduleId: input.moduleId,
        includeDeleted: false,
      });
      if (sumFileBytes(moduleFiles, input.fileId) + input.sizeBytes > quota.perModuleBytes) {
        throw new Error('MODULE_FILE_QUOTA_MODULE_EXCEEDED');
      }
    }
  }

  function scoped(moduleId: string): ModuleFilesApi {
    const api: ModuleFilesApi = {
      async createUpload(input) {
        const visibility = input.visibility ?? policy.defaultVisibility ?? 'private';
        const contentType = input.contentType ?? inferModuleFileContentType(input.name);
        validateModuleFileUploadPolicy(policy, { ...input, contentType, visibility });
        await assertQuota({
          moduleId,
          ownerId: options.ownerId,
          sizeBytes: input.sizeBytes ?? 0,
        });
        const storageKey = createStorageKey({
          productId: options.productId,
          workspaceId: options.workspaceId,
          moduleId,
          name: input.name,
        });
        const file = await options.store.createFile({
          productId: options.productId,
          workspaceId: options.workspaceId,
          moduleId,
          actorId: options.ownerId,
          ownerId: options.ownerId,
          name: input.name,
          purpose: input.purpose,
          status: 'uploading',
          visibility,
          contentType,
          sizeBytes: input.sizeBytes ?? 0,
          storageKey,
          runId: input.runId,
          metadata: input.metadata,
          expiresAt: normalizeExpiresAt(input.expiresAt),
        });
        return {
          file: toModuleFile(file),
          uploadUrl: await options.storage.createSignedUrl({
            key: file.storageKey,
            operation: 'write',
            expiresInSeconds: defaultSignedUrlSeconds,
          }),
        };
      },
      async createSignedUploadUrl(input) {
        return api.createUpload(input);
      },
      async completeUpload(id, input = {}) {
        const file = assertScope(await options.store.getFile(id), moduleId);
        if (file.status !== 'uploading' && file.status !== 'ready') {
          throw new Error(`MODULE_FILE_UPLOAD_CLOSED: ${id}`);
        }
        if (file.status === 'uploading' && isExpiredUpload(file, now)) {
          await options.storage.delete(file.storageKey);
          await options.store.updateFile(id, { status: 'deleted', deletedAt: toIso(now) });
          throw new Error(`MODULE_FILE_UPLOAD_EXPIRED: ${id}`);
        }
        const sizeBytes = contentSize(input);
        validateModuleFileUploadPolicy(policy, {
          name: file.name,
          purpose: file.purpose,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
          visibility: file.visibility,
          actualSizeBytes: sizeBytes,
        });
        const head =
          input.content === undefined
            ? await options.storage.head(file.storageKey)
            : await options.storage.put({
                key: file.storageKey,
                body: bytesFromContent(input.content),
                contentType: file.contentType,
                metadata: Object.fromEntries(
                  Object.entries({ ...file.metadata, ...(input.metadata ?? {}) }).map(
                    ([key, value]) => [key, String(value)]
                  )
                ),
              });
        if (!head) {
          throw new Error(`MODULE_FILE_OBJECT_MISSING: ${id}`);
        }
        const observedContentType =
          head.contentType ?? file.contentType ?? inferModuleFileContentType(file.name);
        validateModuleFileUploadPolicy(
          policy,
          {
            name: file.name,
            purpose: file.purpose,
            contentType: file.contentType,
            observedContentType,
            sizeBytes: file.sizeBytes,
            visibility: file.visibility,
            actualSizeBytes: head.sizeBytes,
          },
          { requireContentType: policy.allowedMimeTypes !== undefined }
        );
        try {
          await runModuleFileAntivirusPolicy(policy, {
            fileId: file.id,
            storageKey: file.storageKey,
            checksum: head.checksum,
            name: file.name,
            contentType: observedContentType,
            sizeBytes: head.sizeBytes,
            metadata: { ...file.metadata, ...(input.metadata ?? {}) },
          });
        } catch (error) {
          await options.store.updateFile(id, {
            status: 'quarantined',
            quarantinedAt: toIso(now),
            metadata: {
              antivirusReason: error instanceof Error ? error.message : String(error),
            },
          });
          throw error;
        }
        await assertQuota({
          moduleId,
          ownerId: file.ownerId,
          sizeBytes: head.sizeBytes,
          fileId: file.id,
        });
        const next = await options.store.updateFile(id, {
          status: 'ready',
          contentType: observedContentType,
          sizeBytes: head.sizeBytes,
          checksum: head.checksum,
          metadata: input.metadata,
        });
        return toModuleFile(next);
      },
      async read(id) {
        const file = await options.store.getFile(id);
        if (
          !file ||
          file.productId !== options.productId ||
          (file.workspaceId ?? null) !== (options.workspaceId ?? null) ||
          file.moduleId !== moduleId ||
          file.status === 'deleted'
        ) {
          return null;
        }
        return toModuleFile(file);
      },
      async get(id) {
        return api.read(id);
      },
      async list(query: ModuleFileListQuery = {}) {
        return (
          await options.store.listFiles({
            productId: options.productId,
            workspaceId: options.workspaceId,
            moduleId,
            purpose: query.purpose,
            status: query.status,
            runId: query.runId,
          })
        ).map(toModuleFile);
      },
      async createSignedUrl(id, signedUrlOptions = {}) {
        const file = assertScope(await options.store.getFile(id), moduleId);
        if (file.status !== 'ready' && file.status !== 'published') {
          throw new Error(`MODULE_FILE_NOT_READABLE: ${id}`);
        }
        return mediaGateway.createUrl(file, {
          expiresInSeconds: signedUrlOptions.expiresInSeconds ?? defaultSignedUrlSeconds,
        });
      },
      async createSignedDownloadUrl(id, signedUrlOptions = {}) {
        return api.createSignedUrl(id, signedUrlOptions);
      },
      async publish(id) {
        const file = assertScope(await options.store.getFile(id), moduleId);
        if (file.status !== 'ready' && file.status !== 'published') {
          throw new Error(`MODULE_FILE_NOT_PUBLISHABLE: ${id}`);
        }
        const next = await options.store.updateFile(id, {
          status: 'published',
          visibility: 'public',
          publishedAt: file.publishedAt ?? toIso(now),
        });
        return toModuleFile(next);
      },
      async unpublish(id) {
        const file = assertScope(await options.store.getFile(id), moduleId);
        if (file.status !== 'published' && file.status !== 'ready') {
          throw new Error(`MODULE_FILE_NOT_PUBLISHED: ${id}`);
        }
        const next = await options.store.updateFile(id, {
          status: 'ready',
          visibility: 'private',
          publishedAt: undefined,
        });
        return toModuleFile(next);
      },
      async archive(id) {
        assertScope(await options.store.getFile(id), moduleId);
        return toModuleFile(await options.store.updateFile(id, { status: 'archived' }));
      },
      async delete(id) {
        const file = await options.store.getFile(id);
        if (
          !file ||
          file.productId !== options.productId ||
          (file.workspaceId ?? null) !== (options.workspaceId ?? null) ||
          file.moduleId !== moduleId
        ) {
          return;
        }
        await options.store.updateFile(id, { status: 'deleted', deletedAt: toIso(now) });
      },
    };
    return api;
  }

  const runtime = scoped('__host__') as StorageBackedModuleFileRuntime;
  runtime.forModule = scoped;
  runtime.mediaGateway = mediaGateway;
  runtime.cleanupExpiredUploads = async () => {
    const uploading = await options.store.listFiles({
      productId: options.productId,
      workspaceId: options.workspaceId ?? null,
      status: 'uploading',
      includeDeleted: false,
    });
    const expired = uploading.filter((file) => isExpiredUpload(file, now));
    const deleted: RuntimeStoreFileRecord[] = [];
    for (const file of expired) {
      await options.storage.delete(file.storageKey);
      deleted.push(
        await options.store.updateFile(file.id, {
          status: 'deleted',
          deletedAt: toIso(now),
        })
      );
    }
    return deleted;
  };
  runtime.cleanupDeletedFiles = async () => {
    const deleted = await options.store.listFiles({
      productId: options.productId,
      workspaceId: options.workspaceId ?? null,
      status: 'deleted',
      includeDeleted: true,
    });
    for (const file of deleted) {
      await options.storage.delete(file.storageKey);
    }
    return deleted;
  };
  runtime.admin = {
    list(query = {}) {
      return options.store.listFiles({
        productId: options.productId,
        workspaceId: options.workspaceId,
        moduleId: query.moduleId,
        ownerId: query.ownerId,
        status: query.status,
        includeDeleted: query.includeDeleted,
      });
    },
    quarantine(id, reason) {
      return options.store.updateFile(id, {
        status: 'quarantined',
        quarantinedAt: toIso(now),
        metadata: { quarantineReason: reason },
      });
    },
    restore(id) {
      return options.store.updateFile(id, { status: 'ready' });
    },
  };
  return runtime;
}
