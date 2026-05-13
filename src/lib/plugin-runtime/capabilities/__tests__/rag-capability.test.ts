import { describe, expect, it, vi } from 'vitest';
import { definePlugin, Permission } from '@ploykit/plugin-sdk';
import type { PluginRagChunk } from '@/lib/db/schema/plugin-storage';
import { normalizePluginRuntimeContract } from '../../contract';
import {
  createPluginRagCapability,
  type PluginRagRepository,
  type PluginRagScope,
} from '../rag-capability.server';
import { withPluginResourceScopeAccessOverride } from '../guards.server';

class MemoryRagRepository implements PluginRagRepository {
  readonly artifacts = new Map<
    string,
    { id: string; path: string; content: string; hash: string; metadata: Record<string, unknown> }
  >();
  readonly chunks = new Map<string, PluginRagChunk[]>();

  private key(
    scope: PluginRagScope,
    resourceScope: Parameters<PluginRagRepository['replaceSource']>[1]['scope']
  ) {
    return `${scope.pluginId}:${scope.userId}:${resourceScope.type}:${resourceScope.id}`;
  }

  private artifactKey(
    scope: PluginRagScope,
    resourceScope: Parameters<PluginRagRepository['replaceSource']>[1]['scope'],
    path: string
  ) {
    return `${this.key(scope, resourceScope)}:${path}`;
  }

  seedArtifact(
    scope: PluginRagScope,
    resourceScope: Parameters<PluginRagRepository['replaceSource']>[1]['scope'],
    path: string,
    content: string
  ) {
    this.artifacts.set(this.artifactKey(scope, resourceScope, path), {
      id: `artifact:${path}`,
      path,
      content,
      hash: `hash:${content.length}`,
      metadata: { seeded: true },
    });
  }

  async readArtifactContent(
    scope: PluginRagScope,
    input: Parameters<PluginRagRepository['readArtifactContent']>[1]
  ) {
    const rows = Array.from(this.artifacts.values());
    if (input.artifactId) {
      return rows.find((row) => row.id === input.artifactId) ?? null;
    }
    if (input.path) {
      return this.artifacts.get(this.artifactKey(scope, input.scope, input.path)) ?? null;
    }
    return null;
  }

  async replaceSource(
    scope: PluginRagScope,
    input: Parameters<PluginRagRepository['replaceSource']>[1]
  ) {
    const key = this.key(scope, input.scope);
    const remaining = (this.chunks.get(key) ?? []).filter(
      (chunk) => chunk.sourceId !== input.sourceId
    );
    const now = new Date();
    const rows = input.chunks.map(
      (chunk) =>
        ({
          id: chunk.id,
          pluginId: scope.pluginId,
          userId: scope.userId,
          scopeType: input.scope.type,
          scopeId: input.scope.id,
          sourceId: input.sourceId,
          sourcePath: input.sourcePath ?? null,
          sourceHash: input.sourceHash,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          contentHash: chunk.contentHash,
          metadata: chunk.metadata,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        }) satisfies PluginRagChunk
    );
    this.chunks.set(key, [...remaining, ...rows]);
  }

  async search(scope: PluginRagScope, input: Parameters<PluginRagRepository['search']>[1]) {
    return (this.chunks.get(this.key(scope, input.scope)) ?? [])
      .filter((chunk) => !input.sourceIds?.length || input.sourceIds.includes(chunk.sourceId))
      .filter((chunk) => !input.pathPrefix || chunk.sourcePath?.startsWith(input.pathPrefix));
  }

  async delete(scope: PluginRagScope, input: Parameters<PluginRagRepository['delete']>[1]) {
    const key = this.key(scope, input.scope);
    this.chunks.set(
      key,
      (this.chunks.get(key) ?? []).filter(
        (chunk) =>
          (input.sourceId && chunk.sourceId !== input.sourceId) ||
          (input.path && chunk.sourcePath !== input.path) ||
          (!input.sourceId && !input.path)
      )
    );
  }
}

function createScope(permissions = [Permission.RagRead, Permission.RagWrite]) {
  return {
    contract: normalizePluginRuntimeContract(
      definePlugin({
        id: 'rag-test',
        name: 'RAG Test',
        version: '1.0.0',
        permissions,
      })
    ),
    user: { id: 'user-1', role: 'user' as const },
    request: new Request('https://test.local/api/plugins/rag-test/rag'),
    requestId: 'request-1',
  };
}

describe('rag capability', () => {
  const workspaceScope = { type: 'workspace' as const, id: 'workspace-1' };

  it('indexes artifact content, searches chunks, and builds a context pack', async () => {
    await withPluginResourceScopeAccessOverride(
      async () => true,
      async () => {
        const repository = new MemoryRagRepository();
        repository.seedArtifact(
          { pluginId: 'rag-test', userId: 'user-1' },
          workspaceScope,
          'docs/source.md',
          'Alpha planning note.\n\nBeta execution note.\n\nGamma review note.'
        );
        const rag = createPluginRagCapability(createScope(), { repository });

        await expect(
          rag.index({
            scope: workspaceScope,
            path: 'docs/source.md',
            chunkSize: 200,
            metadata: { kind: 'note' },
          })
        ).resolves.toMatchObject({
          scope: workspaceScope,
          sourceId: 'artifact:docs/source.md',
          sourcePath: 'docs/source.md',
          chunkCount: 1,
        });

        await expect(
          rag.search({ scope: workspaceScope, query: 'Beta execution', topK: 3 })
        ).resolves.toEqual([
          expect.objectContaining({
            sourcePath: 'docs/source.md',
            content: expect.stringContaining('Beta execution note'),
            metadata: expect.objectContaining({ seeded: true, kind: 'note' }),
          }),
        ]);

        await expect(
          rag.search({
            scope: workspaceScope,
            query: 'Beta execution',
            metadata: { kind: 'missing' },
          })
        ).resolves.toEqual([]);

        await expect(
          rag.buildContextPack({
            scope: workspaceScope,
            query: 'Gamma review',
            maxCharacters: 160,
          })
        ).resolves.toMatchObject({
          scope: workspaceScope,
          query: 'Gamma review',
          content: expect.stringContaining('Gamma review note'),
          sources: [expect.objectContaining({ sourcePath: 'docs/source.md' })],
        });
      }
    );
  });

  it('indexes direct content without requiring an artifact', async () => {
    await withPluginResourceScopeAccessOverride(
      async () => true,
      async () => {
        const rag = createPluginRagCapability(createScope(), {
          repository: new MemoryRagRepository(),
        });

        await expect(
          rag.index({
            scope: workspaceScope,
            path: 'scratch/input.txt',
            content: 'Direct source content for retrieval.',
          })
        ).resolves.toMatchObject({
          sourceId: 'scratch/input.txt',
          sourcePath: 'scratch/input.txt',
          chunkCount: 1,
        });

        await expect(
          rag.search({ scope: workspaceScope, query: 'retrieval' })
        ).resolves.toHaveLength(1);
      }
    );
  });

  it('enforces read and write permissions independently', async () => {
    const repository = new MemoryRagRepository();
    const readOnly = createPluginRagCapability(createScope([Permission.RagRead]), { repository });
    const writeOnly = createPluginRagCapability(createScope([Permission.RagWrite]), { repository });

    await expect(
      readOnly.index({ scope: workspaceScope, path: 'a.md', content: 'hello' })
    ).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: { permission: Permission.RagWrite },
    });

    await expect(writeOnly.search({ scope: workspaceScope, query: 'hello' })).rejects.toMatchObject(
      {
        code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
        details: { permission: Permission.RagRead },
      }
    );
  });

  it('rejects unsafe paths and empty queries', async () => {
    await withPluginResourceScopeAccessOverride(
      async () => true,
      async () => {
        const rag = createPluginRagCapability(createScope(), {
          repository: new MemoryRagRepository(),
        });

        await expect(
          rag.index({ scope: workspaceScope, path: '../bad.md', content: 'bad' })
        ).rejects.toMatchObject({
          code: 'PLUGIN_RAG_PATH_INVALID',
        });

        await expect(rag.search({ scope: workspaceScope, query: '   ' })).rejects.toMatchObject({
          code: 'PLUGIN_RAG_QUERY_REQUIRED',
        });
      }
    );
  });

  it('requires a delete target', async () => {
    await withPluginResourceScopeAccessOverride(
      async () => true,
      async () => {
        const rag = createPluginRagCapability(createScope(), {
          repository: new MemoryRagRepository(),
        });

        await expect(rag.delete({ scope: workspaceScope })).rejects.toMatchObject({
          code: 'PLUGIN_RAG_DELETE_TARGET_REQUIRED',
        });
      }
    );
  });

  it('records audit events for index and delete operations', async () => {
    await withPluginResourceScopeAccessOverride(
      async () => true,
      async () => {
        const log = vi.fn();
        const rag = createPluginRagCapability(createScope(), {
          repository: new MemoryRagRepository(),
          auditPort: {
            log,
            query: vi.fn(async () => []),
          },
        });

        await rag.index({ scope: workspaceScope, path: 'a.txt', content: 'hello world' });
        await rag.delete({ scope: workspaceScope, path: 'a.txt' });

        expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: 'rag-test.rag.index' }));
        expect(log).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'rag-test.rag.delete' })
        );
      }
    );
  });
});
