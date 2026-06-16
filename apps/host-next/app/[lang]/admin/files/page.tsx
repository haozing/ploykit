import { AdminFilesOperationsPage } from '@host/components/admin/AdminPages';
import {
  archiveAdminFile,
  bulkUpdateAdminFiles,
  cleanupAdminDeletedFiles,
  deleteAdminFile,
  getAdminFilesView,
  quarantineAdminFile,
  restoreAdminFile,
} from '@host/lib/admin-files';
import { createAdminAction } from '@host/lib/admin-action';
import { getHostFileQuotaStatus } from '@host/lib/files';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';
import { readAdminTableQuery, type RouteSearchParams } from '@host/lib/table-query';

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`ADMIN_FORM_FIELD_REQUIRED: ${name}`);
  }
  return value;
}

const quarantineFileAction = createAdminAction({
  id: 'files.quarantine',
  parse: (formData) => ({
    fileId: readRequiredFormString(formData, 'fileId'),
    reason: readRequiredFormString(formData, 'reason'),
  }),
  run: async ({ session, input }) => quarantineAdminFile(session, input.fileId, input.reason),
  revalidate: () => ['/admin/files'],
  audit: { metadata: ({ input }) => ({ fileId: input.fileId, reason: input.reason }) },
});

const restoreFileAction = createAdminAction({
  id: 'files.restore',
  parse: (formData) => ({ fileId: readRequiredFormString(formData, 'fileId') }),
  run: async ({ session, input }) => restoreAdminFile(session, input.fileId),
  revalidate: () => ['/admin/files'],
  audit: { metadata: ({ input }) => ({ fileId: input.fileId }) },
});

const archiveFileAction = createAdminAction({
  id: 'files.archive',
  parse: (formData) => ({ fileId: readRequiredFormString(formData, 'fileId') }),
  run: async ({ session, input }) => archiveAdminFile(session, input.fileId),
  revalidate: () => ['/admin/files'],
  audit: { metadata: ({ input }) => ({ fileId: input.fileId }) },
});

const deleteFileAction = createAdminAction({
  id: 'files.delete',
  parse: (formData) => ({ fileId: readRequiredFormString(formData, 'fileId') }),
  run: async ({ session, input }) => deleteAdminFile(session, input.fileId),
  revalidate: () => ['/admin/files'],
  audit: { metadata: ({ input }) => ({ fileId: input.fileId }) },
});

const cleanupDeletedFilesAction = createAdminAction({
  id: 'files.cleanupDeleted',
  run: async ({ session }) => cleanupAdminDeletedFiles(session),
  revalidate: () => ['/admin/files'],
});

const bulkFileAction = createAdminAction({
  id: 'files.bulkUpdate',
  parse: (formData) => {
    const rawAction = readRequiredFormString(formData, 'action');
    if (rawAction !== 'archive' && rawAction !== 'delete') {
      throw new Error(`ADMIN_FILE_BULK_ACTION_UNSUPPORTED: ${rawAction}`);
    }
    const action: 'archive' | 'delete' = rawAction;
    return {
      action,
      fileIds: readRequiredFormString(formData, 'fileIds')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      reason: formData.get('reason')?.toString(),
    };
  },
  run: async ({ session, input }) => bulkUpdateAdminFiles(session, input),
  revalidate: () => ['/admin/files'],
  audit: { metadata: ({ input }) => ({ action: input.action, fileCount: input.fileIds.length }) },
});

export default async function AdminFilesPage({
  params,
  searchParams,
}: {
  params: Promise<LanguageRouteParams>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const [lang, session] = await readLanguageAndRequireAdmin(params, '/admin/files');
  const query = await readAdminTableQuery(searchParams);
  const view = await getAdminFilesView();
  return (
    <AdminFilesOperationsPage
      lang={lang}
      quota={await getHostFileQuotaStatus(session)}
      files={view.files}
      storage={view.storage}
      reconcile={view.reconcile}
      quarantineFileAction={quarantineFileAction}
      restoreFileAction={restoreFileAction}
      archiveFileAction={archiveFileAction}
      deleteFileAction={deleteFileAction}
      cleanupDeletedFilesAction={cleanupDeletedFilesAction}
      bulkFileAction={bulkFileAction}
      query={query}
    />
  );
}
