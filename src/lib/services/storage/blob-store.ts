/**
 * BlobStore Port
 *
 * Abstraction for file storage backends (local, S3, R2, etc.)
 */

export interface BlobStorePutInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface BlobStorePutResult {
  key: string;
  size: number;
  checksum?: string;
}

export interface BlobStoreGetResult {
  body: ReadableStream | Buffer;
  contentType?: string;
  size?: number;
}

export type BlobStoreSignedUrlOperation = 'get' | 'put';

export interface BlobStoreSignedUrlInput {
  key: string;
  operation: BlobStoreSignedUrlOperation;
  expiresInSeconds: number;
  contentType?: string;
}

export interface BlobStoreSignedUrlResult {
  url: string;
  expiresAt: Date;
}

export interface BlobStore {
  put(input: BlobStorePutInput): Promise<BlobStorePutResult>;
  get(key: string): Promise<BlobStoreGetResult>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  createSignedUrl?(input: BlobStoreSignedUrlInput): Promise<BlobStoreSignedUrlResult>;
}

// Global blob store instance (set at startup)
let globalBlobStore: BlobStore | null = null;
let globalBlobStoreDriver: string | null = null;

export function setBlobStore(store: BlobStore, driver = 'custom'): void {
  globalBlobStore = store;
  globalBlobStoreDriver = driver;
}

export function getBlobStore(): BlobStore {
  if (!globalBlobStore) {
    throw new Error('BlobStore not initialized. Call setBlobStore() during startup.');
  }
  return globalBlobStore;
}

export function isBlobStoreInitialized(): boolean {
  return globalBlobStore !== null;
}

export function getBlobStoreDriver(): string | null {
  return globalBlobStoreDriver;
}
