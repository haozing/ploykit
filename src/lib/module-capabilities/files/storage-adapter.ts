import { createHash, randomUUID } from 'node:crypto';

export interface ModuleFileStorageRange {
  start: number;
  end?: number;
}

export interface ModuleFileStoragePutInput {
  key: string;
  body: Uint8Array;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface ModuleFileStorageObject {
  key: string;
  body: Uint8Array;
  sizeBytes: number;
  checksum: string;
  contentType?: string;
  metadata: Record<string, string>;
}

export interface ModuleFileStorageHead {
  key: string;
  sizeBytes: number;
  checksum: string;
  contentType?: string;
  metadata: Record<string, string>;
}

export interface ModuleFileStorageSignedUrlInput {
  key: string;
  operation: 'read' | 'write';
  expiresInSeconds: number;
  disposition?: 'inline' | 'attachment';
}

export interface ModuleFileStorageListInput {
  prefix?: string;
  limit?: number;
}

export interface ModuleFileStorageAdapter {
  readonly kind: string;
  put(input: ModuleFileStoragePutInput): Promise<ModuleFileStorageHead>;
  get(key: string, range?: ModuleFileStorageRange): Promise<ModuleFileStorageObject | null>;
  head(key: string): Promise<ModuleFileStorageHead | null>;
  list?(input?: ModuleFileStorageListInput): Promise<ModuleFileStorageHead[]>;
  delete(key: string): Promise<void>;
  createSignedUrl(input: ModuleFileStorageSignedUrlInput): Promise<string>;
}

export function bytesFromContent(content: string | ArrayBuffer | Uint8Array): Uint8Array {
  if (typeof content === 'string') {
    return new TextEncoder().encode(content);
  }
  if (content instanceof Uint8Array) {
    return content;
  }
  return new Uint8Array(content);
}

export function checksumBytes(body: Uint8Array): string {
  return `sha256:${createHash('sha256').update(body).digest('hex')}`;
}

export function createStorageKey(input: {
  productId: string;
  workspaceId?: string | null;
  moduleId: string;
  fileId?: string;
  name: string;
}): string {
  const safeName = input.name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return [
    input.productId,
    input.workspaceId ?? 'product',
    input.moduleId,
    input.fileId ?? randomUUID(),
    safeName || 'file',
  ].join('/');
}

export function sliceStorageRange(body: Uint8Array, range?: ModuleFileStorageRange): Uint8Array {
  if (!range) {
    return body;
  }
  const start = Math.max(0, range.start);
  const end = range.end === undefined ? body.byteLength : Math.min(body.byteLength, range.end + 1);
  return body.slice(start, end);
}
