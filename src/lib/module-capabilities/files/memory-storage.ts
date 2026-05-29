import {
  checksumBytes,
  sliceStorageRange,
  type ModuleFileStorageAdapter,
  type ModuleFileStorageHead,
  type ModuleFileStorageObject,
  type ModuleFileStoragePutInput,
  type ModuleFileStorageRange,
  type ModuleFileStorageSignedUrlInput,
} from './storage-adapter';

interface StoredObject extends ModuleFileStorageHead {
  body: Uint8Array;
}

export function createMemoryModuleFileStorage(): ModuleFileStorageAdapter {
  const objects = new Map<string, StoredObject>();

  return {
    kind: 'memory',
    async put(input: ModuleFileStoragePutInput) {
      const head: ModuleFileStorageHead = {
        key: input.key,
        sizeBytes: input.body.byteLength,
        checksum: checksumBytes(input.body),
        contentType: input.contentType,
        metadata: input.metadata ?? {},
      };
      objects.set(input.key, { ...head, body: input.body });
      return { ...head, metadata: { ...head.metadata } };
    },
    async get(key: string, range?: ModuleFileStorageRange) {
      const object = objects.get(key);
      if (!object) {
        return null;
      }
      const body = sliceStorageRange(object.body, range);
      return {
        key,
        body,
        sizeBytes: body.byteLength,
        checksum: object.checksum,
        contentType: object.contentType,
        metadata: { ...object.metadata },
      } satisfies ModuleFileStorageObject;
    },
    async head(key: string) {
      const object = objects.get(key);
      if (!object) {
        return null;
      }
      const { body: _body, ...head } = object;
      return { ...head, metadata: { ...head.metadata } };
    },
    async list(input = {}) {
      return [...objects.values()]
        .filter((object) => !input.prefix || object.key.startsWith(input.prefix))
        .sort((left, right) => left.key.localeCompare(right.key))
        .slice(0, input.limit ?? Number.POSITIVE_INFINITY)
        .map(({ body: _body, ...head }) => ({ ...head, metadata: { ...head.metadata } }));
    },
    async delete(key: string) {
      objects.delete(key);
    },
    async createSignedUrl(input: ModuleFileStorageSignedUrlInput) {
      const url = new URL(`memory-file://${input.key}`);
      url.searchParams.set('operation', input.operation);
      url.searchParams.set('expiresInSeconds', String(input.expiresInSeconds));
      if (input.disposition) {
        url.searchParams.set('disposition', input.disposition);
      }
      return url.toString();
    },
  };
}
