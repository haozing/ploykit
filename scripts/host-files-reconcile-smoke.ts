import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  cleanupAdminDeletedFiles,
  deleteAdminFile,
  reconcileAdminFileStorage,
} from '../apps/host-next/lib/admin-files';
import { createHostSessionForUser } from '../apps/host-next/lib/auth';
import { getHostRuntime } from '../apps/host-next/lib/create-host';
import { getHostFileStorage, uploadHostUserFile } from '../apps/host-next/lib/files';

const checkedAt = new Date().toISOString();
const suffix = Date.now().toString(36);
const productId = `files-reconcile-product-${suffix}`;
const workspaceId = `files-reconcile-workspace-${suffix}`;
const session = createHostSessionForUser({
  id: 'files-reconcile-admin',
  email: 'files-reconcile@example.com',
  role: 'admin',
  productId,
  workspaceId,
  workspaceRole: 'owner',
});

const ready = await uploadHostUserFile(session, {
  moduleId: 'web-shell',
  name: `reconcile-ready-${suffix}.txt`,
  purpose: 'source',
  contentType: 'text/plain',
  content: 'files reconcile ready smoke',
});
const deleted = await uploadHostUserFile(session, {
  moduleId: 'web-shell',
  name: `reconcile-deleted-${suffix}.txt`,
  purpose: 'source',
  contentType: 'text/plain',
  content: 'files reconcile deleted smoke',
});
await deleteAdminFile(session, deleted.file.id);

const hostRuntime = await getHostRuntime();
const missing = await hostRuntime.runtimeStore.store.createFile({
  productId,
  workspaceId,
  moduleId: 'web-shell',
  ownerId: session.userId ?? session.user?.id ?? 'demo-admin',
  name: `reconcile-missing-${suffix}.txt`,
  purpose: 'source',
  status: 'ready',
  visibility: 'private',
  contentType: 'text/plain',
  sizeBytes: 64,
  storageKey: `demo-product/demo-workspace/web-shell/reconcile-missing-${suffix}.txt`,
  metadata: { smoke: 'files-reconcile' },
});
const storage = await getHostFileStorage();
const orphanKey = `${productId}/${workspaceId}/web-shell/reconcile-orphan-${suffix}.txt`;
await storage.storage.put({
  key: orphanKey,
  body: new TextEncoder().encode('files reconcile orphan smoke'),
  contentType: 'text/plain',
  metadata: { smoke: 'files-reconcile-orphan' },
});

const report = await reconcileAdminFileStorage({
  productId,
  limit: 500,
  orphanLimit: 5000,
});
const byFileId = new Map(report.items.map((item) => [item.fileId, item]));
const orphan = report.orphans.find((item) => item.key === orphanKey);
const checks = [
  {
    id: 'ready-object-present',
    ok: report.presentObjects > 0 && !byFileId.has(ready.file.id),
  },
  {
    id: 'deleted-object-present-detected',
    ok: byFileId.get(deleted.file.id)?.issue === 'deleted-object-present',
  },
  {
    id: 'missing-active-object-detected',
    ok: byFileId.get(missing.id)?.issue === 'missing-object',
  },
  {
    id: 'orphan-object-detected',
    ok: orphan?.key === orphanKey,
  },
];

for (const check of checks) {
  assert.equal(check.ok, true, `HOST_FILES_RECONCILE_SMOKE_FAILED: ${check.id}`);
}

await deleteAdminFile(session, missing.id);
await cleanupAdminDeletedFiles(session);
await storage.storage.delete(orphanKey);

const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'files-reconcile',
  checkedAt.replace(/[:.]/g, '-')
);
const latestPath = path.resolve(process.cwd(), '.runtime', 'files-reconcile', 'latest.json');
const reportPath = path.join(outputDir, 'files-reconcile-smoke.json');
const result = {
  ok: checks.every((check) => check.ok),
  checkedAt,
  files: {
    ready: ready.file.id,
    deleted: deleted.file.id,
    missing: missing.id,
    orphan: orphanKey,
  },
  checks,
  report: {
    checkedFiles: report.checkedFiles,
    issues: report.issues,
    presentObjects: report.presentObjects,
    missingObjects: report.missingObjects,
    deletedObjectsPresent: report.deletedObjectsPresent,
    missingActiveObjects: report.missingActiveObjects,
    sizeMismatches: report.sizeMismatches,
    checksumMismatches: report.checksumMismatches,
    orphanObjects: report.orphanObjects,
    orphanBytes: report.orphanBytes,
  },
  artifacts: {
    report: reportPath,
    latest: latestPath,
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(latestPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`);
fs.copyFileSync(reportPath, latestPath);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
