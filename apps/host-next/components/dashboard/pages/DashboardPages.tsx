import { EmptyState, WorkspaceShell } from '@host/components/ProductShell';
import type { SupportedLanguage } from '@host/lib/i18n';
import { getDashboardCopy } from '@host/lib/dashboard-copy';

export { DashboardLandingPage } from './LandingPage';
export { DashboardProfileOperationsPage } from './ProfilePage';
export { DashboardWorkspacesOperationsPage } from './WorkspacesPage';

export function DashboardSimplePage({
  lang,
  title,
  subtitle,
}: {
  lang: SupportedLanguage;
  title: string;
  subtitle: string;
}) {
  const copy = getDashboardCopy(lang).simple;
  return (
    <WorkspaceShell lang={lang} title={title} subtitle={subtitle}>
      <EmptyState title={copy.emptyTitle}>{copy.emptyBody}</EmptyState>
    </WorkspaceShell>
  );
}

export {
  DashboardBillingOperationsPage,
  DashboardCreditHistoryOperationsPage,
  DashboardOrdersOperationsPage,
} from './CommercialPages';

export { DashboardFilesOperationsPage } from './FilePages';

export { DashboardTaskDetailOperationsPage, DashboardTasksOperationsPage } from './TaskPages';
