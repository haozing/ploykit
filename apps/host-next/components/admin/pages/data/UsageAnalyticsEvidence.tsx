import type { ReactNode } from 'react';
import { DataTable } from '@host/components/ui';
import {
  AdminPanel,
  EvidenceSection,
  FactList,
} from '@host/components/admin/shared/AdminPrimitives';
import { type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import {
  compactJson,
  type AdminAnalyticsData,
  type AnalyticsEvidenceModel,
} from './UsageAnalyticsPageModel';

export function UsageAnalyticsDataQualityPanel({
  lang,
  analytics,
  model,
}: {
  lang: SupportedLanguage;
  analytics: AdminAnalyticsData;
  model: AnalyticsEvidenceModel;
}) {
  return (
    <AdminPanel
      title={adminInlineText(lang, 'data_quality_bucket_coverage_f54e6f7e')}
      description={adminInlineText(
        lang,
        'the_server_returns_a_complete_date_bucket_series_so__a2f1e1a7'
      )}
    >
      <FactList
        lang={lang}
        className="md:grid-cols-2 xl:grid-cols-4"
        density="compact"
        items={[
          { label: 'Returned buckets', value: String(analytics.timeSeries.length) },
          { label: 'Charted buckets', value: String(model.timeSeries.length) },
          { label: 'Empty buckets', value: String(model.zeroBuckets) },
          { label: 'Failure buckets', value: String(model.failureBuckets) },
          {
            label: 'Peak usage day',
            value: `${model.peakUsageBucket.date} · ${model.peakUsageBucket.usageQuantity}`,
          },
          {
            label: 'Peak revenue day',
            value: `${model.peakRevenueBucket.date} · ${model.peakRevenueBucket.revenueAmount}`,
          },
          { label: 'Range source', value: analytics.range.label },
          { label: 'Storage', value: analytics.store.mode },
        ]}
      />
    </AdminPanel>
  );
}

export function UsageAnalyticsEvidence({
  lang,
  analytics,
  model,
}: {
  lang: SupportedLanguage;
  analytics: AdminAnalyticsData;
  model: AnalyticsEvidenceModel;
}) {
  const sections: { key: string; title: string; table: ReactNode }[] = [
    {
      key: 'revenue',
      title: adminInlineText(lang, 'revenue_metrics_aa36b65c'),
      table: (
        <DataTable
          className="shadow-none"
          density="compact"
          columns={adminInlineColumns(lang, ['Revenue', 'Value'])}
          rows={Object.entries(analytics.revenueMetrics).map(([key, value]) => [
            key,
            String(value),
          ])}
        />
      ),
    },
    {
      key: 'growth',
      title: adminInlineText(lang, 'growth_metrics_a21d5394'),
      table: (
        <DataTable
          className="shadow-none"
          density="compact"
          columns={adminInlineColumns(lang, ['Growth', 'Value'])}
          rows={Object.entries(analytics.growthMetrics).map(([key, value]) => [
            key,
            key.includes('Rate') || key.includes('conversion')
              ? `${Math.round(value * 100)}%`
              : String(value),
          ])}
        />
      ),
    },
    {
      key: 'churn',
      title: adminInlineText(lang, 'churn_metrics_b185bbde'),
      table: (
        <DataTable
          className="shadow-none"
          density="compact"
          columns={adminInlineColumns(lang, ['Churn', 'Value'])}
          rows={[
            [
              adminInlineText(lang, 'churn_count_493d6b47'),
              String(analytics.churnMetrics.churnCount),
            ],
            [
              adminInlineText(lang, 'churn_rate_6fdfbbf2'),
              `${Math.round(analytics.churnMetrics.churnRate * 100)}%`,
            ],
            [adminInlineText(lang, 'lost_mrr_eebadbfc'), String(analytics.churnMetrics.lostMrr)],
            [adminInlineText(lang, 'reasons_c5a997d3'), compactJson(analytics.churnMetrics.reasons)],
          ]}
        />
      ),
    },
    {
      key: 'usage',
      title: adminInlineText(lang, 'usage_buckets_and_patterns_a4df314b'),
      table: (
        <div className="grid gap-3">
          <DataTable
            className="shadow-none"
            density="compact"
            columns={adminInlineColumns(lang, ['Date', 'Usage', 'Revenue', 'Signups', 'Failures'])}
            rows={
              analytics.timeSeries.length > 0
                ? analytics.timeSeries.map((point) => [
                    point.date,
                    String(point.usageQuantity),
                    String(point.revenueAmount),
                    String(point.signups),
                    `${point.failedRuns + point.failedWebhooks + point.deadLetters}`,
                  ])
                : [
                    [
                      '-',
                      adminInlineText(lang, 'no_time_series_in_selected_range_56ae138e'),
                      '-',
                      '-',
                      '-',
                    ],
                  ]
            }
          />
          <DataTable
            className="shadow-none"
            density="compact"
            columns={adminInlineColumns(lang, ['Usage Pattern', 'Value'])}
            rows={[
              [adminInlineText(lang, 'peak_260c49fd'), String(analytics.usagePatterns.peak)],
              [adminInlineText(lang, 'median_a9f38fa8'), String(analytics.usagePatterns.median)],
              [adminInlineText(lang, 'by_module_621de414'), compactJson(analytics.usagePatterns.byModule)],
              [adminInlineText(lang, 'by_meter_83b123cb'), compactJson(analytics.usagePatterns.byMeter)],
            ]}
          />
        </div>
      ),
    },
    {
      key: 'cohort',
      title: adminInlineText(lang, 'cohorts_6f28f2cb'),
      table: (
        <DataTable
          className="shadow-none"
          density="compact"
          columns={adminInlineColumns(lang, ['Cohort', 'Size', 'Retained', 'Retention', 'Revenue'])}
          rows={analytics.cohorts.map((cohort) => [
            cohort.cohort,
            String(cohort.size),
            String(cohort.retained),
            `${Math.round(cohort.retentionRate * 100)}%`,
            String(cohort.revenue),
          ])}
        />
      ),
    },
    {
      key: 'reliability',
      title: adminInlineText(lang, 'reliability_and_edge_access_fd695592'),
      table: (
        <div className="grid gap-3">
          <DataTable
            className="shadow-none"
            density="compact"
            columns={adminInlineColumns(lang, ['Reliability', 'Value'])}
            rows={[
              [adminInlineText(lang, 'failed_runs_ce3c4150'), String(analytics.reliability.failedRuns)],
              [
                adminInlineText(lang, 'failed_webhooks_dcf27f1c'),
                String(analytics.reliability.failedWebhooks),
              ],
              [adminInlineText(lang, 'dead_letters_939898e3'), String(analytics.reliability.deadLetters)],
              [
                adminInlineText(lang, 'p50_latency_1566a8f6'),
                `${analytics.reliability.p50LatencyMs}ms`,
              ],
              [
                adminInlineText(lang, 'p95_latency_b8d39333'),
                `${analytics.reliability.p95LatencyMs}ms`,
              ],
              [
                adminInlineText(lang, 'warnings_3dbf89d6'),
                analytics.reliability.warnings.join(', ') || adminInlineText(lang, 'none_48d72ef0'),
              ],
            ]}
          />
          <DataTable
            className="shadow-none"
            density="compact"
            columns={adminInlineColumns(lang, ['Route', 'Status', 'IP Hash', 'Latency', 'Created'])}
            rows={
              analytics.edgeAccessLogs.length > 0
                ? analytics.edgeAccessLogs.map((log) => [
                    log.route,
                    String(log.status),
                    log.ipHash || '-',
                    `${log.latencyMs}ms`,
                    log.createdAt,
                  ])
                : [
                    [
                      '-',
                      '-',
                      '-',
                      '-',
                      adminInlineText(lang, 'no_edge_access_logs_in_selected_range_e2eafe0f'),
                    ],
                  ]
            }
          />
        </div>
      ),
    },
    {
      key: 'counts',
      title: adminInlineText(lang, 'raw_counts_3065a8d8'),
      table: (
        <DataTable
          className="shadow-none"
          density="compact"
          columns={adminInlineColumns(lang, ['Metric', 'Value'])}
          rows={model.countEntries.map(([key, value]) => [key, String(value)])}
        />
      ),
    },
  ];

  return (
    <AdminPanel
      title={adminInlineText(lang, 'Analytics evidence')}
      description={adminInlineText(
        lang,
        'Detailed tables are collapsed by domain so the analytics page reads as charts first and evidence second.'
      )}
      contentClassName="grid gap-3"
    >
      {sections.map((section) => (
        <EvidenceSection key={section.key} title={adminInlineText(lang, section.title)}>
          {section.table}
        </EvidenceSection>
      ))}
    </AdminPanel>
  );
}
