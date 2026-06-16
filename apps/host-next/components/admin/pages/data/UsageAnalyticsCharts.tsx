import { ChartPanel } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminAnalyticsData, AnalyticsEvidenceModel } from './UsageAnalyticsPageModel';

export function UsageAnalyticsCharts({
  lang,
  analytics,
  model,
}: {
  lang: SupportedLanguage;
  analytics: AdminAnalyticsData;
  model: AnalyticsEvidenceModel;
}) {
  const { timeSeries, growthEntries } = model;

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <ChartPanel
        title={adminInlineText(lang, 'Usage trend')}
        description={adminInlineText(
          lang,
          'Daily usage quantity from the server-side analytics time series.'
        )}
        values={timeSeries.map((point) => point.usageQuantity)}
        labels={timeSeries.map((point) => point.date.slice(5))}
        axisLabel={adminInlineText(lang, 'Usage Quantity')}
        legend={[
          {
            key: 'usage',
            label: adminInlineText(lang, 'Usage'),
            value: timeSeries.reduce((sum, point) => sum + point.usageQuantity, 0),
            tone: 'primary',
          },
          {
            key: 'peak',
            label: adminInlineText(lang, 'Peak'),
            value: analytics.usagePatterns.peak,
            tone: 'info',
          },
        ]}
        drilldownHref={localizedPath(lang, '/admin/usage')}
        drilldownLabel={adminInlineText(lang, 'usage_detail_2fc7505c')}
        stats={[
          {
            key: 'peak',
            label: adminInlineText(lang, 'Peak'),
            value: analytics.usagePatterns.peak,
            detail: adminInlineText(lang, 'selected range'),
            tone: 'info',
          },
          {
            key: 'median',
            label: adminInlineText(lang, 'Median'),
            value: analytics.usagePatterns.median,
            detail: adminInlineText(lang, 'selected range'),
            tone: 'neutral',
          },
          {
            key: 'warnings',
            label: adminInlineText(lang, 'Warnings'),
            value: analytics.reliability.warnings.length,
            detail: adminInlineText(lang, 'reliability notices'),
            tone: analytics.reliability.warnings.length > 0 ? 'warning' : 'success',
          },
        ]}
        empty={adminInlineText(lang, 'No usage trend in selected range.')}
      />
      <ChartPanel
        title={adminInlineText(lang, 'Revenue metrics')}
        description={adminInlineText(
          lang,
          'Daily paid revenue amount from the selected analytics window.'
        )}
        values={timeSeries.map((point) => point.revenueAmount)}
        labels={timeSeries.map((point) => point.date.slice(5))}
        axisLabel={adminInlineText(lang, 'Amount')}
        legend={[
          {
            key: 'revenue',
            label: adminInlineText(lang, 'Revenue'),
            value: timeSeries.reduce((sum, point) => sum + point.revenueAmount, 0),
            tone: 'success' as const,
          },
          {
            key: 'mrr',
            label: 'MRR',
            value: analytics.revenueMetrics.mrr ?? 0,
            tone: 'info' as const,
          },
        ]}
        drilldownHref={localizedPath(lang, '/admin/revenue')}
        drilldownLabel={adminInlineText(lang, 'revenue_detail_fbd90eb8')}
        tone="success"
        empty={adminInlineText(lang, 'No revenue metrics in selected range.')}
      />
      <ChartPanel
        title={adminInlineText(lang, 'Growth metrics')}
        description={adminInlineText(
          lang,
          'Daily signups from the selected analytics window, with growth metrics kept as summary evidence.'
        )}
        values={timeSeries.map((point) => point.signups)}
        labels={timeSeries.map((point) => point.date.slice(5))}
        axisLabel={adminInlineText(lang, 'growth_signal_eff6215c')}
        legend={growthEntries.slice(0, 3).map(([key, value]) => ({
          key,
          label: key,
          value:
            key.includes('Rate') || key.includes('conversion')
              ? `${Math.round(value * 100)}%`
              : value,
          tone: 'info' as const,
        }))}
        drilldownHref={localizedPath(lang, '/admin/users')}
        drilldownLabel={adminInlineText(lang, 'user_detail_89e53ea2')}
        tone="info"
        empty={adminInlineText(lang, 'No growth metrics in selected range.')}
      />
    </div>
  );
}
