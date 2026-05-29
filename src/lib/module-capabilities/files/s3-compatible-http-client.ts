import { createHash, createHmac } from 'node:crypto';
import {
  checksumBytes,
  sliceStorageRange,
  type ModuleFileStorageHead,
  type ModuleFileStorageListInput,
  type ModuleFileStorageObject,
  type ModuleFileStoragePutInput,
  type ModuleFileStorageRange,
  type ModuleFileStorageSignedUrlInput,
} from './storage-adapter';
import type { S3CompatibleStorageClient } from './s3-storage';

export type S3CompatibleHttpFetch = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export interface CreateS3CompatibleHttpClientOptions {
  endpoint: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  forcePathStyle?: boolean;
  publicEndpoint?: string;
  fetch?: S3CompatibleHttpFetch;
  now?: () => Date;
}

const EMPTY_PAYLOAD_HASH = createHash('sha256').update('').digest('hex');
const SERVICE = 's3';
const TERMINATOR = 'aws4_request';

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function normalizeEndpoint(value: string): URL {
  const endpoint = new URL(value);
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, '');
  return endpoint;
}

function joinPath(...segments: string[]): string {
  return `/${segments
    .map((segment) => segment.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')}`;
}

function createObjectUrl(input: {
  endpoint: string;
  bucket: string;
  key: string;
  forcePathStyle: boolean;
}): URL {
  const endpoint = normalizeEndpoint(input.endpoint);
  const url = new URL(endpoint.toString());
  if (input.forcePathStyle) {
    url.pathname = joinPath(endpoint.pathname, input.bucket, input.key);
    return url;
  }

  url.hostname = `${input.bucket}.${endpoint.hostname}`;
  url.pathname = joinPath(endpoint.pathname, input.key);
  return url;
}

function createBucketUrl(input: {
  endpoint: string;
  bucket: string;
  forcePathStyle: boolean;
}): URL {
  const endpoint = normalizeEndpoint(input.endpoint);
  const url = new URL(endpoint.toString());
  if (input.forcePathStyle) {
    url.pathname = joinPath(endpoint.pathname, input.bucket);
    return url;
  }

  url.hostname = `${input.bucket}.${endpoint.hostname}`;
  url.pathname = endpoint.pathname || '/';
  return url;
}

function amzDate(date: Date): { dateTime: string; dateStamp: string } {
  const dateTime = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    dateTime,
    dateStamp: dateTime.slice(0, 8),
  };
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function hexHmac(key: Buffer, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

function signingKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, TERMINATOR);
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashBytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function canonicalHeaders(headers: Record<string, string>): {
  canonical: string;
  signedHeaders: string;
} {
  const entries = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), normalizeHeaderValue(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return {
    canonical: entries.map(([name, value]) => `${name}:${value}\n`).join(''),
    signedHeaders: entries.map(([name]) => name).join(';'),
  };
}

function canonicalQuery(searchParams: URLSearchParams): string {
  return [...searchParams.entries()]
    .sort(([leftName, leftValue], [rightName, rightValue]) => {
      const nameCompare = leftName.localeCompare(rightName);
      return nameCompare === 0 ? leftValue.localeCompare(rightValue) : nameCompare;
    })
    .map(([name, value]) => `${encodeRfc3986(name)}=${encodeRfc3986(value)}`)
    .join('&');
}

function scope(dateStamp: string, region: string): string {
  return `${dateStamp}/${region}/${SERVICE}/${TERMINATOR}`;
}

function signCanonicalRequest(input: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  dateStamp: string;
  amzDateTime?: string;
  region: string;
  secretAccessKey: string;
}): string {
  const canonical = canonicalHeaders(input.headers);
  const request = [
    input.method,
    input.url.pathname,
    canonicalQuery(input.url.searchParams),
    canonical.canonical,
    canonical.signedHeaders,
    input.payloadHash,
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    input.amzDateTime ?? input.headers['x-amz-date'],
    scope(input.dateStamp, input.region),
    hashText(request),
  ].join('\n');
  return hexHmac(signingKey(input.secretAccessKey, input.dateStamp, input.region), stringToSign);
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function responseMetadata(headers: Headers): {
  checksum?: string;
  metadata: Record<string, string>;
} {
  const metadata: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    if (name.startsWith('x-amz-meta-')) {
      metadata[name.slice('x-amz-meta-'.length)] = value;
    }
  }
  const checksum = metadata.checksum;
  delete metadata.checksum;
  return { checksum, metadata };
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function readXmlTag(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(xml);
  return match ? decodeXml(match[1] ?? '') : undefined;
}

function parseListObjectsV2(xml: string): ModuleFileStorageHead[] {
  const contents = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? [];
  return contents.map((content) => {
    const key = readXmlTag(content, 'Key') ?? '';
    const size = Number(readXmlTag(content, 'Size') ?? 0);
    const etag = readXmlTag(content, 'ETag')?.replace(/^"|"$/g, '');
    return {
      key,
      sizeBytes: Number.isFinite(size) ? size : 0,
      checksum: etag ? `etag:${etag}` : 'unknown',
      metadata: {},
    };
  });
}

function signedHeaders(input: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  date: Date;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}): Record<string, string> {
  const { dateTime, dateStamp } = amzDate(input.date);
  const requestHeaders: Record<string, string> = {
    ...input.headers,
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': dateTime,
  };
  if (input.sessionToken) {
    requestHeaders['x-amz-security-token'] = input.sessionToken;
  }
  const headersForSignature = {
    ...requestHeaders,
    host: input.url.host,
  };
  const canonical = canonicalHeaders(headersForSignature);
  const signature = signCanonicalRequest({
    method: input.method,
    url: input.url,
    headers: headersForSignature,
    payloadHash: input.payloadHash,
    dateStamp,
    region: input.region,
    secretAccessKey: input.secretAccessKey,
  });
  return {
    ...requestHeaders,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope(
      dateStamp,
      input.region
    )}, SignedHeaders=${canonical.signedHeaders}, Signature=${signature}`,
  };
}

function addMetadataHeaders(
  headers: Record<string, string>,
  metadata: Record<string, string> | undefined,
  checksum: string
): Record<string, string> {
  const next: Record<string, string> = { ...headers, 'x-amz-meta-checksum': checksum };
  for (const [name, value] of Object.entries(metadata ?? {})) {
    next[`x-amz-meta-${name.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`] = value;
  }
  return next;
}

async function ensureOk(response: Response, operation: string): Promise<void> {
  if (response.ok) {
    return;
  }
  throw new Error(`S3_COMPATIBLE_${operation}_FAILED: ${response.status} ${await response.text()}`);
}

export function createS3CompatibleHttpClient(
  options: CreateS3CompatibleHttpClientOptions
): S3CompatibleStorageClient {
  const region = options.region ?? 'us-east-1';
  const fetchImpl = options.fetch ?? fetch;
  const forcePathStyle = options.forcePathStyle ?? true;
  const now = options.now ?? (() => new Date());

  function objectUrl(bucket: string, key: string, signed = false): URL {
    return createObjectUrl({
      endpoint: signed ? (options.publicEndpoint ?? options.endpoint) : options.endpoint,
      bucket,
      key,
      forcePathStyle,
    });
  }

  function bucketUrl(bucket: string): URL {
    return createBucketUrl({
      endpoint: options.endpoint,
      bucket,
      forcePathStyle,
    });
  }

  async function request(input: {
    method: string;
    url: URL;
    headers?: Record<string, string>;
    body?: Uint8Array;
  }): Promise<Response> {
    const payloadHash = input.body ? hashBytes(input.body) : EMPTY_PAYLOAD_HASH;
    const headers = signedHeaders({
      method: input.method,
      url: input.url,
      headers: input.headers ?? {},
      payloadHash,
      date: now(),
      region,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      sessionToken: options.sessionToken,
    });
    return fetchImpl(input.url, {
      method: input.method,
      headers,
      body: input.body ? copyArrayBuffer(input.body) : undefined,
    });
  }

  return {
    async putObject(input: ModuleFileStoragePutInput & { bucket: string }) {
      const checksum = checksumBytes(input.body);
      const headers = addMetadataHeaders(
        input.contentType ? { 'content-type': input.contentType } : {},
        input.metadata,
        checksum
      );
      const response = await request({
        method: 'PUT',
        url: objectUrl(input.bucket, input.key),
        headers,
        body: input.body,
      });
      await ensureOk(response, 'PUT');
      return {
        key: input.key,
        sizeBytes: input.body.byteLength,
        checksum,
        contentType: input.contentType,
        metadata: input.metadata ?? {},
      } satisfies ModuleFileStorageHead;
    },
    async getObject(bucket: string, key: string, range?: ModuleFileStorageRange) {
      const response = await request({
        method: 'GET',
        url: objectUrl(bucket, key),
        headers: range
          ? { range: `bytes=${range.start}-${range.end === undefined ? '' : range.end}` }
          : undefined,
      });
      if (response.status === 404) {
        return null;
      }
      await ensureOk(response, 'GET');
      const body = sliceStorageRange(
        new Uint8Array(await response.arrayBuffer()),
        response.status === 206 ? undefined : range
      );
      const metadata = responseMetadata(response.headers);
      return {
        key,
        body,
        sizeBytes: body.byteLength,
        checksum: metadata.checksum ?? checksumBytes(body),
        contentType: response.headers.get('content-type') ?? undefined,
        metadata: metadata.metadata,
      } satisfies ModuleFileStorageObject;
    },
    async headObject(bucket: string, key: string) {
      const response = await request({
        method: 'HEAD',
        url: objectUrl(bucket, key),
      });
      if (response.status === 404) {
        return null;
      }
      await ensureOk(response, 'HEAD');
      const metadata = responseMetadata(response.headers);
      const contentLength = Number(response.headers.get('content-length') ?? 0);
      return {
        key,
        sizeBytes: Number.isFinite(contentLength) ? contentLength : 0,
        checksum:
          metadata.checksum ??
          (response.headers.get('etag') ? `etag:${response.headers.get('etag')}` : 'unknown'),
        contentType: response.headers.get('content-type') ?? undefined,
        metadata: metadata.metadata,
      } satisfies ModuleFileStorageHead;
    },
    async listObjects(bucket: string, input: ModuleFileStorageListInput = {}) {
      const url = bucketUrl(bucket);
      url.searchParams.set('list-type', '2');
      if (input.prefix) {
        url.searchParams.set('prefix', input.prefix);
      }
      if (input.limit !== undefined) {
        url.searchParams.set('max-keys', String(input.limit));
      }
      const response = await request({
        method: 'GET',
        url,
      });
      if (response.status === 404) {
        return [];
      }
      await ensureOk(response, 'LIST');
      return parseListObjectsV2(await response.text()).slice(0, input.limit);
    },
    async deleteObject(bucket: string, key: string) {
      const response = await request({
        method: 'DELETE',
        url: objectUrl(bucket, key),
      });
      if (response.status !== 404) {
        await ensureOk(response, 'DELETE');
      }
    },
    async createSignedUrl(input: ModuleFileStorageSignedUrlInput & { bucket: string }) {
      const method = input.operation === 'write' ? 'PUT' : 'GET';
      const url = objectUrl(input.bucket, input.key, true);
      const { dateTime, dateStamp } = amzDate(now());
      url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
      url.searchParams.set('X-Amz-Credential', `${options.accessKeyId}/${scope(dateStamp, region)}`);
      url.searchParams.set('X-Amz-Date', dateTime);
      url.searchParams.set('X-Amz-Expires', String(input.expiresInSeconds));
      url.searchParams.set('X-Amz-SignedHeaders', 'host');
      if (options.sessionToken) {
        url.searchParams.set('X-Amz-Security-Token', options.sessionToken);
      }
      if (input.disposition && input.operation === 'read') {
        url.searchParams.set('response-content-disposition', input.disposition);
      }
      const signature = signCanonicalRequest({
        method,
        url,
        headers: {
          host: url.host,
        },
        payloadHash: 'UNSIGNED-PAYLOAD',
        dateStamp,
        amzDateTime: dateTime,
        region,
        secretAccessKey: options.secretAccessKey,
      });
      url.searchParams.set('X-Amz-Signature', signature);
      return url.toString();
    },
  };
}
