import { describe, expect, it, vi } from 'vitest';
import { definePlugin, Permission, PluginError } from '@ploykit/plugin-sdk';
import type { PluginArtifact } from '@/lib/db/schema/plugin-storage';
import {
  createPluginArtifactsCapability,
  type PluginArtifactsRepository,
  type PluginArtifactsScope,
} from '../artifacts-capability.server';
import { withPluginResourceScopeAccessOverride } from '../guards.server';
import { normalizePluginRuntimeContract } from '../../contract';

class MemoryArtifactsRepository implements PluginArtifactsRepository {
  readonly values = new Map<string, PluginArtifact>();
  readonly updates: Array<{ scope: PluginArtifactsScope; path: string }> = [];

  private key(
    scope: PluginArtifactsScope,
    resourceScope: Parameters<PluginArtifactsRepository['upsert']>[1]['scope'],
    path: string
  ) {
    const ownerKey = resourceScope.type === 'workspace' ? '*' : scope.userId;
    return `${scope.pluginId}:${ownerKey}:${resourceScope.type}:${resourceScope.id}:${path}`;
  }

  async upsert(
    scope: PluginArtifactsScope,
    input: Parameters<PluginArtifactsRepository['upsert']>[1]
  ) {
    const key = this.key(scope, input.scope, input.path);
    const existing = this.values.get(key);
    const now = new Date();
    const row = {
      id: existing?.id ?? `artifact-${this.values.size + 1}`,
      pluginId: scope.pluginId,
      userId: scope.userId,
      scopeType: input.scope.type,
      scopeId: input.scope.id,
      path: input.path,
      contentType: input.contentType,
      content: input.content,
      metadata: input.metadata,
      version: (existing?.version ?? 0) + 1,
      size: Buffer.byteLength(input.content, 'utf8'),
      hash: `hash-${input.content.length}`,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
    };
    this.values.set(key, row);
    this.updates.push({ scope, path: input.path });
    return row;
  }

  async read(scope: PluginArtifactsScope, input: Parameters<PluginArtifactsRepository['read']>[1]) {
    return this.values.get(this.key(scope, input.scope, input.path)) ?? null;
  }

  async list(scope: PluginArtifactsScope, input: Parameters<PluginArtifactsRepository['list']>[1]) {
    return Array.from(this.values.values())
      .filter(
        (row) =>
          row.pluginId === scope.pluginId &&
          (input.scope.type === 'workspace' || row.userId === scope.userId) &&
          row.scopeType === input.scope.type &&
          row.scopeId === input.scope.id &&
          (!input.prefix || row.path.startsWith(input.prefix))
      )
      .sort((left, right) => left.path.localeCompare(right.path))
      .slice(input.offset, input.offset + input.limit);
  }

  async updateMetadata(
    scope: PluginArtifactsScope,
    input: Parameters<PluginArtifactsRepository['updateMetadata']>[1]
  ) {
    const key = this.key(scope, input.scope, input.path);
    const existing = this.values.get(key);
    if (!existing) {
      throw new Error('missing');
    }
    const row = {
      ...existing,
      metadata: input.merge ? { ...existing.metadata, ...input.metadata } : input.metadata,
      version: existing.version + 1,
      updatedAt: new Date(),
    };
    this.values.set(key, row);
    return row;
  }

  async softDelete(
    scope: PluginArtifactsScope,
    input: Parameters<PluginArtifactsRepository['softDelete']>[1]
  ) {
    this.values.delete(this.key(scope, input.scope, input.path));
  }
}

function createScope(permissions = [Permission.ArtifactsRead, Permission.ArtifactsWrite]) {
  return {
    contract: normalizePluginRuntimeContract(
      definePlugin({
        id: 'artifact-test',
        name: 'Artifact Test',
        version: '1.0.0',
        permissions,
      })
    ),
    user: { id: 'user-1', role: 'user' as const },
    request: new Request('https://test.local/api/plugins/artifact-test/artifacts'),
    requestId: 'request-1',
  };
}

describe('artifacts capability', () => {
  const workspaceScope = { type: 'workspace' as const, id: 'workspace-1' };

  it('writes, reads, lists, updates metadata, and deletes text artifacts', async () => {
    await withPluginResourceScopeAccessOverride(
      async () => true,
      async () => {
        const repository = new MemoryArtifactsRepository();
        const artifacts = createPluginArtifactsCapability(createScope(), { repository });

        await expect(
          artifacts.writeText({
            scope: workspaceScope,
            path: '01_outline/outline.md',
            content: '# Outline',
            contentType: 'text/markdown',
            metadata: { artifactType: 'outline' },
          })
        ).resolves.toMatchObject({
          scope: workspaceScope,
          path: '01_outline/outline.md',
          content: '# Outline',
          contentType: 'text/markdown',
          metadata: { artifactType: 'outline' },
          version: 1,
        });

        await expect(
          artifacts.writeText({
            scope: workspaceScope,
            path: '01_outline/outline.md',
            content: '# Outline v2',
          })
        ).resolves.toMatchObject({
          version: 2,
          content: '# Outline v2',
        });

        await expect(
          artifacts.readText({ scope: workspaceScope, path: '01_outline/outline.md' })
        ).resolves.toMatchObject({
          content: '# Outline v2',
          version: 2,
        });

        await expect(artifacts.list({ scope: workspaceScope })).resolves.toHaveLength(1);
        await expect(artifacts.tree({ scope: workspaceScope })).resolves.toEqual([
          expect.objectContaining({
            name: 'outline.md',
            parentPath: '01_outline',
          }),
        ]);

        await expect(
          artifacts.updateMetadata({
            scope: workspaceScope,
            path: '01_outline/outline.md',
            metadata: { indexed: true },
          })
        ).resolves.toMatchObject({
          metadata: { indexed: true },
          version: 3,
        });

        await artifacts.delete({ scope: workspaceScope, path: '01_outline/outline.md' });
        await expect(
          artifacts.readText({ scope: workspaceScope, path: '01_outline/outline.md' })
        ).resolves.toBeNull();
      }
    );
  });

  it('rejects unsafe paths before reaching the repository', async () => {
    await withPluginResourceScopeAccessOverride(
      async () => true,
      async () => {
        const repository = new MemoryArtifactsRepository();
        const artifacts = createPluginArtifactsCapability(createScope(), { repository });

        await expect(
          artifacts.writeText({
            scope: workspaceScope,
            path: '../secrets.txt',
            content: 'nope',
          })
        ).rejects.toMatchObject({
          code: 'PLUGIN_ARTIFACT_PATH_INVALID',
        });
        expect(repository.values.size).toBe(0);
      }
    );
  });

  it('enforces read and write permissions independently', async () => {
    const repository = new MemoryArtifactsRepository();
    const readOnly = createPluginArtifactsCapability(createScope([Permission.ArtifactsRead]), {
      repository,
    });
    const writeOnly = createPluginArtifactsCapability(createScope([Permission.ArtifactsWrite]), {
      repository,
    });

    await expect(
      readOnly.writeText({ scope: workspaceScope, path: 'a.md', content: 'hello' })
    ).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: {
        permission: Permission.ArtifactsWrite,
      },
    });

    await expect(writeOnly.readText({ scope: workspaceScope, path: 'a.md' })).rejects.toMatchObject(
      {
        code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
        details: {
          permission: Permission.ArtifactsRead,
        },
      }
    );
  });

  it('requires an authenticated user', async () => {
    const scope = { ...createScope(), user: null };
    const artifacts = createPluginArtifactsCapability(scope, {
      repository: new MemoryArtifactsRepository(),
    });

    await expect(artifacts.list({ scope: workspaceScope })).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_USER_REQUIRED',
    });
  });

  it('enforces workspace role matrix for shared artifacts', async () => {
    const roleForUser = new Map<string, 'owner' | 'admin' | 'editor' | 'viewer'>();
    const withMatrixGuard = <T>(callback: () => Promise<T>) =>
      withPluginResourceScopeAccessOverride(async (scope, resourceScope, action) => {
        if (resourceScope.type === 'user') return resourceScope.id === scope.user?.id;
        const role = roleForUser.get(scope.user?.id ?? '');
        const forbidden = (): never => {
          throw new PluginError({
            code: 'PLUGIN_WORKSPACE_SCOPE_FORBIDDEN',
            message: `Cannot ${action} workspace in matrix test.`,
            statusCode: 403,
            details: {
              action,
              requestedScope: resourceScope,
              userId: scope.user?.id,
            },
          });
        };
        if (!role) forbidden();
        if (action === 'read') return true;
        if (action === 'write' && (role === 'owner' || role === 'admin' || role === 'editor')) {
          return true;
        }
        if (role === 'owner' || role === 'admin') return true;
        return forbidden();
      }, callback);
    const repository = new MemoryArtifactsRepository();
    const scopeForUser = (userId: string) => ({
      ...createScope(),
      user: { id: userId, role: 'user' as const },
    });

    await withMatrixGuard(async () => {
      roleForUser.set('owner-user', 'owner');
      await createPluginArtifactsCapability(scopeForUser('owner-user'), { repository }).writeText({
        scope: workspaceScope,
        path: 'shared/guide.md',
        content: 'owner draft',
      });

      for (const role of ['owner', 'admin', 'editor', 'viewer'] as const) {
        const userId = `${role}-user`;
        roleForUser.set(userId, role);
        const artifacts = createPluginArtifactsCapability(scopeForUser(userId), { repository });

        await expect(
          artifacts.readText({ scope: workspaceScope, path: 'shared/guide.md' })
        ).resolves.toMatchObject({
          path: 'shared/guide.md',
          content: expect.any(String),
        });
        await expect(artifacts.list({ scope: workspaceScope })).resolves.toHaveLength(1);

        if (role === 'owner' || role === 'admin' || role === 'editor') {
          await expect(
            artifacts.updateMetadata({
              scope: workspaceScope,
              path: 'shared/guide.md',
              metadata: { updatedBy: role },
            })
          ).resolves.toMatchObject({
            metadata: { updatedBy: role },
          });
        } else {
          await expect(
            artifacts.writeText({
              scope: workspaceScope,
              path: 'shared/viewer.md',
              content: 'nope',
            })
          ).rejects.toMatchObject({
            code: 'PLUGIN_WORKSPACE_SCOPE_FORBIDDEN',
            details: { action: 'write' },
          });
          await expect(
            artifacts.delete({ scope: workspaceScope, path: 'shared/guide.md' })
          ).rejects.toMatchObject({
            code: 'PLUGIN_WORKSPACE_SCOPE_FORBIDDEN',
            details: { action: 'delete' },
          });
        }
      }

      await expect(
        createPluginArtifactsCapability(scopeForUser('stranger-user'), { repository }).list({
          scope: workspaceScope,
        })
      ).rejects.toMatchObject({
        code: 'PLUGIN_WORKSPACE_SCOPE_FORBIDDEN',
        details: { action: 'read' },
      });
    });
  });

  it('rejects oversized content', async () => {
    await withPluginResourceScopeAccessOverride(
      async () => true,
      async () => {
        const artifacts = createPluginArtifactsCapability(createScope(), {
          repository: new MemoryArtifactsRepository(),
        });

        await expect(
          artifacts.writeText({
            scope: workspaceScope,
            path: 'big.txt',
            content: 'x'.repeat(2 * 1024 * 1024 + 1),
          })
        ).rejects.toMatchObject({
          code: 'PLUGIN_ARTIFACT_CONTENT_TOO_LARGE',
          statusCode: 413,
        });
      }
    );
  });

  it('records audit events for write operations', async () => {
    await withPluginResourceScopeAccessOverride(
      async () => true,
      async () => {
        const log = vi.fn();
        const artifacts = createPluginArtifactsCapability(createScope(), {
          repository: new MemoryArtifactsRepository(),
          auditPort: {
            log,
            query: vi.fn(async () => []),
          },
        });

        await artifacts.writeText({ scope: workspaceScope, path: 'a.txt', content: 'hello' });
        await artifacts.updateMetadata({
          scope: workspaceScope,
          path: 'a.txt',
          metadata: { kind: 'note' },
        });
        await artifacts.delete({ scope: workspaceScope, path: 'a.txt' });

        expect(log).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'artifact-test.artifacts.write' })
        );
        expect(log).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'artifact-test.artifacts.updateMetadata' })
        );
        expect(log).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'artifact-test.artifacts.delete' })
        );
      }
    );
  });
});
