import { randomUUID } from 'node:crypto';
import type {
  ModuleFileCreateUploadInput,
  ModuleFileListQuery,
  ModuleFileRecord,
  ModuleFilesApi,
} from '@ploykit/module-sdk';

export interface ModuleFileRuntime extends ModuleFilesApi {
  forModule(moduleId: string): ModuleFilesApi;
  cleanupExpiredUploads(): ModuleFileRecord[];
  verifySignedUrl(url: string): ModuleFileRecord | null;
}

export interface CreateInMemoryModuleFileRuntimeOptions {
  now?: () => Date;
  createId?: () => string;
  defaultSignedUrlSeconds?: number;
}

interface StoredModuleFile extends ModuleFileRecord {
  content?: Uint8Array;
}

interface SignedFileToken {
  fileId: string;
  expiresAt: number;
}

function toIso(now: () => Date): string {
  return now().toISOString();
}

function cloneFile(file: StoredModuleFile): ModuleFileRecord {
  const { content: _content, ...record } = file;
  return {
    ...record,
    metadata: { ...record.metadata },
  };
}

function normalizeExpiresAt(value: ModuleFileCreateUploadInput['expiresAt']): string | undefined {
  if (!value) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function contentSize(content: string | ArrayBuffer | Uint8Array | undefined): number | undefined {
  if (content === undefined) {
    return undefined;
  }
  if (typeof content === 'string') {
    return Buffer.byteLength(content);
  }
  return content.byteLength;
}

function toBytes(content: string | ArrayBuffer | Uint8Array | undefined): Uint8Array | undefined {
  if (content === undefined) {
    return undefined;
  }
  if (typeof content === 'string') {
    return new TextEncoder().encode(content);
  }
  if (content instanceof Uint8Array) {
    return content;
  }
  return new Uint8Array(content);
}

export function createInMemoryModuleFileRuntime(
  options: CreateInMemoryModuleFileRuntimeOptions = {}
): ModuleFileRuntime {
  const files = new Map<string, StoredModuleFile>();
  const tokens = new Map<string, SignedFileToken>();
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? (() => `file_${randomUUID()}`);
  const defaultSignedUrlSeconds = options.defaultSignedUrlSeconds ?? 300;

  function read(id: string, moduleId?: string): StoredModuleFile {
    const file = files.get(id);
    if (!file || file.status === 'deleted') {
      throw new Error(`MODULE_FILE_NOT_FOUND: ${id}`);
    }
    if (moduleId && file.moduleId !== moduleId) {
      throw new Error(`MODULE_FILE_FORBIDDEN: ${id}`);
    }
    return file;
  }

  function save(file: StoredModuleFile): ModuleFileRecord {
    files.set(file.id, file);
    return cloneFile(file);
  }

  function scoped(moduleId: string): ModuleFilesApi {
    const api: ModuleFilesApi = {
      async createUpload(input) {
        const timestamp = toIso(now);
        const file: StoredModuleFile = {
          id: createId(),
          moduleId,
          name: input.name,
          purpose: input.purpose,
          status: 'uploading',
          contentType: input.contentType,
          sizeBytes: input.sizeBytes ?? 0,
          runId: input.runId,
          metadata: input.metadata ?? {},
          createdAt: timestamp,
          updatedAt: timestamp,
          expiresAt: normalizeExpiresAt(input.expiresAt),
        };
        files.set(file.id, file);
        return {
          file: cloneFile(file),
          uploadUrl: `module-file-upload://${file.id}`,
        };
      },
      async createSignedUploadUrl(input) {
        return api.createUpload(input);
      },
      async completeUpload(id, input = {}) {
        const file = read(id, moduleId);
        if (file.status !== 'uploading' && file.status !== 'ready') {
          throw new Error(`MODULE_FILE_UPLOAD_CLOSED: ${id}`);
        }
        const content = toBytes(input.content);
        return save({
          ...file,
          status: 'ready',
          content,
          sizeBytes: input.sizeBytes ?? contentSize(input.content) ?? file.sizeBytes,
          metadata: { ...file.metadata, ...(input.metadata ?? {}) },
          updatedAt: toIso(now),
        });
      },
      async read(id) {
        const file = files.get(id);
        if (!file || file.status === 'deleted' || file.moduleId !== moduleId) {
          return null;
        }
        return cloneFile(file);
      },
      async get(id) {
        return api.read(id);
      },
      async list(query: ModuleFileListQuery = {}) {
        return [...files.values()]
          .filter((file) => file.moduleId === moduleId)
          .filter((file) => file.status !== 'deleted')
          .filter((file) => !query.purpose || file.purpose === query.purpose)
          .filter((file) => !query.status || file.status === query.status)
          .filter((file) => !query.runId || file.runId === query.runId)
          .map((file) => cloneFile(file));
      },
      async createSignedUrl(id, signedUrlOptions = {}) {
        const file = read(id, moduleId);
        if (file.status !== 'ready' && file.status !== 'published') {
          throw new Error(`MODULE_FILE_NOT_READABLE: ${id}`);
        }
        const token = `sig_${randomUUID()}`;
        const expiresAt =
          now().getTime() + (signedUrlOptions.expiresInSeconds ?? defaultSignedUrlSeconds) * 1000;
        tokens.set(token, { fileId: id, expiresAt });
        return `module-file://${id}?token=${encodeURIComponent(token)}&expiresAt=${expiresAt}`;
      },
      async createSignedDownloadUrl(id, signedUrlOptions = {}) {
        return api.createSignedUrl(id, signedUrlOptions);
      },
      async publish(id) {
        const file = read(id, moduleId);
        if (file.status !== 'ready' && file.status !== 'published') {
          throw new Error(`MODULE_FILE_NOT_PUBLISHABLE: ${id}`);
        }
        return save({
          ...file,
          status: 'published',
          publishedAt: file.publishedAt ?? toIso(now),
          updatedAt: toIso(now),
        });
      },
      async unpublish(id) {
        const file = read(id, moduleId);
        if (file.status !== 'published' && file.status !== 'ready') {
          throw new Error(`MODULE_FILE_NOT_PUBLISHED: ${id}`);
        }
        return save({
          ...file,
          status: 'ready',
          visibility: 'private',
          publishedAt: undefined,
          updatedAt: toIso(now),
        });
      },
      async archive(id) {
        const file = read(id, moduleId);
        return save({
          ...file,
          status: 'archived',
          updatedAt: toIso(now),
        });
      },
      async delete(id) {
        const file = files.get(id);
        if (!file || file.moduleId !== moduleId) {
          return;
        }
        files.set(id, {
          ...file,
          status: 'deleted',
          deletedAt: toIso(now),
          updatedAt: toIso(now),
        });
      },
    };
    return api;
  }

  const runtime = scoped('__host__') as ModuleFileRuntime;
  runtime.forModule = scoped;
  runtime.cleanupExpiredUploads = () => {
    const timestamp = now().getTime();
    const deleted: ModuleFileRecord[] = [];
    for (const file of files.values()) {
      if (
        file.status === 'uploading' &&
        file.expiresAt &&
        new Date(file.expiresAt).getTime() <= timestamp
      ) {
        deleted.push(
          save({
            ...file,
            status: 'deleted',
            deletedAt: toIso(now),
            updatedAt: toIso(now),
          })
        );
      }
    }
    return deleted;
  };
  runtime.verifySignedUrl = (url) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'module-file:') {
      return null;
    }
    const token = parsed.searchParams.get('token');
    if (!token) {
      return null;
    }
    const signed = tokens.get(token);
    if (!signed || signed.expiresAt <= now().getTime()) {
      return null;
    }
    const file = files.get(signed.fileId);
    if (!file || file.status === 'deleted') {
      return null;
    }
    return cloneFile(file);
  };

  return runtime;
}
