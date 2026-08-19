import assert from 'node:assert/strict';
import {
  mkdtemp,
  rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createInMemoryRuntimeStore,
} from '../src/lib/module-runtime';
import {
  createLocalModuleFileStorage,
  createMemoryModuleFileStorage,
  createS3CompatibleHttpClient,
  createS3CompatibleModuleFileStorage,
  createStorageBackedModuleFileRuntime,
  type ModuleFileStorageAdapter,
  type S3CompatibleStorageClient,
} from '../src/lib/module-capabilities';

function createFakeS3Client(): S3CompatibleStorageClient {
  const storage = createMemoryModuleFileStorage();
  const keyFor = (bucket: string, key: string) => `${bucket}/${key}`;
  return {
    async putObject(input) {
      return storage.put({ ...input, key: keyFor(input.bucket, input.key) });
    },
    async getObject(bucket, key, range) {
      return storage.get(keyFor(bucket, key), range);
    },
    async headObject(bucket, key) {
      return storage.head(keyFor(bucket, key));
    },
    async listObjects(bucket, input = {}) {
      const prefix = input.prefix ? keyFor(bucket, input.prefix) : `${bucket}/`;
      const objects = await storage.list?.({ prefix, limit: input.limit });
      return (objects ?? []).map((object) => ({
        ...object,
        key: object.key.slice(`${bucket}/`.length),
      }));
    },
    async deleteObject(bucket, key) {
      await storage.delete(keyFor(bucket, key));
    },
    async createSignedUrl(input) {
      return `s3-test://${input.bucket}/${input.key}?operation=${input.operation}&ttl=${input.expiresInSeconds}`;
    },
  };
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function createFakeS3HttpFetch() {
  const objects = new Map<
    string,
    {
      body: Uint8Array;
      checksum: string;
      contentType?: string;
      metadata: Record<string, string>;
    }
  >();
  const requests: { method: string; url: URL; headers: Headers }[] = [];
  const fetchImpl = async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(input.toString());
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    const key = decodeURIComponent(url.pathname.replace(/^\/test-bucket\//, ''));
    requests.push({ method, url, headers });

    if (method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const limit = Number(url.searchParams.get('max-keys') ?? Number.POSITIVE_INFINITY);
      const contents = [...objects.entries()]
        .filter(([objectKey]) => objectKey.startsWith(prefix))
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, Number.isFinite(limit) ? limit : undefined)
        .map(([objectKey, object]) =>
          [
            '<Contents>',
            `<Key>${objectKey}</Key>`,
            `<Size>${object.body.byteLength}</Size>`,
            `<ETag>"${object.checksum}"</ETag>`,
            '</Contents>',
          ].join('')
        )
        .join('');
      return new Response(`<ListBucketResult>${contents}</ListBucketResult>`, {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      });
    }

    if (method === 'PUT') {
      const body = new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer());
      const metadata: Record<string, string> = {};
      for (const [name, value] of headers.entries()) {
        if (name.startsWith('x-amz-meta-') && name !== 'x-amz-meta-checksum') {
          metadata[name.slice('x-amz-meta-'.length)] = value;
        }
      }
      objects.set(key, {
        body,
        checksum: headers.get('x-amz-meta-checksum') ?? '',
        contentType: headers.get('content-type') ?? undefined,
        metadata,
      });
      return new Response(null, { status: 200 });
    }

    if (method === 'DELETE') {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }

    const object = objects.get(key);
    if (!object) {
      return new Response(null, { status: 404 });
    }

    const responseHeaders = new Headers({
      'content-length': String(object.body.byteLength),
      'x-amz-meta-checksum': object.checksum,
    });
    if (object.contentType) {
      responseHeaders.set('content-type', object.contentType);
    }
    for (const [name, value] of Object.entries(object.metadata)) {
      responseHeaders.set(`x-amz-meta-${name}`, value);
    }

    if (method === 'HEAD') {
      return new Response(null, { status: 200, headers: responseHeaders });
    }

    const rangeHeader = headers.get('range');
    if (rangeHeader) {
      const [, startValue, endValue] = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader) ?? [];
      const start = Number(startValue);
      const end = endValue ? Number(endValue) + 1 : object.body.byteLength;
      return new Response(copyArrayBuffer(object.body.slice(start, end)), {
        status: 206,
        headers: responseHeaders,
      });
    }

    return new Response(copyArrayBuffer(object.body), { status: 200, headers: responseHeaders });
  };
  return { fetchImpl, requests };
}

async function storageAdapters(): Promise<
  { name: string; storage: ModuleFileStorageAdapter; cleanup?: () => Promise<void> }[]
> {
  const localRoot = await mkdtemp(path.join(tmpdir(), 'ploykit-files-'));
  return [
    { name: 'memory', storage: createMemoryModuleFileStorage() },
    {
      name: 'local',
      storage: createLocalModuleFileStorage({ rootDir: localRoot }),
      cleanup: () => rm(localRoot, { force: true, recursive: true }),
    },
    {
      name: 's3-compatible',
      storage: createS3CompatibleModuleFileStorage({
        bucket: 'test-bucket',
        client: createFakeS3Client(),
      }),
    },
  ];
}

test('P16 local, memory and S3-compatible storage adapters share the same object contract', async () => {
  for (const candidate of await storageAdapters()) {
    try {
      const put = await candidate.storage.put({
        key: 'product/module/file.txt',
        body: new TextEncoder().encode('hello world'),
        contentType: 'text/plain',
        metadata: { source: candidate.name },
      });
      const head = await candidate.storage.head('product/module/file.txt');
      const range = await candidate.storage.get('product/module/file.txt', { start: 6 });
      const signedUrl = await candidate.storage.createSignedUrl({
        key: 'product/module/file.txt',
        operation: 'read',
        expiresInSeconds: 60,
      });
      const listed = await candidate.storage.list?.({ prefix: 'product/module/' });

      assert.equal(head?.checksum, put.checksum, candidate.name);
      assert.equal(new TextDecoder().decode(range?.body), 'world', candidate.name);
      assert.match(signedUrl, /operation=read/, candidate.name);
      assert.equal(listed?.[0]?.key, 'product/module/file.txt', candidate.name);

      await candidate.storage.delete('product/module/file.txt');
      assert.equal(await candidate.storage.head('product/module/file.txt'), null, candidate.name);
    } finally {
      await candidate.cleanup?.();
    }
  }
});

test('M6 S3-compatible HTTP client signs object requests and creates presigned URLs', async () => {
  const fake = createFakeS3HttpFetch();
  const storage = createS3CompatibleModuleFileStorage({
    bucket: 'test-bucket',
    client: createS3CompatibleHttpClient({
      endpoint: 'https://s3.test.local',
      region: 'us-east-1',
      accessKeyId: 'AKIA_TEST',
      secretAccessKey: 'secret',
      fetch: fake.fetchImpl,
      now: () => new Date('2026-05-19T00:00:00.000Z'),
    }),
  });

  const put = await storage.put({
    key: 'demo/source.json',
    body: new TextEncoder().encode('{"ok":true}'),
    contentType: 'application/json',
    metadata: { module: 'public-tool-smoke' },
  });
  const head = await storage.head('demo/source.json');
  const range = await storage.get('demo/source.json', { start: 6, end: 9 });
  const signedUrl = await storage.createSignedUrl({
    key: 'demo/source.json',
    operation: 'read',
    expiresInSeconds: 60,
  });
  const listed = await storage.list?.({ prefix: 'demo/' });

  assert.equal(head?.checksum, put.checksum);
  assert.equal(head?.metadata.module, 'public-tool-smoke');
  assert.equal(new TextDecoder().decode(range?.body), 'true');
  assert.match(
    fake.requests[0]?.headers.get('authorization') ?? '',
    /^AWS4-HMAC-SHA256 Credential=/
  );
  assert.match(signedUrl, /X-Amz-Signature=/);
  assert.match(signedUrl, /X-Amz-Credential=AKIA_TEST/);
  assert.equal(listed?.[0]?.key, 'demo/source.json');

  await storage.delete('demo/source.json');
  assert.equal(await storage.head('demo/source.json'), null);
});

test('P16 storage backed file runtime enforces policy, signed private media, public gateway and cleanup', async () => {
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-19T00:00:00.000Z'),
    createId: (() => {
      let nextId = 0;
      return (prefix: string) => `${prefix}_${++nextId}`;
    })(),
  });
  const storage = createMemoryModuleFileStorage();
  const runtime = createStorageBackedModuleFileRuntime({
    store,
    storage,
    productId: 'product-a',
    workspaceId: 'workspace-a',
    ownerId: 'user-1',
    mediaSecret: 'test-secret',
    uploadPolicy: {
      maxBytes: 10,
      allowedMimeTypes: ['text/plain'],
      allowedExtensions: ['.txt'],
      allowPublic: true,
    },
    quota: {
      perUserBytes: 5,
      perWorkspaceBytes: 20,
      perModuleBytes: 10,
    },
  });
  const moduleFiles = runtime.forModule('files-test');

  await assert.rejects(
    () =>
      moduleFiles.createUpload({
        name: 'bad.png',
        purpose: 'source',
        contentType: 'image/png',
      }),
    /MODULE_FILE_UPLOAD_MIME_DENIED/
  );

  const upload = await moduleFiles.createUpload({
    name: 'source.txt',
    purpose: 'source',
    contentType: 'text/plain',
  });
  const ready = await moduleFiles.completeUpload(upload.file.id, { content: 'hello' });
  const privateUrl = await moduleFiles.createSignedUrl(ready.id);
  const privateToken =
    new URL(`http://localhost${privateUrl}`).searchParams.get('token') ?? undefined;

  assert.equal(ready.status, 'ready');
  assert.equal(ready.sizeBytes, 5);
  assert.equal((await runtime.mediaGateway.resolve({ fileId: ready.id })).status, 403);
  assert.equal(
    (await runtime.mediaGateway.resolve({ fileId: ready.id, token: privateToken })).status,
    200
  );
  const ranged = await runtime.mediaGateway.resolve({
    fileId: ready.id,
    token: privateToken,
    range: { start: 1, end: 3 },
    disposition: 'attachment',
  });
  assert.equal(ranged.status, 206);
  assert.equal(new TextDecoder().decode(ranged.body), 'ell');
  assert.equal(ranged.headers['content-range'], 'bytes 1-3/5');
  assert.match(ranged.headers['content-disposition'], /attachment/);
  assert.equal(ranged.headers['accept-ranges'], 'bytes');

  await assert.rejects(
    () =>
      moduleFiles.createUpload({
        name: 'quota.txt',
        purpose: 'source',
        contentType: 'text/plain',
        sizeBytes: 1,
      }),
    /MODULE_FILE_QUOTA_USER_EXCEEDED/
  );

  const published = await moduleFiles.publish(ready.id);
  const publicUrl = await moduleFiles.createSignedUrl(published.id);
  assert.equal(new URL(`http://localhost${publicUrl}`).searchParams.get('token'), null);
  assert.equal((await runtime.mediaGateway.resolve({ fileId: ready.id })).status, 200);
  assert.equal((await runtime.admin.list({ moduleId: 'files-test' })).length, 1);

  await moduleFiles.delete(ready.id);
  assert.equal((await runtime.mediaGateway.resolve({ fileId: ready.id })).status, 404);
  assert.equal((await runtime.cleanupDeletedFiles())[0].id, ready.id);
  assert.equal(await storage.head(published.storageKey!), null);
});

test('P16 storage backed file runtime validates stored mime types on completion', async () => {
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-19T00:00:00.000Z'),
    createId: (() => {
      let nextId = 0;
      return (prefix: string) => `${prefix}_${++nextId}`;
    })(),
  });
  const storage = createMemoryModuleFileStorage();
  const runtime = createStorageBackedModuleFileRuntime({
    store,
    storage,
    productId: 'product-a',
    workspaceId: 'workspace-a',
    ownerId: 'user-1',
    mediaSecret: 'test-secret',
    uploadPolicy: {
      maxBytes: 20,
      allowedMimeTypes: ['text/plain', 'application/json'],
      allowedExtensions: ['.txt', '.json'],
      allowPublic: true,
    },
  });
  const moduleFiles = runtime.forModule('files-test');

  const upload = await moduleFiles.createUpload({
    name: 'mime.txt',
    purpose: 'source',
    contentType: 'text/plain',
  });
  await storage.put({
    key: upload.file.storageKey!,
    body: new TextEncoder().encode('hello'),
    contentType: 'image/png',
    metadata: {},
  });

  await assert.rejects(
    () => moduleFiles.completeUpload(upload.file.id),
    /MODULE_FILE_UPLOAD_MIME_DENIED/
  );

  const inferredUpload = await moduleFiles.createUpload({
    name: 'source.json',
    purpose: 'source',
  });
  const inferred = await moduleFiles.completeUpload(inferredUpload.file.id, {
    content: '{"ok":true}',
  });
  assert.equal(inferred.contentType, 'application/json');
});

test('P16 storage backed file runtime runs antivirus hooks and uses actual size for quota', async () => {
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-19T00:00:00.000Z'),
    createId: (() => {
      let nextId = 0;
      return (prefix: string) => `${prefix}_${++nextId}`;
    })(),
  });
  const storage = createMemoryModuleFileStorage();
  const antivirusCalls: {
    fileId?: string;
    storageKey?: string;
    checksum?: string;
    name: string;
    contentType?: string;
    sizeBytes: number;
  }[] = [];
  const runtime = createStorageBackedModuleFileRuntime({
    store,
    storage,
    productId: 'product-a',
    workspaceId: 'workspace-a',
    ownerId: 'user-1',
    mediaSecret: 'test-secret',
    uploadPolicy: {
      maxBytes: 10,
      allowedMimeTypes: ['text/plain'],
      allowedExtensions: ['.txt'],
      allowPublic: true,
      antivirus: async (input) => {
        antivirusCalls.push(input);
        return input.name === 'virus.txt' ? { ok: false, reason: 'infected' } : { ok: true };
      },
    },
    quota: {
      perUserBytes: 4,
      perWorkspaceBytes: 20,
      perModuleBytes: 10,
    },
  });
  const moduleFiles = runtime.forModule('files-test');

  const upload = await moduleFiles.createUpload({
    name: 'quota.txt',
    purpose: 'source',
    contentType: 'text/plain',
  });

  await assert.rejects(
    () => moduleFiles.completeUpload(upload.file.id, { content: 'hello', sizeBytes: 1 }),
    /MODULE_FILE_QUOTA_USER_EXCEEDED/
  );
  assert.equal(antivirusCalls.length, 1);
  assert.equal(antivirusCalls[0]?.fileId, upload.file.id);
  assert.equal(antivirusCalls[0]?.storageKey, upload.file.storageKey);
  assert.match(antivirusCalls[0]?.checksum ?? '', /^sha256:/);
  assert.equal(antivirusCalls[0]?.sizeBytes, 5);
  assert.equal(antivirusCalls[0]?.contentType, 'text/plain');
  assert.equal((await moduleFiles.read(upload.file.id))?.status, 'uploading');

  const virusUpload = await moduleFiles.createUpload({
    name: 'virus.txt',
    purpose: 'source',
    contentType: 'text/plain',
  });
  await assert.rejects(
    () => moduleFiles.completeUpload(virusUpload.file.id, { content: 'x' }),
    /MODULE_FILE_UPLOAD_ANTIVIRUS_DENIED/
  );
  assert.equal(antivirusCalls.length, 2);
  assert.equal(antivirusCalls[1]?.sizeBytes, 1);
  const quarantined = await moduleFiles.read(virusUpload.file.id);
  assert.equal(quarantined?.status, 'quarantined');
  assert.match(String(quarantined?.metadata.antivirusReason), /infected/);
});

test('P35 storage backed cleanup is workspace scoped and expires stale uploads', async () => {
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-19T00:00:00.000Z'),
    createId: (() => {
      let nextId = 0;
      return (prefix: string) => `${prefix}_${++nextId}`;
    })(),
  });
  const storage = createMemoryModuleFileStorage();
  const runtimeA = createStorageBackedModuleFileRuntime({
    store,
    storage,
    productId: 'product-a',
    workspaceId: 'workspace-a',
    ownerId: 'user-1',
    mediaSecret: 'test-secret',
  });
  const runtimeB = createStorageBackedModuleFileRuntime({
    store,
    storage,
    productId: 'product-a',
    workspaceId: 'workspace-b',
    ownerId: 'user-1',
    mediaSecret: 'test-secret',
  });
  const filesA = runtimeA.forModule('files-test');
  const filesB = runtimeB.forModule('files-test');

  const uploadA = await filesA.createUpload({
    name: 'deleted-a.txt',
    purpose: 'source',
    contentType: 'text/plain',
  });
  const uploadB = await filesB.createUpload({
    name: 'deleted-b.txt',
    purpose: 'source',
    contentType: 'text/plain',
  });
  const readyA = await filesA.completeUpload(uploadA.file.id, { content: 'a' });
  const readyB = await filesB.completeUpload(uploadB.file.id, { content: 'b' });
  await filesA.delete(readyA.id);
  await filesB.delete(readyB.id);

  const cleanedDeleted = await runtimeA.cleanupDeletedFiles();
  assert.deepEqual(cleanedDeleted.map((file) => file.id), [readyA.id]);
  assert.equal(await storage.head(readyA.storageKey!), null);
  assert.notEqual(await storage.head(readyB.storageKey!), null);

  const expiredA = await filesA.createUpload({
    name: 'expired-a.txt',
    purpose: 'source',
    contentType: 'text/plain',
    expiresAt: new Date('2026-05-18T00:00:00.000Z'),
  });
  const expiredB = await filesB.createUpload({
    name: 'expired-b.txt',
    purpose: 'source',
    contentType: 'text/plain',
    expiresAt: new Date('2026-05-18T00:00:00.000Z'),
  });
  await storage.put({
    key: expiredA.file.storageKey!,
    body: new TextEncoder().encode('stale-a'),
    contentType: 'text/plain',
    metadata: {},
  });
  await storage.put({
    key: expiredB.file.storageKey!,
    body: new TextEncoder().encode('stale-b'),
    contentType: 'text/plain',
    metadata: {},
  });

  await assert.rejects(
    () => filesA.completeUpload(expiredA.file.id),
    /MODULE_FILE_UPLOAD_EXPIRED/
  );
  assert.equal(await storage.head(expiredA.file.storageKey!), null);
  assert.equal((await store.getFile(expiredA.file.id))?.status, 'deleted');

  const cleanupExpiredA = await filesA.createUpload({
    name: 'cleanup-expired-a.txt',
    purpose: 'source',
    contentType: 'text/plain',
    expiresAt: new Date('2026-05-18T00:00:00.000Z'),
  });
  await storage.put({
    key: cleanupExpiredA.file.storageKey!,
    body: new TextEncoder().encode('cleanup-stale-a'),
    contentType: 'text/plain',
    metadata: {},
  });

  const cleanedExpired = await runtimeA.cleanupExpiredUploads();
  assert.deepEqual(cleanedExpired.map((file) => file.id), [cleanupExpiredA.file.id]);
  assert.equal(await storage.head(cleanupExpiredA.file.storageKey!), null);
  assert.notEqual(await storage.head(expiredB.file.storageKey!), null);
  assert.equal((await filesB.read(expiredB.file.id))?.status, 'uploading');
});
