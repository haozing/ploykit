import { adminNav, StatCard, WorkspaceShell } from '@host/components/ProductShell';
import {
  ActionQueue,
  AdminPanel,
  ChartPanel,
  FactList,
  StatGrid,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminUsageCopy } from '@host/lib/admin-copy';
import type { AdminTableQuery } from '@host/lib/table-query';
import type {
  RuntimeStoreMeteringLedgerEntry,
  RuntimeStoreUsageRecord,
} from '@/lib/module-runtime';
import { UsageRecordsSection } from './UsageRecordsSection';
import { cleanUsageTableQuery, type AdminPagedResult } from './UsagePageModel';

export function AdminUsageOperationsPage({
  lang,
  usage,
  metering,
  query,
}: {
  lang: SupportedLanguage;
  usage: AdminPagedResult<RuntimeStoreUsageRecord>;
  metering: AdminPagedResult<RuntimeStoreMeteringLedgerEntry>;
  query?: AdminTableQuery;
}) {
  const copy = getAdminUsageCopy(lang);
  const tableQuery = cleanUsageTableQuery(query);
  const usageTotal = usage.items.reduce((sum, record) => sum + record.quantity, 0);
  const meteringTotal = metering.items.reduce((sum, record) => sum + record.quantity, 0);
  const committed = metering.items.filter((record) => record.status === 'committed').length;
  const openMetering = metering.items.filter((record) => record.status !== 'committed');
  const usageMedian =
    usage.items.length > 0
      ? ([...usage.items].sort((left, right) => left.quantity - right.quantity)[
          Math.floor(usage.items.length / 2)
        ]?.quantity ?? 0)
      : 0;
  const abnormalUsage = usage.items.filter(
    (record) => record.quantity < 0 || (usageMedian > 0 && record.quantity > usageMedian * 5)
  );
  const planContext = usage.items
    .map((record) => record.metadata.planId ?? record.metadata.plan ?? record.metadata.sku)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const quotaContext = usage.items
    .map((record) => record.metadata.quota ?? record.metadata.limit ?? record.metadata.credits)
    .filter((value) => value !== undefined && value !== null);
  const usageReviewItems = [
    openMetering.length > 0
      ? {
          key: 'open-metering',
          title: adminInlineText(lang, 'open_metering_records_95a992f4'),
          description: adminInlineText(
            lang,
            'value_metering_records_are_not_committed_refunded_vo_5c9787fb',
            { value1: openMetering.length }
          ),
          actionLabel: adminInlineText(lang, 'review_metering_20a2765f'),
          href: localizedPath(lang, '/admin/usage?status=authorized'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
    abnormalUsage.length > 0
      ? {
          key: 'abnormal-usage',
          title: adminInlineText(lang, 'abnormal_usage_244b13b9'),
          description: adminInlineText(
            lang,
            'value_usage_records_are_negative_or_above_5x_the_med_fb589824',
            { value1: abnormalUsage.length }
          ),
          actionLabel: adminInlineText(lang, 'review_usage_28a975f1'),
          href: localizedPath(lang, '/admin/usage'),
          status: 'review',
          tone: 'warning' as const,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const usageTrend = usage.items.slice(0, 7).reverse();
  const meteringTrend = metering.items.slice(0, 7).reverse();
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <StatGrid>
        <StatCard
          label={adminInlineText(lang, 'Usage Records')}
          value={String(usage.page.total)}
          tone="blue"
        />
        <StatCard label={adminInlineText(lang, 'Usage Quantity')} value={String(usageTotal)} />
        <StatCard
          label={adminInlineText(lang, 'Meter Records')}
          value={String(metering.page.total)}
          tone="amber"
        />
        <StatCard label={adminInlineText(lang, 'Committed')} value={String(committed)} />
      </StatGrid>
      {usageReviewItems.length > 0 ? (
        <ActionQueue
          lang={lang}
          title={adminInlineText(lang, 'usage_review_9c908708')}
          description={adminInlineText(
            lang,
            'overages_anomalies_and_open_metering_are_promoted_be_14532b42'
          )}
          status="warning"
          items={usageReviewItems}
        />
      ) : null}
      <AdminPanel
        title={adminInlineText(lang, 'quota_credits_plan_context_0cf34cc2')}
        description={adminInlineText(
          lang,
          'quota_credits_and_plan_context_is_derived_from_usage_44a1516a'
        )}
      >
        <FactList
          lang={lang}
          density="compact"
          items={[
            {
              label: 'Plans / SKUs',
              value:
                planContext.slice(0, 4).join(', ') || adminInlineText(lang, 'no_metadata_9c6a99e4'),
            },
            {
              label: 'Quota / credits',
              value:
                quotaContext.slice(0, 4).map(String).join(', ') ||
                adminInlineText(lang, 'no_metadata_9c6a99e4'),
            },
            { label: 'Open metering', value: String(openMetering.length) },
            { label: 'Abnormal usage', value: String(abnormalUsage.length) },
          ]}
        />
      </AdminPanel>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPanel
          title={adminInlineText(lang, 'Usage trend')}
          description={adminInlineText(
            lang,
            'Recent usage quantities by record order. Empty states stay explicit.'
          )}
          values={usageTrend.map((record) => record.quantity)}
          labels={usageTrend.map((record) => record.meter)}
          stats={[
            {
              key: 'total',
              label: 'Usage quantity',
              value: usageTotal,
              detail: `${usage.items.length} loaded`,
              tone: 'info',
            },
            {
              key: 'meters',
              label: 'Meters',
              value: new Set(usage.items.map((record) => record.meter)).size,
              detail: 'unique meters',
              tone: 'neutral',
            },
            {
              key: 'modules',
              label: 'Modules',
              value: new Set(usage.items.map((record) => record.moduleId)).size,
              detail: 'usage sources',
              tone: 'success',
            },
          ]}
          empty={adminInlineText(lang, 'No usage records in this window.')}
        />
        <ChartPanel
          title={adminInlineText(lang, 'Metering ledger')}
          description={adminInlineText(
            lang,
            'Authorized, committed, refunded, and voided records by quantity.'
          )}
          values={meteringTrend.map((record) => record.quantity)}
          labels={meteringTrend.map((record) => record.status)}
          stats={[
            {
              key: 'metering',
              label: 'Metering quantity',
              value: meteringTotal,
              detail: `${metering.items.length} loaded`,
              tone: 'info',
            },
            {
              key: 'committed',
              label: 'Committed',
              value: committed,
              detail: 'recognized usage',
              tone: 'success',
            },
            {
              key: 'open',
              label: 'Open records',
              value: metering.items.length - committed,
              detail: 'not committed',
              tone: metering.items.length - committed > 0 ? 'warning' : 'neutral',
            },
          ]}
          tone="warning"
          empty={adminInlineText(lang, 'No metering records in this window.')}
        />
      </div>
      <UsageRecordsSection
        lang={lang}
        tableQuery={tableQuery}
        usage={usage}
        metering={metering}
      />
    </WorkspaceShell>
  );
}
