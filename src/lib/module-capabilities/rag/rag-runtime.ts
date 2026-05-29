import { randomUUID } from 'node:crypto';
import type { ModuleRagApi, ModuleRagDocument, ModuleRagSearchResult } from '@ploykit/module-sdk';

export interface ModuleRagRuntime extends ModuleRagApi {
  forModule(moduleId: string): ModuleRagApi;
}

function scoreDocument(query: string, content: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = content.toLowerCase();
  return terms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0);
}

export function createInMemoryModuleRagRuntime(): ModuleRagRuntime {
  const documentsByModule = new Map<string, Map<string, ModuleRagDocument>>();

  function scoped(moduleId: string): ModuleRagApi {
    let documents = documentsByModule.get(moduleId);
    if (!documents) {
      documents = new Map();
      documentsByModule.set(moduleId, documents);
    }

    const api: ModuleRagApi = {
      async index(input) {
        const document: ModuleRagDocument = {
          id: input.id ?? `rag_${randomUUID()}`,
          content: input.content,
          metadata: input.metadata ?? {},
        };
        documents.set(document.id, document);
        return { ...document, metadata: { ...document.metadata } };
      },
      async search(input) {
        return [...documents.values()]
          .map(
            (document): ModuleRagSearchResult => ({
              ...document,
              metadata: { ...document.metadata },
              score: scoreDocument(input.query, document.content),
            })
          )
          .filter((document) => document.score > 0)
          .sort((left, right) => right.score - left.score)
          .slice(0, input.limit ?? 5);
      },
      async contextPack(input) {
        const results = await api.search(input);
        return {
          context: results.map((document) => document.content).join('\n\n'),
          documents: results,
        };
      },
      async buildContextPack(input) {
        return api.contextPack(input);
      },
      async delete(id) {
        documents.delete(id);
      },
    };
    return api;
  }

  const runtime = scoped('__host__') as ModuleRagRuntime;
  runtime.forModule = scoped;
  return runtime;
}
