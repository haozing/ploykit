import Link from 'next/link';
import {
  adminNav,
  StatCard,
  WorkspaceShell,
} from '@host/components/ProductShell';
import { Input, Select } from '@host/components/ui';
import {
  ActionPanel,
  AdminPanel,
  FactList,
  SegmentedWorkspace,
  StatGrid,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminAnalyticsCopy } from '@host/lib/admin-copy';
import type { AdminTableQuery } from '@host/lib/table-query';
import { UsageAnalyticsCharts } from './UsageAnalyticsCharts';
import {
  UsageAnalyticsDataQualityPanel,
  UsageAnalyticsEvidence,
} from './UsageAnalyticsEvidence';
import {
  buildAnalyticsEvidenceModel,
  type AdminAnalyticsData,
} from './UsageAnalyticsPageModel';

function cleanTableQuery(query?: AdminTableQuery): Required<AdminTableQuery> {
  return {
    q: query?.q?.trim() ?? '',
    status: query?.status?.trim() ?? '',
    role: query?.role?.trim() ?? '',
    type: query?.type?.trim() ?? '',
    moduleId: query?.moduleId?.trim() ?? '',
    service: query?.service?.trim() ?? '',
    workspace: query?.workspace?.trim() ?? '',
    environment: query?.environment?.trim() ?? '',
    range: query?.range?.trim() ?? '',
    from: query?.from?.trim() ?? '',
    to: query?.to?.trim() ?? '',
    owner: query?.owner?.trim() ?? '',
    mime: query?.mime?.trim() ?? '',
    provider: query?.provider?.trim() ?? '',
    path: query?.path?.trim() ?? '',
    minSize: query?.minSize ?? 0,
    maxSize: query?.maxSize ?? 0,
    page: query?.page ?? 1,
    pageSize: query?.pageSize ?? 20,
    operation: query?.operation?.trim() ?? '',
    outcome: query?.outcome?.trim() ?? '',
    matched: query?.matched ?? 0,
    processed: query?.processed ?? 0,
    failed: query?.failed ?? 0,
    skipped: query?.skipped ?? 0,
    deadLettered: query?.deadLettered ?? 0,
  };
}

export function AdminAnalyticsOperationsPage({
  lang,
  analytics,
  query,
}: {
  lang: SupportedLanguage;
  analytics: AdminAnalyticsData;
  query?: AdminTableQuery;
}) {
  const copy = getAdminAnalyticsCopy(lang);
  const tableQuery = cleanTableQuery(query);
  const analyticsModel = buildAnalyticsEvidenceModel(analytics);
  const reliabilityBlocked =
    analytics.reliability.failedRuns > 0 ||
    analytics.reliability.failedWebhooks > 0 ||
    analytics.reliability.deadLetters > 0 ||
    analytics.reliability.p95LatencyMs > 1000;
  const insight = reliabilityBlocked
    ? {
        title: adminInlineText(lang, 'auto_insight_reliability_needs_attention_09a3d973'),
        description: adminInlineText(
          lang,
          'the_selected_window_has_value_failed_runs_value_fail_f487384c',
          {
            value1: analytics.reliability.failedRuns,
            value2: analytics.reliability.failedWebhooks,
            value3: analytics.reliability.deadLetters,
            value4: analytics.reliability.p95LatencyMs,
          }
        ),
        tone: 'warning' as const,
        href: localizedPath(lang, '/admin/runs?status=failed'),
        label: adminInlineText(lang, 'review_reliability_396baa87'),
      }
    : {
        title: adminInlineText(lang, 'auto_insight_business_signals_are_safe_to_watch_d9c28e22'),
        description: adminInlineText(
          lang,
          'revenue_value_mrr_value_signups_value_no_blocking_re_02b73db6',
          {
            value1: analytics.revenueMetrics.revenue ?? 0,
            value2: analytics.revenueMetrics.mrr ?? 0,
            value3: analytics.growthMetrics.signups ?? 0,
          }
        ),
        tone: 'success' as const,
        href: localizedPath(lang, '/admin/revenue'),
        label: adminInlineText(lang, 'view_revenue_7f0cbea9'),
      };
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <StatGrid>
        <StatCard
          label={adminInlineText(lang, 'Users')}
          value={String(analytics.counts.users ?? 0)}
          tone="blue"
        />
        <StatCard
          label={adminInlineText(lang, 'Revenue')}
          value={String(analytics.revenueMetrics.revenue ?? 0)}
          tone="green"
        />
        <StatCard
          label={adminInlineText(lang, 'MRR')}
          value={String(analytics.revenueMetrics.mrr ?? 0)}
        />
        <StatCard
          label={adminInlineText(lang, 'Signups')}
          value={String(analytics.growthMetrics.signups ?? 0)}
          tone="amber"
        />
      </StatGrid>
      <AdminPanel
        title={adminInlineText(lang, 'Analytics range')}
        description={adminInlineText(lang, 'current_window_value_value_to_value_13de8835', {
          value1: analytics.range.label,
          value2: analytics.range.from,
          value3: analytics.range.to,
        })}
      >
        <form
          method="get"
          className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
        >
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span className="text-xs font-semibold uppercase text-admin-text-subtle">
              {adminInlineText(lang, 'Range')}
            </span>
            <Select
              name="range"
              defaultValue={tableQuery.range || '7d'}
              aria-label={adminInlineText(lang, 'Analytics range')}
            >
              <option value="24h">24h</option>
              <option value="7d">7d</option>
              <option value="30d">30d</option>
              <option value="90d">90d</option>
              <option value="custom">{adminInlineText(lang, 'Custom')}</option>
            </Select>
          </label>
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span className="text-xs font-semibold uppercase text-admin-text-subtle">
              {adminInlineText(lang, 'From')}
            </span>
            <Input
              name="from"
              defaultValue={tableQuery.from}
              placeholder="2026-05-01"
              aria-label={adminInlineText(lang, 'From date')}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span className="text-xs font-semibold uppercase text-admin-text-subtle">
              {adminInlineText(lang, 'To')}
            </span>
            <Input
              name="to"
              defaultValue={tableQuery.to}
              placeholder="2026-05-21"
              aria-label={adminInlineText(lang, 'To date')}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="inline-flex min-h-9 items-center justify-center rounded-admin-md bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
            >
              {adminInlineText(lang, 'Apply')}
            </button>
            <Link
              href={localizedPath(lang, '/admin/analytics')}
              className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
            >
              {adminInlineText(lang, 'Reset')}
            </Link>
          </div>
        </form>
      </AdminPanel>
      <ActionPanel
        title={insight.title}
        description={insight.description}
        tone={insight.tone}
        actions={
          <Link
            href={insight.href}
            className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 py-1.5 text-xs font-semibold text-admin-primary transition hover:bg-admin-primary/10"
          >
            {insight.label}
          </Link>
        }
      />
      <SegmentedWorkspace
        lang={lang}
        title={adminInlineText(lang, 'analysis_views_f7340f73')}
        description={adminInlineText(
          lang,
          'business_commerce_reliability_and_evidence_are_separ_364feb1f'
        )}
        sections={[
          {
            key: 'analytics-business',
            label: adminInlineText(lang, 'business_6da818a9'),
            count: analytics.counts.users ?? 0,
            content: (
              <FactList
                lang={lang}
                density="compact"
                items={[
                  {
                    label: adminInlineText(lang, 'users_69bf3219'),
                    value: String(analytics.counts.users ?? 0),
                  },
                  {
                    label: adminInlineText(lang, 'signups_2fa7c6ad'),
                    value: String(analytics.growthMetrics.signups ?? 0),
                  },
                  {
                    label: adminInlineText(lang, 'activation_16b8b06e'),
                    value: String(analytics.growthMetrics.activation ?? 0),
                  },
                  {
                    label: adminInlineText(lang, 'usage_peak_b0c4c213'),
                    value: String(analytics.usagePatterns.peak),
                  },
                ]}
              />
            ),
          },
          {
            key: 'analytics-commerce',
            label: adminInlineText(lang, 'commerce_ffe5812b'),
            count: analytics.revenueMetrics.revenue ?? 0,
            content: (
              <FactList
                lang={lang}
                density="compact"
                items={[
                  {
                    label: adminInlineText(lang, 'revenue_baf4d829'),
                    value: String(analytics.revenueMetrics.revenue ?? 0),
                  },
                  { label: 'MRR', value: String(analytics.revenueMetrics.mrr ?? 0) },
                  {
                    label: adminInlineText(lang, 'refunds_6c3fe602'),
                    value: String(analytics.revenueMetrics.refunds ?? 0),
                  },
                  {
                    label: adminInlineText(lang, 'failed_payments_117d8ce7'),
                    value: String(analytics.revenueMetrics.failedPayments ?? 0),
                  },
                ]}
              />
            ),
          },
          {
            key: 'analytics-reliability',
            label: adminInlineText(lang, 'reliability_d2bd47cb'),
            count: analytics.reliability.warnings.length,
            content: (
              <FactList
                lang={lang}
                density="compact"
                items={[
                  {
                    label: adminInlineText(lang, 'runs_ff5c2c65'),
                    value: String(analytics.counts.runs ?? 0),
                    helper: adminInlineText(lang, 'value_failed_8bc4fc14', {
                      value1: analytics.reliability.failedRuns,
                    }),
                  },
                  {
                    label: adminInlineText(lang, 'p95_latency_c097fedb'),
                    value: `${analytics.reliability.p95LatencyMs}ms`,
                  },
                  {
                    label: adminInlineText(lang, 'failed_webhooks_b9eea8b8'),
                    value: String(analytics.reliability.failedWebhooks),
                  },
                  {
                    label: adminInlineText(lang, 'dead_letters_9b0b049c'),
                    value: String(analytics.reliability.deadLetters),
                  },
                ]}
              />
            ),
          },
          {
            key: 'analytics-evidence',
            label: adminInlineText(lang, 'evidence_c6edabc1'),
            count: analytics.timeSeries.length,
            content: (
              <FactList
                lang={lang}
                density="compact"
                items={[
                  {
                    label: adminInlineText(lang, 'returned_buckets_cd1b4074'),
                    value: String(analytics.timeSeries.length),
                  },
                  {
                    label: adminInlineText(lang, 'empty_buckets_a96e49b1'),
                    value: String(analyticsModel.zeroBuckets),
                  },
                  {
                    label: adminInlineText(lang, 'failure_buckets_120b5c32'),
                    value: String(analyticsModel.failureBuckets),
                  },
                  { label: adminInlineText(lang, 'store_48d0d80a'), value: analytics.store.mode },
                ]}
              />
            ),
          },
        ]}
      />
      <UsageAnalyticsCharts lang={lang} analytics={analytics} model={analyticsModel} />
      <UsageAnalyticsDataQualityPanel lang={lang} analytics={analytics} model={analyticsModel} />
      <UsageAnalyticsEvidence lang={lang} analytics={analytics} model={analyticsModel} />
    </WorkspaceShell>
  );
}
