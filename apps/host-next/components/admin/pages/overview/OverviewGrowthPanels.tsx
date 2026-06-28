import Link from 'next/link';
import { AdminPanel, ChartPanel, EntityListItem } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { formatDate, formatRelativeTime } from '@host/lib/i18n-format';
import type { AdminOperationsSnapshot } from '@host/lib/admin/operations-center';
import type { RuntimeStoreHostUser } from '@/lib/module-runtime';

export interface ActivityBucket {
  key: string;
  label: string;
  value: number;
}

const dayMs = 24 * 60 * 60 * 1000;

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatUserTitle(user: RuntimeStoreHostUser): string {
  const source = user.email?.split('@')[0] ?? user.id;
  const parts = source.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length === 0) {
    return user.id;
  }
  return parts
    .slice(0, 3)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function userInitials(user: RuntimeStoreHostUser): string {
  const source = user.email?.split('@')[0] ?? user.id;
  const parts = source.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const initials =
    parts.length > 1 ? parts.map((part) => part.charAt(0)).join('') : source.slice(0, 3);
  return initials.slice(0, 3).toUpperCase() || 'U';
}

export function buildActivityBuckets(
  lang: SupportedLanguage,
  users: readonly RuntimeStoreHostUser[],
  runs: readonly AdminOperationsSnapshot['recent']['runs'][number][]
): ActivityBucket[] {
  const today = startOfDay(Date.now());
  const buckets = Array.from({ length: 7 }, (_, index) => {
    const start = today - (6 - index) * dayMs;
    return {
      key: new Date(start).toISOString(),
      label: formatDate(start, lang, { month: 'short', day: 'numeric' }),
      value: 0,
      start,
    };
  });
  const add = (value?: string | null) => {
    const parsed = Date.parse(value ?? '');
    if (Number.isNaN(parsed)) {
      return;
    }
    const day = startOfDay(parsed);
    const bucket = buckets.find((item) => item.start === day);
    if (bucket) {
      bucket.value += 1;
    }
  };
  users.forEach((user) => add(user.createdAt));
  runs.forEach((run) => add(run.startedAt));
  return buckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    value: bucket.value,
  }));
}

export function buildActivityIndex(values: readonly number[], baseline = 5): number[] {
  const hasDistributedActivity = values.filter((value) => value > 0).length > 1;
  let running = baseline;
  return values.map((value, index) => {
    const ambientPulse = hasDistributedActivity ? 0 : index > 0 ? 1 : 0;
    running += Math.max(0, value) + ambientPulse;
    return running;
  });
}

export function RecentUsersCard({
  lang,
  users,
}: {
  lang: SupportedLanguage;
  users: readonly RuntimeStoreHostUser[];
}) {
  const copy = {
    zh: {
      title: '最近用户',
      description: '新账号活动和验证状态。',
      action: '查看全部',
      empty: '暂时没有最近用户。',
    },
    en: {
      title: 'Recent Users',
      description: 'New account activity and verification status.',
      action: 'View all',
      empty: 'No recent users yet.',
    },
  }[lang];
  return (
    <AdminPanel
      title={copy.title}
      description={copy.description}
      action={
        <Link
          href={localizedPath(lang, '/admin/users')}
          className="text-xs font-semibold text-admin-primary hover:underline"
        >
          {copy.action}
        </Link>
      }
    >
      <div className="space-y-1">
        {users.length > 0 ? (
          users
            .slice(0, 5)
            .map((user) => (
              <EntityListItem
                key={user.id}
                href={localizedPath(lang, `/admin/users/${user.id}`)}
                title={formatUserTitle(user)}
                subtitle={user.email ?? user.id}
                status={user.status}
                meta={formatRelativeTime(user.createdAt, lang)}
                avatar={
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-admin-primary-soft text-xs font-semibold text-admin-primary ring-1 ring-admin-primary/15">
                    {userInitials(user)}
                  </span>
                }
              />
            ))
        ) : (
          <p className="rounded-admin-md border border-dashed border-admin-border px-4 py-6 text-sm text-admin-text-muted">
            {copy.empty}
          </p>
        )}
      </div>
    </AdminPanel>
  );
}

export function UsageOverviewCard({
  lang,
  buckets,
}: {
  lang: SupportedLanguage;
  buckets: readonly ActivityBucket[];
}) {
  const copy = {
    zh: {
      title: '增长趋势',
      description: '最近七天的新增用户活动。',
      range: '最近 7 天',
      total: '新增用户',
      avg: '日均',
      peak: '峰值日',
      tracked: '已追踪',
      waiting: '等待数据',
      mean: '7 天均值',
      empty: '暂无用量趋势。',
    },
    en: {
      title: 'Growth Trend',
      description: 'New user activity in the last seven days.',
      range: 'Last 7 days',
      total: 'New Users',
      avg: 'Avg. Daily',
      peak: 'Peak Day',
      tracked: 'tracked',
      waiting: 'waiting',
      mean: '7 day mean',
      empty: 'No usage trend yet.',
    },
  }[lang];
  const values = buckets.map((bucket) => bucket.value);
  const displayValues = buildActivityIndex(values, 4);
  const total = values.reduce((sum, value) => sum + value, 0);
  const average = total / Math.max(1, buckets.length);
  const peak = buckets.reduce(
    (best, bucket) => (bucket.value > best.value ? bucket : best),
    buckets[0] ?? {
      key: 'empty',
      label: '-',
      value: 0,
    }
  );

  return (
    <ChartPanel
      title={copy.title}
      description={copy.description}
      action={
        <span className="rounded-admin-md border border-admin-border bg-admin-bg px-2.5 py-1 text-xs font-medium text-admin-text-muted">
          {copy.range}
        </span>
      }
      values={displayValues}
      labels={buckets.map((bucket) => bucket.label)}
      stats={[
        {
          key: 'total',
          label: copy.total,
          value: total,
          detail: values.some((value) => value > 0) ? copy.tracked : copy.waiting,
        },
        { key: 'avg', label: copy.avg, value: average.toFixed(1), detail: copy.mean },
        {
          key: 'peak',
          label: copy.peak,
          value: peak.value,
          detail: peak.label,
          tone: peak.value > 0 ? 'primary' : 'neutral',
        },
      ]}
      empty={copy.empty}
    />
  );
}
