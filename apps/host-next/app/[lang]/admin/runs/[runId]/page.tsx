import { AdminRunDetailOperationsPage } from '@host/components/admin/AdminPages';
import { getAdminRunDetail } from '@host/lib/admin-runs';
import { renderHostPageSlotById } from '@host/lib/host-page-rendering';
import { localizedPath } from '@host/lib/i18n';
import {
  cancelAdminRunAction as cancelRunAction,
  requeueAdminRunAction as requeueRunAction,
} from '@host/lib/admin-run-actions';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';

interface AdminRunDetailRouteParams extends LanguageRouteParams {
  runId: string;
}

export default async function AdminRunDetailPage({
  params,
}: {
  params: Promise<AdminRunDetailRouteParams>;
}) {
  const resolved = await params;
  const [lang, session] = await readLanguageAndRequireAdmin(
    Promise.resolve(resolved),
    `/admin/runs/${resolved.runId}`
  );
  const pathname = localizedPath(lang, `/admin/runs/${resolved.runId}`);
  const [detail, mainBefore, mainAfter, side] = await Promise.all([
    getAdminRunDetail(resolved.runId),
    renderHostPageSlotById({
      pageId: 'admin.run-detail',
      slotId: 'main.before',
      pathname,
      session,
      componentProps: { runId: resolved.runId },
    }),
    renderHostPageSlotById({
      pageId: 'admin.run-detail',
      slotId: 'main.after',
      pathname,
      session,
      componentProps: { runId: resolved.runId },
    }),
    renderHostPageSlotById({
      pageId: 'admin.run-detail',
      slotId: 'side',
      pathname,
      session,
      componentProps: { runId: resolved.runId },
    }),
  ]);
  return (
    <AdminRunDetailOperationsPage
      lang={lang}
      detail={detail}
      requeueRunAction={requeueRunAction}
      cancelRunAction={cancelRunAction}
      mainBefore={mainBefore.length > 0 ? mainBefore : null}
      mainAfter={mainAfter.length > 0 ? mainAfter : null}
      side={side.length > 0 ? side : null}
    />
  );
}
