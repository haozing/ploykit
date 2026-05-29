import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInMemoryModuleArtifactRuntime,
  createInMemoryModuleFileRuntime,
  createInMemoryModuleNotificationRuntime,
} from '../src/lib/module-capabilities';

test('file runtime supports upload completion, signed URL expiry, and cleanup', async () => {
  let current = new Date('2026-01-01T00:00:00.000Z');
  const files = createInMemoryModuleFileRuntime({
    now: () => current,
    defaultSignedUrlSeconds: 60,
  });
  const moduleFiles = files.forModule('files-test');
  const upload = await moduleFiles.createUpload({
    name: 'source.txt',
    purpose: 'source',
    contentType: 'text/plain',
    expiresAt: new Date('2026-01-01T00:10:00.000Z'),
  });
  const ready = await moduleFiles.completeUpload(upload.file.id, {
    content: 'hello',
  });
  const signedUrl = await moduleFiles.createSignedUrl(ready.id);

  assert.equal(ready.status, 'ready');
  assert.equal(ready.sizeBytes, 5);
  assert.equal(files.verifySignedUrl(signedUrl)?.id, ready.id);

  current = new Date('2026-01-01T00:01:01.000Z');
  assert.equal(files.verifySignedUrl(signedUrl), null);

  const expired = await moduleFiles.createUpload({
    name: 'expired.tmp',
    purpose: 'temp',
    expiresAt: new Date('2025-12-31T23:59:00.000Z'),
  });
  const cleaned = files.cleanupExpiredUploads();

  assert.equal(cleaned[0].id, expired.file.id);
  assert.equal(await moduleFiles.read(expired.file.id), null);

  await moduleFiles.delete(ready.id);
  assert.equal(await moduleFiles.read(ready.id), null);
});

test('artifact runtime writes, trees, filters, and deletes artifacts', async () => {
  const artifacts = createInMemoryModuleArtifactRuntime();
  const moduleArtifacts = artifacts.forModule('artifact-test');
  const first = await moduleArtifacts.write({
    name: 'report',
    kind: 'markdown',
    path: 'reports/monthly/report.md',
    content: '# Report',
    metadata: { month: '2026-01' },
  });
  await moduleArtifacts.write({
    name: 'summary',
    kind: 'json',
    path: 'reports/monthly/summary.json',
    content: { ok: true },
  });

  assert.equal((await moduleArtifacts.read(first.id))?.metadata.month, '2026-01');
  assert.equal((await moduleArtifacts.list({ kind: 'json' })).length, 1);
  assert.equal((await moduleArtifacts.tree())[0].name, 'reports');

  await moduleArtifacts.delete(first.id);
  assert.equal(await moduleArtifacts.read(first.id), null);
});

test('notification runtime sends, filters, and marks in-app notifications read', async () => {
  const notifications = createInMemoryModuleNotificationRuntime();
  const moduleNotifications = notifications.forModule('notify-test');
  const notification = await moduleNotifications.send({
    userId: 'user_1',
    title: 'Done',
    runId: 'run_1',
  });

  assert.equal((await moduleNotifications.list({ status: 'unread' })).length, 1);
  assert.equal((await moduleNotifications.list({ userId: 'user_2' })).length, 0);

  const read = await moduleNotifications.markRead(notification.id);
  assert.equal(read.status, 'read');
  assert.equal((await moduleNotifications.list({ status: 'read' })).length, 1);
});
