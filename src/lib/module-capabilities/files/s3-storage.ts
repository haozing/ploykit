import type {
  ModuleFileStorageAdapter,
  ModuleFileStorageHead,
  ModuleFileStorageListInput,
  ModuleFileStorageObject,
  ModuleFileStoragePutInput,
  ModuleFileStorageRange,
  ModuleFileStorageSignedUrlInput,
} from './storage-adapter';

export interface S3CompatibleStorageClient {
  putObject(input: ModuleFileStoragePutInput & { bucket: string }): Promise<ModuleFileStorageHead>;
  getObject(
    bucket: string,
    key: string,
    range?: ModuleFileStorageRange
  ): Promise<ModuleFileStorageObject | null>;
  headObject(bucket: string, key: string): Promise<ModuleFileStorageHead | null>;
  listObjects(bucket: string, input?: ModuleFileStorageListInput): Promise<ModuleFileStorageHead[]>;
  deleteObject(bucket: string, key: string): Promise<void>;
  createSignedUrl(input: ModuleFileStorageSignedUrlInput & { bucket: string }): Promise<string>;
}

export interface CreateS3CompatibleModuleFileStorageOptions {
  bucket: string;
  client: S3CompatibleStorageClient;
}

export function createS3CompatibleModuleFileStorage(
  options: CreateS3CompatibleModuleFileStorageOptions
): ModuleFileStorageAdapter {
  return {
    kind: 's3-compatible',
    put(input) {
      return options.client.putObject({ ...input, bucket: options.bucket });
    },
    get(key, range) {
      return options.client.getObject(options.bucket, key, range);
    },
    head(key) {
      return options.client.headObject(options.bucket, key);
    },
    list(input) {
      return options.client.listObjects(options.bucket, input);
    },
    delete(key) {
      return options.client.deleteObject(options.bucket, key);
    },
    createSignedUrl(input) {
      return options.client.createSignedUrl({ ...input, bucket: options.bucket });
    },
  };
}
