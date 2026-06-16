import fs from 'node:fs';
import path from 'node:path';
import { cleanupAdminDeletedFiles, deleteAdminFile } from '../apps/host-next/lib/admin-files';
import { getHostRuntime } from '../apps/host-next/lib/create-host';
import { getHostFileStorage, uploadHostUserFile } from '../apps/host-next/lib/files';
import { createDemoHostSession } from '../apps/host-next/lib/module-host';

const checkedAt = new Date().toISOString();
const session = createDemoHostSession();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const upload = await uploadHostUserFile(session, {
  moduleId: 'public-tools-demo',
  name: `cleanup-smoke-${suffix}.txt`,
  purpose: 'source',
  contentType: 'text/plain',
  visibility: 'private',
  content: `cleanup smoke ${checkedAt}`,
});
const hostRuntime = await getHostRuntime();
const beforeDelete = await hostRuntime.runtimeStore.store.getFile(upload.file.id);
if (!beforeDelete) {
  throw new Error('FILES_CLEANUP_SMOKE_FILE_NOT_FOUND');
}

await deleteAdminFile(session, upload.file.id);
const cleaned = await cleanupAdminDeletedFiles(session);
const afterCleanup = await hostRuntime.runtimeStore.store.getFile(upload.file.id);
const storage = await getHostFileStorage();
const objectAfterCleanup = await storage.storage.head(beforeDelete.storageKey);
const audit = await hostRuntime.runtimeStore.store.listAudit({
  productId: session.productId ?? 'demo-product',
});
const cleanupAudit = audit.find(
  (record) =>
    record.type === 'admin.file.cleanup_deleted' &&
    typeof record.metadata.deleted === 'number' &&
    record.metadata.deleted >= 1
);
const ok =
  cleaned.some((file) => file.id === upload.file.id) &&
  afterCleanup?.status === 'deleted' &&
  objectAfterCleanup === null &&
  Boolean(cleanupAudit);

const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'files-cleanup',
  checkedAt.replace(/[:.]/g, '-')
);
const latestPath = path.resolve(process.cwd(), '.runtime', 'files-cleanup', 'latest.json');
const reportPath = path.join(outputDir, 'files-cleanup-smoke.json');
const result = {
  ok,
  checkedAt,
  file: {
    id: upload.file.id,
    status: afterCleanup?.status,
    storageKey: beforeDelete.storageKey,
    objectDeleted: objectAfterCleanup === null,
  },
  cleanup: {
    matched: cleaned.length,
    cleanedFileIds: cleaned.map((file) => file.id),
    auditId: cleanupAudit?.id,
  },
  storage: {
    mode: storage.status.mode,
    durable: storage.status.durable,
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
process.exitCode = ok ? 0 : 1;
