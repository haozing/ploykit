import { createHash } from 'node:crypto';
import type { ModuleAiApi, ModuleRagSearchResult } from '@ploykit/module-sdk';
import type { RagVectorStore } from './vector-store';

export interface RagIndexerOptions {
  productId: string;
  workspaceId?: string | null;
  moduleId: string;
  ai: ModuleAiApi;
  vectorStore: RagVectorStore;
  chunkSize?: number;
}

function chunks(content: string, chunkSize: number): string[] {
  const output: string[] = [];
  for (let index = 0; index < content.length; index += chunkSize) {
    output.push(content.slice(index, index + chunkSize));
  }
  return output.length > 0 ? output : [''];
}

function digestContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function createRagIndexer(options: RagIndexerOptions): {
  index(input: {
    sourceId: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<number>;
  search(input: { query: string; limit?: number }): Promise<ModuleRagSearchResult[]>;
  contextPack(input: { query: string; limit?: number; tokenBudget?: number }): Promise<{
    context: string;
    documents: ModuleRagSearchResult[];
  }>;
  deleteSource(sourceId: string): Promise<number>;
} {
  const chunkSize = options.chunkSize ?? 800;

  return {
    async index(input) {
      const parts = chunks(input.content, chunkSize);
      await options.vectorStore.upsertSource?.({
        productId: options.productId,
        workspaceId: options.workspaceId,
        moduleId: options.moduleId,
        sourceId: input.sourceId,
        status: 'stale',
        contentDigest: digestContent(input.content),
        contentLength: input.content.length,
        chunkCount: 0,
        metadata: input.metadata ?? {},
      });
      let count = 0;
      for (const [index, content] of parts.entries()) {
        const embedding = await options.ai.embedText({
          text: content,
          idempotencyKey: `rag:${input.sourceId}:${index}`,
          metadata: input.metadata,
        });
        await options.vectorStore.upsert({
          id: `${options.productId}:${options.workspaceId ?? 'product'}:${options.moduleId}:${input.sourceId}:${index}`,
          productId: options.productId,
          workspaceId: options.workspaceId,
          moduleId: options.moduleId,
          sourceId: input.sourceId,
          content,
          embedding: embedding.embedding,
          metadata: {
            ...(input.metadata ?? {}),
            sourceId: input.sourceId,
            chunkIndex: index,
            chunkCount: parts.length,
          },
        });
        count += 1;
      }
      await options.vectorStore.upsertSource?.({
        productId: options.productId,
        workspaceId: options.workspaceId,
        moduleId: options.moduleId,
        sourceId: input.sourceId,
        status: 'indexed',
        contentDigest: digestContent(input.content),
        contentLength: input.content.length,
        chunkCount: parts.length,
        metadata: input.metadata ?? {},
      });
      return count;
    },
    async search(input) {
      const embedding = await options.ai.embedText({ text: input.query });
      const results = await options.vectorStore.search({
        productId: options.productId,
        workspaceId: options.workspaceId,
        moduleId: options.moduleId,
        embedding: embedding.embedding,
        limit: input.limit,
      });
      return results.map((record) => ({
        id: record.id,
        content: record.content,
        metadata: record.metadata,
        score: record.score,
      }));
    },
    async contextPack(input) {
      const documents = await this.search(input);
      let used = 0;
      const selected: ModuleRagSearchResult[] = [];
      for (const document of documents) {
        const approximateTokens = Math.ceil(document.content.length / 4);
        if (input.tokenBudget && used + approximateTokens > input.tokenBudget) {
          break;
        }
        used += approximateTokens;
        selected.push(document);
      }
      return {
        context: selected.map((document) => document.content).join('\n\n'),
        documents: selected,
      };
    },
    async deleteSource(sourceId) {
      const deleted = await options.vectorStore.deleteBySource({
        productId: options.productId,
        workspaceId: options.workspaceId,
        moduleId: options.moduleId,
        sourceId,
      });
      await options.vectorStore.upsertSource?.({
        productId: options.productId,
        workspaceId: options.workspaceId,
        moduleId: options.moduleId,
        sourceId,
        status: 'deleted',
        chunkCount: 0,
        metadata: { deletedRecords: deleted },
      });
      return deleted;
    },
  };
}
