import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRuntimeStore } from '../src/lib/module-runtime';
import { createMemoryModuleFileStorage } from '../src/lib/module-capabilities';
import { createDemoHostSession } from '../apps/host-next/lib/module-host';
import {
  createHostFileRuntimeFromParts,
  resolveHostFileQuotaPolicy,
  resolveHostFileStorageConfig,
} from '../apps/host-next/lib/files';

test('M6 host file runtime stores file metadata and object content', async () => {
  const store = createInMemoryRuntimeStore();
  const storage = createMemoryModuleFileStorage();
  const files = createHostFileRuntimeFromParts({
    store,
    storage,
    session: createDemoHostSession(),
  }).forModule('public-tool-smoke');
  const upload = await files.createUpload({
    name: 'sample.json',
    purpose: 'source',
    contentType: 'application/json',
  });
  const ready = await files.completeUpload(upload.file.id, { content: '{"ok":true}' });
  const listed = await files.list();

  assert.equal(ready.status, 'ready');
  assert.equal(listed.length, 1);
  assert.match(await files.createSignedUrl(ready.id), /\/api\/media\//);
});

test('M6 host file storage config defaults to local durable storage', () => {
  const config = resolveHostFileStorageConfig({});

  assert.equal(config.mode, 'local');
  assert.match(config.rootDir, /\.runtime[\\/]files$/);
});

test('M6 host file storage config resolves S3-compatible production settings', () => {
  const config = resolveHostFileStorageConfig({
    PLOYKIT_FILE_STORAGE: 's3',
    S3_BUCKET: 'ploykit-files',
    S3_ENDPOINT: 'https://s3.example.com',
    S3_REGION: 'ap-east-1',
    S3_ACCESS_KEY_ID: 'key',
    S3_SECRET_ACCESS_KEY: 'secret',
  });

  assert.equal(config.mode, 's3');
  assert.equal(config.s3Configured, true);
  assert.equal(config.s3?.bucket, 'ploykit-files');
  assert.equal(config.s3?.region, 'ap-east-1');
});

test('X12 host file quota policy supports plan-aware overrides', async () => {
  const env = {
    PLOYKIT_FILE_USER_QUOTA_BYTES: '100',
    PLOYKIT_FILE_WORKSPACE_QUOTA_BYTES: '500',
    PLOYKIT_FILE_MODULE_QUOTA_BYTES: '300',
    PLOYKIT_FILE_PLAN_QUOTAS_JSON: JSON.stringify({
      'demo-pro': {
        perUserBytes: 200,
        perWorkspaceBytes: 800,
      },
    }),
  };
  const session = {
    ...createDemoHostSession(),
    plan: 'demo-pro',
    plans: ['demo-pro'],
  };

  assert.deepEqual(resolveHostFileQuotaPolicy(createDemoHostSession(), env), {
    perUserBytes: 100,
    perWorkspaceBytes: 500,
    perModuleBytes: 300,
    policySource: 'global',
  });
  assert.deepEqual(resolveHostFileQuotaPolicy(session, env), {
    planId: 'demo-pro',
    perUserBytes: 200,
    perWorkspaceBytes: 800,
    perModuleBytes: 300,
    policySource: 'plan',
  });

  const previousUserQuota = process.env.PLOYKIT_FILE_USER_QUOTA_BYTES;
  const previousWorkspaceQuota = process.env.PLOYKIT_FILE_WORKSPACE_QUOTA_BYTES;
  const previousModuleQuota = process.env.PLOYKIT_FILE_MODULE_QUOTA_BYTES;
  const previousPlanQuotas = process.env.PLOYKIT_FILE_PLAN_QUOTAS_JSON;
  const restoreEnv = (name: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  };
  try {
    process.env.PLOYKIT_FILE_USER_QUOTA_BYTES = env.PLOYKIT_FILE_USER_QUOTA_BYTES;
    process.env.PLOYKIT_FILE_WORKSPACE_QUOTA_BYTES = env.PLOYKIT_FILE_WORKSPACE_QUOTA_BYTES;
    process.env.PLOYKIT_FILE_MODULE_QUOTA_BYTES = env.PLOYKIT_FILE_MODULE_QUOTA_BYTES;
    process.env.PLOYKIT_FILE_PLAN_QUOTAS_JSON = env.PLOYKIT_FILE_PLAN_QUOTAS_JSON;
    const runtime = createHostFileRuntimeFromParts({
      store: createInMemoryRuntimeStore(),
      storage: createMemoryModuleFileStorage(),
      session,
    });
    const upload = await runtime.forModule('public-tool-smoke').createUpload({
      name: 'plan-quota.txt',
      purpose: 'source',
      sizeBytes: 150,
      contentType: 'text/plain',
    });
    const ready = await runtime
      .forModule('public-tool-smoke')
      .completeUpload(upload.file.id, { content: 'x'.repeat(150), sizeBytes: 150 });

    assert.equal(ready.sizeBytes, 150);
  } finally {
    restoreEnv('PLOYKIT_FILE_USER_QUOTA_BYTES', previousUserQuota);
    restoreEnv('PLOYKIT_FILE_WORKSPACE_QUOTA_BYTES', previousWorkspaceQuota);
    restoreEnv('PLOYKIT_FILE_MODULE_QUOTA_BYTES', previousModuleQuota);
    restoreEnv('PLOYKIT_FILE_PLAN_QUOTAS_JSON', previousPlanQuotas);
  }
});
