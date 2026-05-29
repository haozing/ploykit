import { randomUUID } from 'node:crypto';
import type {
  ModuleArtifactListQuery,
  ModuleArtifactRecord,
  ModuleArtifactWriteInput,
  ModuleArtifactsApi,
  ModuleArtifactTreeNode,
} from '@ploykit/module-sdk';

export interface ModuleArtifactRuntime extends ModuleArtifactsApi {
  forModule(moduleId: string): ModuleArtifactsApi;
}

export interface CreateInMemoryModuleArtifactRuntimeOptions {
  now?: () => Date;
  createId?: () => string;
}

function toIso(now: () => Date): string {
  return now().toISOString();
}

function cloneArtifact<TContent = unknown>(
  artifact: ModuleArtifactRecord<TContent>
): ModuleArtifactRecord<TContent> {
  return {
    ...artifact,
    metadata: { ...artifact.metadata },
  };
}

function normalizeArtifactPath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+/g, '/');
}

function addTreeNode(nodes: ModuleArtifactTreeNode[], artifact: ModuleArtifactRecord): void {
  const parts = normalizeArtifactPath(artifact.path).split('/').filter(Boolean);
  let current = nodes;
  let prefix = '';

  for (const [index, part] of parts.entries()) {
    prefix = prefix ? `${prefix}/${part}` : part;
    const isLeaf = index === parts.length - 1;
    let node = current.find((candidate) => candidate.name === part);
    if (!node) {
      node = {
        name: part,
        path: prefix,
        type: isLeaf ? 'artifact' : 'directory',
        ...(isLeaf ? { artifactId: artifact.id } : { children: [] }),
      };
      current.push(node);
    }
    if (!isLeaf) {
      node.children ??= [];
      current = node.children;
    }
  }
}

export function createInMemoryModuleArtifactRuntime(
  options: CreateInMemoryModuleArtifactRuntimeOptions = {}
): ModuleArtifactRuntime {
  const artifacts = new Map<string, ModuleArtifactRecord>();
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? (() => `artifact_${randomUUID()}`);

  function scoped(moduleId: string): ModuleArtifactsApi {
    const api: ModuleArtifactsApi = {
      async write<TContent = unknown>(input: ModuleArtifactWriteInput<TContent>) {
        const timestamp = toIso(now);
        const artifact: ModuleArtifactRecord<TContent> = {
          id: createId(),
          moduleId,
          name: input.name,
          kind: input.kind,
          path: normalizeArtifactPath(input.path ?? input.name),
          content: input.content,
          runId: input.runId,
          metadata: input.metadata ?? {},
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        artifacts.set(artifact.id, artifact as ModuleArtifactRecord);
        return cloneArtifact(artifact);
      },
      async writeText(input) {
        return api.write<string>({ ...input, kind: 'text' });
      },
      async read<TContent = unknown>(id: string) {
        const artifact = artifacts.get(id);
        if (!artifact || artifact.moduleId !== moduleId) {
          return null;
        }
        return cloneArtifact(artifact as ModuleArtifactRecord<TContent>);
      },
      async readText(id) {
        const artifact = await api.read<string>(id);
        return typeof artifact?.content === 'string' ? artifact.content : null;
      },
      async updateMetadata(id, metadata) {
        const artifact = artifacts.get(id);
        if (!artifact || artifact.moduleId !== moduleId) {
          throw new Error(`MODULE_ARTIFACT_NOT_FOUND: ${id}`);
        }
        const next = {
          ...artifact,
          metadata: { ...artifact.metadata, ...metadata },
          updatedAt: toIso(now),
        };
        artifacts.set(id, next);
        return cloneArtifact(next);
      },
      async list(query: ModuleArtifactListQuery = {}) {
        return [...artifacts.values()]
          .filter((artifact) => artifact.moduleId === moduleId)
          .filter((artifact) => !query.kind || artifact.kind === query.kind)
          .filter((artifact) => !query.runId || artifact.runId === query.runId)
          .filter((artifact) => !query.pathPrefix || artifact.path.startsWith(query.pathPrefix))
          .map((artifact) => cloneArtifact(artifact));
      },
      async tree(query = {}) {
        const nodes: ModuleArtifactTreeNode[] = [];
        const records = await this.list(query);
        for (const artifact of records) {
          addTreeNode(nodes, artifact);
        }
        return nodes;
      },
      async delete(id) {
        const artifact = artifacts.get(id);
        if (artifact?.moduleId === moduleId) {
          artifacts.delete(id);
        }
      },
    };
    return api;
  }

  const runtime = scoped('__host__') as ModuleArtifactRuntime;
  runtime.forModule = scoped;
  return runtime;
}
