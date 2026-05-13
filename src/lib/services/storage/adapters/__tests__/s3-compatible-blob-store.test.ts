// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';

import { S3CompatibleBlobStore, blobBodyToBuffer } from '../s3-compatible-blob-store.server';

const nodeFetch = globalThis.fetch;

interface StoredBlob {
  body: Buffer;
  contentType: string;
}

const bucket = 'test-bucket';
const objects = new Map<string, StoredBlob>();
let serverUrl = '';
let server: ReturnType<typeof createServer>;

function collectBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('error', reject);
    request.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function keyFromUrl(requestUrl: string | undefined): string | null {
  if (!requestUrl) return null;
  const url = new URL(requestUrl, serverUrl);
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (segments[0] !== bucket || segments.length < 2) {
    return null;
  }

  return segments.slice(1).join('/');
}

function writeText(response: ServerResponse, status: number, body = ''): void {
  response.statusCode = status;
  response.end(body);
}

beforeAll(async () => {
  globalThis.fetch = nodeFetch;
  server = createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      writeText(response, 500, error instanceof Error ? error.message : String(error));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Unexpected test server address');
      }
      serverUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const key = keyFromUrl(request.url);
  const auth =
    request.headers.authorization ||
    new URL(request.url || '/', serverUrl).searchParams.get('X-Amz-Signature');

  if (!auth) {
    writeText(response, 401, 'missing auth');
    return;
  }

  if (!key) {
    writeText(response, 404, 'missing key');
    return;
  }

  if (request.method === 'PUT') {
    const body = await collectBody(request);
    objects.set(key, {
      body,
      contentType: request.headers['content-type'] || 'application/octet-stream',
    });
    response.setHeader('etag', `"${createHash('md5').update(body).digest('hex')}"`);
    writeText(response, 200);
    return;
  }

  if (request.method === 'GET') {
    const stored = objects.get(key);
    if (!stored) {
      writeText(response, 404);
      return;
    }
    response.setHeader('content-type', stored.contentType);
    response.setHeader('content-length', String(stored.body.length));
    response.end(stored.body);
    return;
  }

  if (request.method === 'HEAD') {
    const stored = objects.get(key);
    if (!stored) {
      writeText(response, 404);
      return;
    }
    response.setHeader('content-length', String(stored.body.length));
    response.end();
    return;
  }

  if (request.method === 'DELETE') {
    objects.delete(key);
    writeText(response, 204);
    return;
  }

  writeText(response, 405);
}

afterAll(async () => {
  globalThis.fetch = nodeFetch;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('S3CompatibleBlobStore', () => {
  it('performs put/get/exists/delete against an S3-compatible HTTP endpoint', async () => {
    const store = new S3CompatibleBlobStore({
      endpoint: serverUrl,
      bucket,
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      region: 'auto',
      forcePathStyle: true,
    });
    const key = 'workspace/reports/file.txt';
    const body = Buffer.from('hello object storage', 'utf8');

    const putResult = await store.put({ key, body, contentType: 'text/plain' });
    expect(putResult).toMatchObject({ key, size: body.length });
    expect(await store.exists(key)).toBe(true);

    const stored = await store.get(key);
    expect(stored.contentType).toBe('text/plain');
    expect(await blobBodyToBuffer(stored.body)).toEqual(body);

    await store.delete(key);
    expect(await store.exists(key)).toBe(false);
  });

  it('creates scoped presigned URLs with bounded expiry', async () => {
    const store = new S3CompatibleBlobStore({
      endpoint: serverUrl,
      bucket,
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      region: 'auto',
      forcePathStyle: true,
    });

    const signed = await store.createSignedUrl({
      key: 'workspace/reports/file.txt',
      operation: 'get',
      expiresInSeconds: 60,
    });
    const url = new URL(signed.url);

    expect(url.pathname).toBe('/test-bucket/workspace/reports/file.txt');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(signed.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects path traversal keys before sending requests', async () => {
    const store = new S3CompatibleBlobStore({
      endpoint: serverUrl,
      bucket,
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      region: 'auto',
      forcePathStyle: true,
    });

    await expect(
      store.put({
        key: '../escape.txt',
        body: Buffer.from('nope'),
        contentType: 'text/plain',
      })
    ).rejects.toThrow('Invalid blob key');
  });
});
