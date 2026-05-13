import { createHash, createHmac } from 'node:crypto';

import { NotFoundError } from '@/lib/_core/errors';
import type {
  BlobStore,
  BlobStoreGetResult,
  BlobStorePutInput,
  BlobStorePutResult,
  BlobStoreSignedUrlInput,
  BlobStoreSignedUrlResult,
} from '../blob-store';

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
const DEFAULT_REGION = 'auto';

export interface S3CompatibleBlobStoreOptions {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  forcePathStyle?: boolean;
  publicBaseUrl?: string;
}

interface SignedRequest {
  url: URL;
  headers: Record<string, string>;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function toDateStamp(date: Date): string {
  return toAmzDate(date).slice(0, 8);
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function normalizeKey(key: string): string {
  if (!key || key.startsWith('/') || key.includes('\\')) {
    throw new Error('Invalid blob key');
  }

  const parts = key.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Invalid blob key');
  }

  return parts.map(encodePathSegment).join('/');
}

function normalizeEndpoint(endpoint: string): URL {
  const parsed = new URL(endpoint);
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed;
}

function objectUrl(options: S3CompatibleBlobStoreOptions, key: string): URL {
  const endpoint = normalizeEndpoint(options.endpoint);
  const normalizedKey = normalizeKey(key);
  const forcePathStyle = options.forcePathStyle ?? true;
  const basePath = endpoint.pathname === '/' ? '' : endpoint.pathname.replace(/\/+$/, '');

  if (forcePathStyle) {
    endpoint.pathname = `${basePath}/${encodePathSegment(options.bucket)}/${normalizedKey}`;
    return endpoint;
  }

  endpoint.hostname = `${options.bucket}.${endpoint.hostname}`;
  endpoint.pathname = `${basePath}/${normalizedKey}`;
  return endpoint;
}

function canonicalQuery(params: URLSearchParams): string {
  return Array.from(params.entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) return leftValue.localeCompare(rightValue);
      return leftKey.localeCompare(rightKey);
    })
    .map(([key, value]) => `${encodePathSegment(key)}=${encodePathSegment(value)}`)
    .join('&');
}

function signingKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, 's3');
  return hmac(serviceKey, 'aws4_request');
}

function buildCanonicalHeaders(headers: Record<string, string>): {
  canonicalHeaders: string;
  signedHeaders: string;
} {
  const normalized = Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), value.trim()] as const)
    .sort(([left], [right]) => left.localeCompare(right));

  return {
    canonicalHeaders: normalized.map(([key, value]) => `${key}:${value}\n`).join(''),
    signedHeaders: normalized.map(([key]) => key).join(';'),
  };
}

function signRequest(options: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  now?: Date;
}): SignedRequest {
  const now = options.now ?? new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = toDateStamp(now);
  const scope = `${dateStamp}/${options.region}/s3/aws4_request`;
  const headers = {
    ...options.headers,
    host: options.url.host,
    'x-amz-content-sha256': options.payloadHash,
    'x-amz-date': amzDate,
  };
  const { canonicalHeaders, signedHeaders } = buildCanonicalHeaders(headers);
  const canonicalRequest = [
    options.method.toUpperCase(),
    options.url.pathname,
    canonicalQuery(options.url.searchParams),
    canonicalHeaders,
    signedHeaders,
    options.payloadHash,
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = createHmac(
    'sha256',
    signingKey(options.secretAccessKey, dateStamp, options.region)
  )
    .update(stringToSign)
    .digest('hex');

  return {
    url: options.url,
    headers: {
      ...headers,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

function presignUrl(options: {
  method: string;
  url: URL;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  expiresInSeconds: number;
  now?: Date;
  contentType?: string;
}): URL {
  const now = options.now ?? new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = toDateStamp(now);
  const scope = `${dateStamp}/${options.region}/s3/aws4_request`;
  const signedHeaders = options.contentType ? 'content-type;host' : 'host';
  const headers: Record<string, string> = { host: options.url.host };
  if (options.contentType) {
    headers['content-type'] = options.contentType;
  }
  const signedUrl = new URL(options.url);

  signedUrl.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  signedUrl.searchParams.set('X-Amz-Credential', `${options.accessKeyId}/${scope}`);
  signedUrl.searchParams.set('X-Amz-Date', amzDate);
  signedUrl.searchParams.set('X-Amz-Expires', String(options.expiresInSeconds));
  signedUrl.searchParams.set('X-Amz-SignedHeaders', signedHeaders);

  const { canonicalHeaders } = buildCanonicalHeaders(headers);
  const canonicalRequest = [
    options.method.toUpperCase(),
    signedUrl.pathname,
    canonicalQuery(signedUrl.searchParams),
    canonicalHeaders,
    signedHeaders,
    UNSIGNED_PAYLOAD,
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = createHmac(
    'sha256',
    signingKey(options.secretAccessKey, dateStamp, options.region)
  )
    .update(stringToSign)
    .digest('hex');

  signedUrl.searchParams.set('X-Amz-Signature', signature);
  return signedUrl;
}

async function responseToBuffer(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer());
}

async function streamToBuffer(stream: ReadableStream): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks);
}

function isNotFound(status: number): boolean {
  return status === 404 || status === 403;
}

export class S3CompatibleBlobStore implements BlobStore {
  private readonly region: string;
  private readonly forcePathStyle: boolean;

  constructor(private readonly options: S3CompatibleBlobStoreOptions) {
    this.region = options.region || DEFAULT_REGION;
    this.forcePathStyle = options.forcePathStyle ?? true;
  }

  async put(input: BlobStorePutInput): Promise<BlobStorePutResult> {
    const url = objectUrl({ ...this.options, forcePathStyle: this.forcePathStyle }, input.key);
    const signed = signRequest({
      method: 'PUT',
      url,
      headers: {
        'content-length': String(input.body.length),
        'content-type': input.contentType,
      },
      payloadHash: sha256Hex(input.body),
      accessKeyId: this.options.accessKeyId,
      secretAccessKey: this.options.secretAccessKey,
      region: this.region,
    });
    const response = await fetch(signed.url, {
      method: 'PUT',
      headers: signed.headers,
      body: new Uint8Array(input.body),
    });

    if (!response.ok) {
      throw new Error(`S3-compatible put failed with HTTP ${response.status}`);
    }

    return {
      key: input.key,
      size: input.body.length,
      checksum: response.headers.get('etag')?.replaceAll('"', '') || sha256Hex(input.body),
    };
  }

  async get(key: string): Promise<BlobStoreGetResult> {
    const url = objectUrl({ ...this.options, forcePathStyle: this.forcePathStyle }, key);
    const signed = signRequest({
      method: 'GET',
      url,
      headers: {},
      payloadHash: EMPTY_SHA256,
      accessKeyId: this.options.accessKeyId,
      secretAccessKey: this.options.secretAccessKey,
      region: this.region,
    });
    const response = await fetch(signed.url, {
      method: 'GET',
      headers: signed.headers,
    });

    if (!response.ok) {
      if (isNotFound(response.status)) {
        throw new NotFoundError('Blob', key);
      }
      throw new Error(`S3-compatible get failed with HTTP ${response.status}`);
    }

    return {
      body: await responseToBuffer(response),
      contentType: response.headers.get('content-type') || undefined,
      size: Number(response.headers.get('content-length') || 0) || undefined,
    };
  }

  async delete(key: string): Promise<void> {
    const url = objectUrl({ ...this.options, forcePathStyle: this.forcePathStyle }, key);
    const signed = signRequest({
      method: 'DELETE',
      url,
      headers: {},
      payloadHash: EMPTY_SHA256,
      accessKeyId: this.options.accessKeyId,
      secretAccessKey: this.options.secretAccessKey,
      region: this.region,
    });
    const response = await fetch(signed.url, {
      method: 'DELETE',
      headers: signed.headers,
    });

    if (!response.ok && !isNotFound(response.status)) {
      throw new Error(`S3-compatible delete failed with HTTP ${response.status}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    const url = objectUrl({ ...this.options, forcePathStyle: this.forcePathStyle }, key);
    const signed = signRequest({
      method: 'HEAD',
      url,
      headers: {},
      payloadHash: EMPTY_SHA256,
      accessKeyId: this.options.accessKeyId,
      secretAccessKey: this.options.secretAccessKey,
      region: this.region,
    });
    const response = await fetch(signed.url, {
      method: 'HEAD',
      headers: signed.headers,
    });

    if (response.ok) {
      return true;
    }

    if (isNotFound(response.status)) {
      return false;
    }

    throw new Error(`S3-compatible exists probe failed with HTTP ${response.status}`);
  }

  async createSignedUrl(input: BlobStoreSignedUrlInput): Promise<BlobStoreSignedUrlResult> {
    const method = input.operation === 'put' ? 'PUT' : 'GET';
    const expiresInSeconds = Math.max(1, Math.min(input.expiresInSeconds, 7 * 24 * 60 * 60));
    const now = new Date();
    const baseUrl = objectUrl(
      {
        ...this.options,
        endpoint: this.options.publicBaseUrl || this.options.endpoint,
        forcePathStyle: this.forcePathStyle,
      },
      input.key
    );
    const url = presignUrl({
      method,
      url: baseUrl,
      accessKeyId: this.options.accessKeyId,
      secretAccessKey: this.options.secretAccessKey,
      region: this.region,
      expiresInSeconds,
      now,
      contentType: input.operation === 'put' ? input.contentType : undefined,
    });

    return {
      url: url.toString(),
      expiresAt: new Date(now.getTime() + expiresInSeconds * 1000),
    };
  }
}

export async function blobBodyToBuffer(body: BlobStoreGetResult['body']): Promise<Buffer> {
  return Buffer.isBuffer(body) ? body : streamToBuffer(body);
}
