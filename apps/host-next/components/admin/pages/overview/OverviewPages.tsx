import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  Database,
  Plug,
  Server,
  Users,
} from 'lucide-react';
import { adminNav, StatCard, WorkspaceShell } from '@host/components/ProductShell';
import {
  AdminPanel,
  HealthGrid,
  StatGrid,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminOverviewCopy } from '@host/lib/admin-copy';
import type { AdminOperationsSnapshot, RuntimeStoreHostUser } from '@/lib/module-runtime';
import type { AdminProviderStatusView } from '@host/lib/admin-provider-status';
import type { AdminWorkerStatusView } from '@host/lib/admin-worker-status';
import type { HostRuntimeStoreStatus } from '@host/lib/runtime-store';
import {
  buildActivityBuckets,
  buildActivityIndex,
  RecentUsersCard,
  UsageOverviewCard,
} from './OverviewGrowthPanels';
import { AudienceWorkspace, QuickActionPanel } from './OverviewNavigationPanels';
import { RiskQueuePanel, type RiskQueueItem } from './OverviewRiskPanel';

function OverviewPanel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AdminPanel title={title} description={description} action={action}>
      {children}
    </AdminPanel>
  );
}

function healthBadgeValue(ok: boolean | undefined, missing = false): string {
  if (missing) {
    return 'missing';
  }
  return ok ? 'ready' : 'warning';
}

function SystemStatusPanel({
  lang,
  items,
}: {
  lang: SupportedLanguage;
  items: readonly {
    key: string;
    title: string;
    detail: string;
    meta: string;
    status: string;
    icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  }[];
}) {
  const copy = {
    zh: {
      title: '服务健康',
      description: '平台服务当前健康状态。',
      action: '查看服务',
    },
    en: {
      title: 'Service Health',
      description: 'Current health of platform services.',
      action: 'View services',
    },
  }[lang];
  return (
    <AdminPanel
      title={copy.title}
      description={copy.description}
      action={
        <Link
          href={localizedPath(lang, '/admin/service-connections')}
          className="text-xs font-semibold text-admin-primary hover:underline"
        >
          {copy.action}
        </Link>
      }
    >
      <HealthGrid lang={lang} items={items} />
    </AdminPanel>
  );
}

export interface AdminOverviewPageProps {
  lang: SupportedLanguage;
  snapshot?: AdminOperationsSnapshot;
  store?: HostRuntimeStoreStatus;
  users?: RuntimeStoreHostUser[];
  roles?: readonly {
    id: string;
    label: string;
    capabilities: readonly unknown[];
  }[];
  providerStatus?: AdminProviderStatusView;
  workerStatus?: AdminWorkerStatusView;
}

function AdminHomeView({
  lang,
  snapshot,
  store,
  users = [],
  roles = [],
  providerStatus,
  workerStatus,
}: AdminOverviewPageProps) {
  const copy = getAdminOverviewCopy(lang);
  const counts = snapshot?.counts;
  const now = Date.now();
  const recentUsers = users
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 6);
  const activeUsers = users.filter((user) => user.status === 'active').length;
  const newUsers7d = users.filter(
    (user) => now - Date.parse(user.createdAt) <= 7 * 24 * 60 * 60 * 1000
  ).length;
  const adminUsers = users.filter((user) => user.role === 'admin').length;
  const totalCapabilities = roles.reduce((sum, role) => sum + role.capabilities.length, 0);
  const suspendedUsers = users.filter((user) => user.status === 'suspended').length;
  const pendingRisks: RiskQueueItem[] = [
    suspendedUsers > 0
      ? {
          key: 'suspended-users',
          title: copy.risks.accessTitle,
          detail: copy.risks.accessDetail(suspendedUsers),
          action: copy.risks.accessAction,
          status: copy.risks.needsReview,
          href: localizedPath(lang, '/admin/users'),
          tone: 'warning',
        }
      : null,
  ].filter((row): row is RiskQueueItem => Boolean(row));
  const riskItems: RiskQueueItem[] =
    pendingRisks.length > 0
      ? pendingRisks
      : [
          {
            key: 'system-ready',
            title: copy.risks.readyTitle,
            detail: copy.risks.readyDetail,
            action: copy.risks.readyAction,
            status: copy.risks.healthy,
            href: localizedPath(lang, '/admin/users'),
            tone: 'success',
          },
        ];
  const activityBuckets = buildActivityBuckets(lang, users, []);
  const activityIndex = buildActivityIndex(
    activityBuckets.map((bucket) => bucket.value),
    4
  );
  const deadLetterCount =
    snapshot?.recent.outbox.filter((record) => record.status === 'dead_letter').length ?? 0;
  const providerHealthStatus = providerStatus
    ? providerStatus.providersBlocked > 0
      ? 'blocked'
      : providerStatus.providersWarning > 0
        ? 'warning'
        : providerStatus.ok
          ? 'ready'
          : 'warning'
    : 'missing';
  const serviceHealthItems = [
    {
      key: 'runtime-store',
      title: copy.services.database,
      detail: store?.databaseLabel ?? copy.services.memoryMode,
      meta: store?.durable ? copy.services.durable : copy.services.localOnly,
      status: healthBadgeValue(store?.durable),
      icon: Database,
      href: localizedPath(lang, '/admin/settings'),
      tone: store?.durable ? ('success' as const) : ('warning' as const),
    },
    {
      key: 'providers',
      title: adminInlineText(lang, 'Provider matrix'),
      detail: providerStatus
        ? `${providerStatus.providersReady}/${providerStatus.providersTotal} ${adminInlineText(lang, 'Ready')}`
        : adminInlineText(lang, 'not checked'),
      meta: providerStatus
        ? `${providerStatus.providersWarning} ${adminInlineText(lang, 'Warnings')} · ${providerStatus.providersBlocked} ${adminInlineText(lang, 'Blocked')}`
        : '-',
      status: providerHealthStatus,
      icon: Plug,
      href: localizedPath(lang, '/admin/service-connections'),
      tone: providerHealthStatus === 'ready' ? ('success' as const) : ('warning' as const),
    },
    {
      key: 'worker',
      title: adminInlineText(lang, 'Worker Status'),
      detail: workerStatus
        ? `${workerStatus.queue.queued} ${adminInlineText(lang, 'queued')} · ${workerStatus.queue.failed} ${adminInlineText(lang, 'failed')}`
        : adminInlineText(lang, 'not checked'),
      meta: workerStatus?.heartbeatAt ?? adminInlineText(lang, 'missing'),
      status: workerStatus?.heartbeatStatus ?? 'missing',
      icon: Server,
      href: localizedPath(lang, '/admin/runs'),
      tone: workerStatus?.heartbeatStatus === 'ready' ? ('success' as const) : ('warning' as const),
    },
    {
      key: 'outbox',
      title: copy.services.outboxStore,
      detail: copy.services.dead(deadLetterCount),
      meta: copy.services.receipts(counts?.webhookReceipts ?? 0),
      status: deadLetterCount > 0 ? 'warning' : 'ready',
      icon: AlertTriangle,
      href: localizedPath(lang, '/admin/webhooks'),
      tone: deadLetterCount > 0 ? ('warning' as const) : ('success' as const),
    },
  ];

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <div className="grid gap-5">
        <RiskQueuePanel lang={lang} items={riskItems} />
        <StatGrid className="xl:grid-cols-4">
          <StatCard
            label={copy.stat.totalUsers}
            value={String(users.length)}
            helper={copy.stat.activeNew(activeUsers, newUsers7d)}
            trend={newUsers7d > 0 ? `+${newUsers7d} 7d` : 'stable'}
            tone="blue"
            icon={Users}
            href={localizedPath(lang, '/admin/users')}
          />
          <StatCard
            label={copy.stat.activeUsers}
            value={String(activeUsers)}
            helper={copy.today.activeUsers}
            trend={activeUsers > 0 ? copy.stat.healthy : copy.stat.needsReview}
            tone={activeUsers > 0 ? 'green' : 'amber'}
            icon={CheckCircle2}
            href={localizedPath(lang, '/admin/users?status=active')}
          />
          <StatCard
            label={copy.stat.suspendedUsers}
            value={String(suspendedUsers)}
            helper={copy.stat.suspendedHelper(suspendedUsers)}
            trend={suspendedUsers > 0 ? copy.stat.needsReview : copy.stat.healthy}
            sparkline={activityIndex}
            tone={suspendedUsers > 0 ? 'red' : 'green'}
            icon={AlertTriangle}
            href={localizedPath(lang, '/admin/users?status=suspended')}
          />
          <StatCard
            label={copy.stat.roleCoverage}
            value={String(roles.length)}
            helper={copy.stat.roleCoverageHelper(roles.length, totalCapabilities)}
            icon={Clock3}
            href={localizedPath(lang, '/admin/rbac')}
          />
        </StatGrid>
        <QuickActionPanel lang={lang} />
        <AudienceWorkspace lang={lang} />
        <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.45fr)]">
          <OverviewPanel title={copy.today.title} description={copy.today.description}>
            <div className="grid gap-3">
              <div className="flex items-center justify-between rounded-admin-md border border-admin-border px-3 py-2">
                <span className="inline-flex items-center gap-2 text-sm text-admin-text-muted">
                  <CheckCircle2 className="h-4 w-4 text-admin-success" aria-hidden />
                  {copy.today.activeUsers}
                </span>
                <strong className="text-sm text-admin-text">
                  {activeUsers}/{users.length}
                </strong>
              </div>
              <div className="flex items-center justify-between rounded-admin-md border border-admin-border px-3 py-2">
                <span className="inline-flex items-center gap-2 text-sm text-admin-text-muted">
                  <Bell className="h-4 w-4 text-admin-primary" aria-hidden />
                  {copy.today.notifications}
                </span>
                <strong className="text-sm text-admin-text">{counts?.notifications ?? 0}</strong>
              </div>
              <div className="flex items-center justify-between rounded-admin-md border border-admin-border px-3 py-2">
                <span className="inline-flex items-center gap-2 text-sm text-admin-text-muted">
                  <AlertTriangle className="h-4 w-4 text-admin-warning" aria-hidden />
                  {copy.today.roles}
                </span>
                <strong className="text-sm text-admin-text">
                  {roles.length}/{totalCapabilities}
                </strong>
              </div>
              <div className="flex items-center justify-between rounded-admin-md border border-admin-border px-3 py-2">
                <span className="inline-flex items-center gap-2 text-sm text-admin-text-muted">
                  <Clock3 className="h-4 w-4 text-admin-text-subtle" aria-hidden />
                  {copy.today.adminUsers}
                </span>
                <strong className="text-sm text-admin-text">{adminUsers}</strong>
              </div>
            </div>
          </OverviewPanel>
          <SystemStatusPanel lang={lang} items={serviceHealthItems} />
        </section>
      </div>

      <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <RecentUsersCard lang={lang} users={recentUsers} />
        <UsageOverviewCard lang={lang} buckets={activityBuckets} />
      </section>
    </WorkspaceShell>
  );
}

export function AdminOverviewPage(props: AdminOverviewPageProps) {
  return <AdminHomeView {...props} />;
}
