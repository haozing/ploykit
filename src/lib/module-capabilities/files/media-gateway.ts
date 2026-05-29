import { createHmac } from 'node:crypto';
import type { RuntimeStore, RuntimeStoreFileRecord } from '../../module-runtime/stores';
import type { ModuleFileStorageAdapter, ModuleFileStorageRange } from './storage-adapter';

export interface ModuleMediaGatewayResponse {
  status: 200 | 206 | 403 | 404;
  headers: Record<string, string>;
  body?: Uint8Array;
  file?: RuntimeStoreFileRecord;
}

export interface CreateModuleMediaGatewayOptions {
  store: RuntimeStore;
  storage: ModuleFileStorageAdapter;
  productId: string;
  secret?: string;
  basePath?: string;
  now?: () => Date;
}

export interface ModuleMediaGateway {
  createUrl(file: RuntimeStoreFileRecord, options?: { expiresInSeconds?: number }): string;
  resolve(input: {
    fileId: string;
    token?: string;
    range?: ModuleFileStorageRange;
    disposition?: 'inline' | 'attachment';
  }): Promise<ModuleMediaGatewayResponse>;
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function tokenPayload(fileId: string, expiresAt: number): string {
  return `${fileId}.${expiresAt}`;
}

function createToken(secret: string, fileId: string, expiresAt: number): string {
  const payload = tokenPayload(fileId, expiresAt);
  return `${payload}.${sign(secret, payload)}`;
}

function verifyToken(
  secret: string,
  fileId: string,
  token: string | undefined,
  now: () => Date
): boolean {
  if (!token) {
    return false;
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return false;
  }
  const [tokenFileId, expiresAtRaw, signature] = parts;
  const expiresAt = Number(expiresAtRaw);
  if (tokenFileId !== fileId || !Number.isFinite(expiresAt) || expiresAt <= now().getTime()) {
    return false;
  }
  return sign(secret, tokenPayload(fileId, expiresAt)) === signature;
}

export function createModuleMediaGateway(
  options: CreateModuleMediaGatewayOptions
): ModuleMediaGateway {
  const now = options.now ?? (() => new Date());
  const secret = options.secret ?? 'ploykit-dev-media-secret';
  const basePath = options.basePath ?? '/api/media';

  return {
    createUrl(file, urlOptions = {}) {
      const expiresAt = now().getTime() + (urlOptions.expiresInSeconds ?? 300) * 1000;
      const token =
        file.visibility === 'public' ? undefined : createToken(secret, file.id, expiresAt);
      const url = new URL(
        `${basePath.replace(/\/$/, '')}/${encodeURIComponent(file.id)}`,
        'http://localhost'
      );
      if (token) {
        url.searchParams.set('token', token);
      }
      if (file.visibility !== 'public') {
        url.searchParams.set('expiresAt', String(expiresAt));
      }
      return `${url.pathname}${url.search}`;
    },
    async resolve(input) {
      const file = await options.store.getFile(input.fileId);
      if (!file || file.productId !== options.productId || file.status === 'deleted') {
        return { status: 404, headers: {} };
      }
      if (file.visibility !== 'public' && !verifyToken(secret, file.id, input.token, now)) {
        return { status: 403, headers: {} };
      }
      if (!['ready', 'published'].includes(file.status)) {
        return { status: 404, headers: {} };
      }

      const object = await options.storage.get(file.storageKey, input.range);
      if (!object) {
        return { status: 404, headers: {} };
      }

      const headers: Record<string, string> = {
        'content-length': String(object.body.byteLength),
        'accept-ranges': 'bytes',
        'cache-control':
          file.visibility === 'public' ? 'public, max-age=31536000' : 'private, max-age=0',
        'content-disposition': `${input.disposition ?? 'inline'}; filename="${file.name}"`,
        etag: `"${(object.checksum || file.checksum || file.id).replace(/^sha256:/, '')}"`,
      };
      if (object.contentType ?? file.contentType) {
        headers['content-type'] = object.contentType ?? file.contentType!;
      }
      if (input.range) {
        const end = input.range.start + object.body.byteLength - 1;
        headers['content-range'] = `bytes ${input.range.start}-${end}/${file.sizeBytes}`;
      }
      return {
        status: input.range ? 206 : 200,
        headers,
        body: object.body,
        file,
      };
    },
  };
}
