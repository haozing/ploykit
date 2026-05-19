import { describe, expect, it, vi } from 'vitest';
import { definePlugin, Permission, PluginError, type PermissionValue } from '@ploykit/plugin-sdk';
import type { BlobStore } from '@/lib/services/storage/blob-store';
import type { PluginFile } from '@/lib/db/schema/plugin-platform';
import { normalizePluginRuntimeContract } from '../../contract';
import {
  createPluginFilesCapability,
  type PluginFileAccessAction,
  type PluginFilesHost,
  type PluginFilesRepository,
  type PluginFilesScope,
} from '../files-capability.server';
import type { NormalizedPluginResourceScope } from '../guards.server';

class MemoryFilesRepository implements PluginFilesRepository {
  readonly values = new Map<string, PluginFile>();

  async createPending(
    scope: PluginFilesScope,
    input: Parameters<PluginFilesRepository['createPending']>[1]
  ) {
    const now = new Date();
    const row: PluginFile = {
      id: `file-${this.values.size + 1}`,
      pluginId: scope.pluginId,
      userId: scope.userId,
      scopeType: input.resourceScope.type,
      scopeId: input.resourceScope.id,
      ownerUserId: scope.userId,
      fileName: input.fileName,
      contentType: input.contentType,
      size: input.size,
      hash: null,
      purpose: input.purpose,
      status: 'pending_upload',
      visibility: 'private',
      publicId: null,
      publicFileName: null,
      publicCacheControl: null,
      contentDisposition: 'attachment',
      storageKey: input.storageKey,
      storageProvider: 'local',
      runId: input.runId ?? null,
      metadata: input.metadata,
      expiresAt: input.expiresAt ?? null,
      uploadedAt: null,
      publishedAt: null,
      archivedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.values.set(row.id, row);
    return row;
  }

  async complete(
    _scope: PluginFilesScope,
    input: Parameters<PluginFilesRepository['complete']>[1]
  ) {
    const existing = this.values.get(input.fileId);
    if (!existing) {
      throw new Error('missing file');
    }
    const row: PluginFile = {
      ...existing,
      storageKey: input.storageKey ?? existing.storageKey,
      size: input.size,
      hash: input.hash ?? null,
      contentType: input.contentType ?? existing.contentType,
      metadata: input.metadata ? { ...existing.metadata, ...input.metadata } : existing.metadata,
      status: 'ready',
      uploadedAt: new Date(),
      updatedAt: new Date(),
    };
    this.values.set(row.id, row);
    return row;
  }

  async get(_scope: PluginFilesScope, id: string) {
    return this.values.get(id) ?? null;
  }

  async list(_scope: PluginFilesScope, input: Parameters<PluginFilesRepository['list']>[1]) {
    return Array.from(this.values.values()).filter(
      (row) =>
        row.scopeType === input.resourceScope.type &&
        row.scopeId === input.resourceScope.id &&
        (!input.purpose || row.purpose === input.purpose) &&
        (!input.status || row.status === input.status) &&
        (!input.runId || row.runId === input.runId)
    );
  }

  async getUsage(
    _scope: PluginFilesScope,
    input: Parameters<PluginFilesRepository['getUsage']>[1]
  ) {
    const rows = Array.from(this.values.values()).filter(
      (row) =>
        row.scopeType === input.resourceScope.type &&
        row.scopeId === input.resourceScope.id &&
        !row.deletedAt
    );
    const dailyRows = input.uploadedSince
      ? rows.filter((row) => row.createdAt >= input.uploadedSince!)
      : rows;

    return {
      fileCount: rows.length,
      storageBytes: rows.reduce((sum, row) => sum + row.size, 0),
      dailyUploadBytes: dailyRows.reduce((sum, row) => sum + row.size, 0),
    };
  }

  async archive(_scope: PluginFilesScope, id: string) {
    const existing = this.values.get(id);
    if (!existing) {
      throw new Error('missing file');
    }
    const row: PluginFile = {
      ...existing,
      status: 'archived',
      archivedAt: new Date(),
      updatedAt: new Date(),
    };
    this.values.set(id, row);
    return row;
  }

  async publish(
    _scope: PluginFilesScope,
    id: string,
    input: Parameters<PluginFilesRepository['publish']>[2]
  ) {
    const existing = this.values.get(id);
    if (!existing) {
      throw new Error('missing file');
    }
    const row: PluginFile = {
      ...existing,
      visibility: 'public',
      publicId: input.publicId,
      publicFileName: input.fileName,
      publicCacheControl: input.cacheControl,
      contentDisposition: input.contentDisposition,
      publishedAt: new Date(),
      updatedAt: new Date(),
    };
    this.values.set(id, row);
    return row;
  }

  async unpublish(_scope: PluginFilesScope, id: string) {
    const existing = this.values.get(id);
    if (!existing) {
      throw new Error('missing file');
    }
    const row: PluginFile = {
      ...existing,
      visibility: 'private',
      publicId: null,
      publicFileName: null,
      publicCacheControl: null,
      contentDisposition: 'attachment',
      publishedAt: null,
      updatedAt: new Date(),
    };
    this.values.set(id, row);
    return row;
  }

  async softDelete(_scope: PluginFilesScope, id: string) {
    const existing = this.values.get(id);
    if (!existing) {
      throw new Error('missing file');
    }
    const row: PluginFile = {
      ...existing,
      status: 'deleted',
      deletedAt: new Date(),
      updatedAt: new Date(),
    };
    this.values.set(id, row);
    return row;
  }
}

function createScope(permissions: PermissionValue[], userId = 'user-1') {
  return {
    contract: normalizePluginRuntimeContract(
      definePlugin({
        id: 'files-test',
        name: 'Files Test',
        version: '1.0.0',
        permissions,
      })
    ),
    user: { id: userId, role: 'user' as const },
    request: new Request('https://test.local/api/plugins/files-test/files'),
    requestId: 'request-1',
  };
}

function createHost(
  authorizeScope: PluginFilesHost['authorizeScope'] = vi.fn(async () => undefined)
): Partial<PluginFilesHost> {
  const blobs = new Map<string, Buffer>();
  const blobStore: BlobStore = {
    async put(input) {
      blobs.set(input.key, input.body);
      return { key: input.key, size: input.body.length };
    },
    async get(key) {
      return {
        body: blobs.get(key) ?? Buffer.from('hello'),
        contentType: 'text/plain',
      };
    },
    async delete(key) {
      blobs.delete(key);
    },
    async exists(key) {
      return blobs.has(key);
    },
  };

  return {
    getBlobStore: () => blobStore,
    createSignedUrl: vi.fn(
      async ({ file, operation }) => `/api/plugin-files/${file.id}/${operation}`
    ),
    getQuota: vi.fn(async () => ({ maxFileSizeBytes: 1024 * 1024 })),
    authorizeScope,
  };
}

function workspaceAuthorizer(role: 'owner' | 'admin' | 'editor' | 'viewer') {
  return vi.fn(
    async (
      _scope: PluginFilesScope,
      resourceScope: NormalizedPluginResourceScope,
      action: PluginFileAccessAction
    ) => {
      if (resourceScope.type === 'user') {
        return;
      }

      const canWrite = role === 'owner' || role === 'admin' || role === 'editor';
      if (action === 'read' || canWrite) {
        return;
      }

      throw new PluginError({
        code: 'PLUGIN_FILE_SCOPE_FORBIDDEN',
        message: 'Forbidden in test host.',
        statusCode: 403,
      });
    }
  );
}

describe('files capability', () => {
  const workspaceScope = { type: 'workspace' as const, id: 'workspace-1' };

  it('lets workspace viewers read and download scoped files', async () => {
    const repository = new MemoryFilesRepository();
    const host = createHost(workspaceAuthorizer('viewer'));
    const editorFiles = createPluginFilesCapability(
      createScope([Permission.FilesRead, Permission.FilesWrite], 'editor-1'),
      { repository, host: createHost(workspaceAuthorizer('editor')) }
    );
    const viewerFiles = createPluginFilesCapability(
      createScope([Permission.FilesRead, Permission.FilesWrite], 'viewer-1'),
      { repository, host }
    );

    const uploaded = await editorFiles.createUpload({
      scope: workspaceScope,
      fileName: 'report.txt',
      contentType: 'text/plain',
      size: 5,
      purpose: 'source',
      body: Buffer.from('hello'),
    });

    await expect(viewerFiles.read(uploaded.id)).resolves.toMatchObject({
      record: {
        id: uploaded.id,
        scope: workspaceScope,
        status: 'ready',
      },
    });
    await expect(viewerFiles.createSignedDownloadUrl(uploaded.id)).resolves.toBe(
      `/api/plugin-files/${uploaded.id}/download`
    );
  });

  it('blocks workspace viewers from upload and delete operations', async () => {
    const repository = new MemoryFilesRepository();
    const editorFiles = createPluginFilesCapability(
      createScope([Permission.FilesRead, Permission.FilesWrite], 'editor-1'),
      { repository, host: createHost(workspaceAuthorizer('editor')) }
    );
    const viewerFiles = createPluginFilesCapability(
      createScope([Permission.FilesRead, Permission.FilesWrite], 'viewer-1'),
      { repository, host: createHost(workspaceAuthorizer('viewer')) }
    );

    const uploaded = await editorFiles.createUpload({
      scope: workspaceScope,
      fileName: 'report.txt',
      contentType: 'text/plain',
      size: 5,
      purpose: 'source',
      body: Buffer.from('hello'),
    });

    await expect(
      viewerFiles.createUpload({
        scope: workspaceScope,
        fileName: 'other.txt',
        contentType: 'text/plain',
        size: 5,
        purpose: 'source',
      })
    ).rejects.toMatchObject({
      code: 'PLUGIN_FILE_SCOPE_FORBIDDEN',
    });

    await expect(viewerFiles.delete(uploaded.id)).rejects.toMatchObject({
      code: 'PLUGIN_FILE_SCOPE_FORBIDDEN',
    });
  });

  it('enforces workspace role matrix for shared files', async () => {
    const repository = new MemoryFilesRepository();
    const roleForUser = new Map<string, 'owner' | 'admin' | 'editor' | 'viewer'>();
    const matrixHost = (userId: string) =>
      createHost(
        vi.fn(
          async (
            _scope: PluginFilesScope,
            resourceScope: NormalizedPluginResourceScope,
            action: PluginFileAccessAction
          ) => {
            if (resourceScope.type === 'user') {
              return;
            }
            const role = roleForUser.get(userId);
            const canWrite = role === 'owner' || role === 'admin' || role === 'editor';
            const canDelete = role === 'owner' || role === 'admin';
            if (
              action === 'read' ||
              (action === 'write' && canWrite) ||
              (action === 'delete' && canDelete)
            ) {
              return;
            }
            throw new PluginError({
              code: 'PLUGIN_FILE_SCOPE_FORBIDDEN',
              message: 'Forbidden in matrix test host.',
              statusCode: 403,
            });
          }
        )
      );
    const filesFor = (userId: string) =>
      createPluginFilesCapability(
        createScope([Permission.FilesRead, Permission.FilesWrite], userId),
        { repository, host: matrixHost(userId) }
      );

    roleForUser.set('owner-user', 'owner');
    const ownerFiles = filesFor('owner-user');
    const uploaded = await ownerFiles.createUpload({
      scope: workspaceScope,
      fileName: 'matrix.txt',
      contentType: 'text/plain',
      size: 5,
      purpose: 'source',
      body: Buffer.from('hello'),
    });

    for (const role of ['owner', 'admin', 'editor', 'viewer'] as const) {
      const userId = `${role}-user`;
      roleForUser.set(userId, role);
      const files = filesFor(userId);

      await expect(files.get(uploaded.id)).resolves.toMatchObject({
        id: uploaded.id,
        scope: workspaceScope,
      });
      await expect(files.list({ scope: workspaceScope })).resolves.toContainEqual(
        expect.objectContaining({ id: uploaded.id })
      );

      if (role === 'owner' || role === 'admin' || role === 'editor') {
        await expect(
          files.createUpload({
            scope: workspaceScope,
            fileName: `${role}.txt`,
            contentType: 'text/plain',
            size: 5,
            purpose: 'source',
          })
        ).resolves.toMatchObject({ scope: workspaceScope });
      } else {
        await expect(
          files.createUpload({
            scope: workspaceScope,
            fileName: 'viewer.txt',
            contentType: 'text/plain',
            size: 5,
            purpose: 'source',
          })
        ).rejects.toMatchObject({ code: 'PLUGIN_FILE_SCOPE_FORBIDDEN' });
      }

      if (role === 'owner' || role === 'admin') {
        const deletable = await files.createUpload({
          scope: workspaceScope,
          fileName: `${role}-delete.txt`,
          contentType: 'text/plain',
          size: 5,
          purpose: 'source',
        });
        await expect(files.delete(deletable.id)).resolves.toBeUndefined();
      } else {
        await expect(files.archive(uploaded.id)).rejects.toMatchObject({
          code: 'PLUGIN_FILE_SCOPE_FORBIDDEN',
        });
      }
    }
  });

  it('keeps user-scoped files isolated from other users', async () => {
    const repository = new MemoryFilesRepository();
    const authorFiles = createPluginFilesCapability(
      createScope([Permission.FilesRead, Permission.FilesWrite], 'user-1'),
      { repository, host: createHost() }
    );
    const otherAuthorizer = vi.fn(
      async (
        scope: PluginFilesScope,
        resourceScope: NormalizedPluginResourceScope,
        action: PluginFileAccessAction
      ) => {
        if (resourceScope.type === 'user' && resourceScope.id !== scope.userId) {
          throw new PluginError({
            code: 'PLUGIN_FILE_SCOPE_FORBIDDEN',
            message: `Cannot ${action} another user file.`,
            statusCode: 403,
          });
        }
      }
    );
    const otherFiles = createPluginFilesCapability(
      createScope([Permission.FilesRead, Permission.FilesWrite], 'user-2'),
      { repository, host: createHost(otherAuthorizer) }
    );

    const uploaded = await authorFiles.createUpload({
      scope: { type: 'user', id: 'user-1' },
      fileName: 'note.txt',
      contentType: 'text/plain',
      size: 5,
      purpose: 'source',
      body: Buffer.from('hello'),
    });

    await expect(otherFiles.get(uploaded.id)).rejects.toMatchObject({
      code: 'PLUGIN_FILE_SCOPE_FORBIDDEN',
    });
  });

  it('enforces per-scope file count, storage, and daily upload quotas', async () => {
    const repository = new MemoryFilesRepository();
    const files = createPluginFilesCapability(
      createScope([Permission.FilesRead, Permission.FilesWrite]),
      {
        repository,
        host: {
          ...createHost(),
          getQuota: vi.fn(async () => ({
            maxFileSizeBytes: 1024,
            maxFilesPerScope: 1,
            maxStorageBytesPerScope: 8,
            maxDailyUploadBytesPerScope: 8,
          })),
        },
      }
    );

    await files.createUpload({
      scope: { type: 'user', id: 'user-1' },
      fileName: 'first.txt',
      contentType: 'text/plain',
      size: 5,
      purpose: 'source',
      body: Buffer.from('hello'),
    });

    await expect(
      files.createUpload({
        scope: { type: 'user', id: 'user-1' },
        fileName: 'second.txt',
        contentType: 'text/plain',
        size: 4,
        purpose: 'source',
      })
    ).rejects.toMatchObject({
      code: 'PLUGIN_FILE_COUNT_LIMIT_EXCEEDED',
    });
  });

  it('publishes and unpublishes ready files with a stable public URL', async () => {
    const repository = new MemoryFilesRepository();
    const files = createPluginFilesCapability(
      createScope([Permission.FilesRead, Permission.FilesWrite, Permission.FilesPublish]),
      { repository, host: createHost() }
    );
    const uploaded = await files.createUpload({
      scope: { type: 'user', id: 'user-1' },
      fileName: 'cover.png',
      contentType: 'image/png',
      size: 5,
      purpose: 'media',
      body: Buffer.from('image'),
    });

    const published = await files.publish({
      id: uploaded.id,
      disposition: 'inline',
      cache: { maxAgeSeconds: 60 },
    });

    expect(published.visibility).toBe('public');
    expect(published.publicUrl).toContain('/api/plugin-media/files-test/');
    expect(published.contentDisposition).toBe('inline');

    const unpublished = await files.unpublish(uploaded.id);
    expect(unpublished.visibility).toBe('private');
    expect(unpublished.publicUrl).toBeUndefined();
  });
});
