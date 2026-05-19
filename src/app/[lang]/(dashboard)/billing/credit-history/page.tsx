import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { formatDistance } from 'date-fns';
import { enUS, zhCN } from 'date-fns/locale';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeft,
  ChevronRight,
  CoinsIcon,
  Download,
  RefreshCwIcon,
  SettingsIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from 'lucide-react';

import { auth } from '@/lib/auth';
import { getUserCreditLogs } from '@/lib/services/billing/credit-log-service';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PLATFORM_PRIMARY_CREDIT_METRIC } from '@/lib/billing/billing-metrics';
import { DashboardPageHeader, DashboardPageShell } from '@/components/dashboard/page-shell';

const PAGE_SIZE = 20;

type PageProps = {
  params: Promise<{ lang: string }>;
  searchParams?: Promise<{ page?: string }>;
};

const copy = {
  zh: {
    title: '额度历史',
    subtitle: '查看订阅、重置、退款和人工调整带来的额度变化。',
    emptyTitle: '暂无额度变更记录',
    emptyDescription: '订阅创建、重置或人工调整后，记录会显示在这里。',
    balanceAfter: '变更后余额',
    apiCalls: '点额度',
    relatedOrder: '关联订单',
    exportCsv: '导出 CSV',
    previous: '上一页',
    next: '下一页',
    page: '第 {page} 页',
  },
  en: {
    title: 'Credit History',
    subtitle: 'Review credit changes from subscriptions, resets, refunds, and manual adjustments.',
    emptyTitle: 'No credit records yet',
    emptyDescription: 'Subscription, reset, or manual adjustment records will appear here.',
    balanceAfter: 'Balance After',
    apiCalls: 'credits',
    relatedOrder: 'Related Order',
    exportCsv: 'Export CSV',
    previous: 'Previous',
    next: 'Next',
    page: 'Page {page}',
  },
};

const logTypeLabels = {
  zh: {
    grant: '授予',
    reset: '重置',
    refund: '退回',
    refund_revoke: '退款扣回',
    manual_adjust: '人工调整',
    subscription_upgrade: '订阅升级',
    subscription_downgrade: '订阅降级',
  },
  en: {
    grant: 'Grant',
    reset: 'Reset',
    refund: 'Refund',
    refund_revoke: 'Refund Revoke',
    manual_adjust: 'Manual Adjust',
    subscription_upgrade: 'Subscription Upgrade',
    subscription_downgrade: 'Subscription Downgrade',
  },
};

function normalizeLang(lang: string): keyof typeof copy {
  return lang.startsWith('zh') ? 'zh' : 'en';
}

function parsePage(value: string | undefined): number {
  const page = Number(value || '1');
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function getLogTypeConfig(logType: string, lang: keyof typeof copy) {
  const configs = {
    grant: {
      icon: TrendingUpIcon,
      className: 'border-green-200 bg-green-50 text-green-700',
    },
    reset: {
      icon: RefreshCwIcon,
      className: 'border-blue-200 bg-blue-50 text-blue-700',
    },
    refund_revoke: {
      icon: TrendingDownIcon,
      className: 'border-red-200 bg-red-50 text-red-700',
    },
    manual_adjust: {
      icon: SettingsIcon,
      className: 'border-violet-200 bg-violet-50 text-violet-700',
    },
    subscription_upgrade: {
      icon: ArrowUpIcon,
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    },
    subscription_downgrade: {
      icon: ArrowDownIcon,
      className: 'border-orange-200 bg-orange-50 text-orange-700',
    },
  }[logType] || {
    icon: CoinsIcon,
    className: 'border-muted bg-muted text-muted-foreground',
  };

  return {
    ...configs,
    label: logTypeLabels[lang][logType as keyof (typeof logTypeLabels)['en']] || logType,
  };
}

function formatBalance(balanceAfter: unknown): number {
  if (!balanceAfter || typeof balanceAfter !== 'object' || Array.isArray(balanceAfter)) {
    return 0;
  }

  const snapshot = balanceAfter as Record<string, unknown>;
  const value = snapshot[PLATFORM_PRIMARY_CREDIT_METRIC] ?? snapshot.apiCallsRemaining;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

export default async function CreditHistoryPage({ params, searchParams }: PageProps) {
  const { lang: routeLang } = await params;
  const { page: pageParam } = (await searchParams) || {};
  const page = parsePage(pageParam);
  const lang = normalizeLang(routeLang);
  const text = copy[lang];

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect(`/${routeLang}/login?callbackUrl=/${routeLang}/billing/credit-history`);
  }

  const offset = (page - 1) * PAGE_SIZE;
  const logs = await getUserCreditLogs(session.user.id, PAGE_SIZE + 1, offset);
  const visibleLogs = logs.slice(0, PAGE_SIZE);
  const hasNextPage = logs.length > PAGE_SIZE;
  const locale = lang === 'zh' ? zhCN : enUS;
  const localeCode = lang === 'zh' ? 'zh-CN' : 'en-US';

  return (
    <DashboardPageShell>
      <DashboardPageHeader
        title={text.title}
        description={text.subtitle}
        actions={
          <Button asChild variant="outline">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Export endpoint returns a CSV download, not an app navigation. */}
            <a href="/api/user/credit-history?limit=100&format=csv">
              <Download className="mr-2 h-4 w-4" />
              {text.exportCsv}
            </a>
          </Button>
        }
      />

      {visibleLogs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <CoinsIcon className="h-12 w-12 text-muted-foreground" />
            <h2 className="text-xl font-semibold">{text.emptyTitle}</h2>
            <p className="text-muted-foreground">{text.emptyDescription}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {visibleLogs.map((log) => {
            const config = getLogTypeConfig(log.logType, lang);
            const Icon = config.icon;
            const isPositive = log.changeAmount > 0;
            const balance = formatBalance(log.balanceAfter);

            return (
              <Card key={log.id}>
                <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-start md:justify-between">
                  <div className="flex min-w-0 flex-1 gap-4">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md border ${config.className}`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 space-y-2">
                      <Badge variant="outline" className={config.className}>
                        {config.label}
                      </Badge>
                      <p className="break-words text-sm text-muted-foreground">
                        {log.reason || '-'}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {new Date(log.createdAt).toLocaleDateString(localeCode, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <span>/</span>
                        <span>
                          {formatDistance(new Date(log.createdAt), new Date(), {
                            addSuffix: true,
                            locale,
                          })}
                        </span>
                      </div>
                      {log.relatedOrder && !Array.isArray(log.relatedOrder) ? (
                        <div className="text-xs text-muted-foreground">
                          {text.relatedOrder}: {log.relatedOrder.orderType}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-left md:text-right">
                    <div
                      className={`text-2xl font-bold ${
                        isPositive ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {isPositive ? '+' : ''}
                      {log.changeAmount.toLocaleString(localeCode)}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">{text.balanceAfter}</div>
                    <div className="text-sm font-semibold">
                      {balance.toLocaleString(localeCode)} {text.apiCalls}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        {page <= 1 ? (
          <Button variant="outline" size="sm" disabled>
            <ChevronLeft className="mr-2 h-4 w-4" />
            {text.previous}
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href={`/${routeLang}/billing/credit-history?page=${page - 1}`}>
              <ChevronLeft className="mr-2 h-4 w-4" />
              {text.previous}
            </Link>
          </Button>
        )}
        <div className="text-sm text-muted-foreground">
          {text.page.replace('{page}', String(page))}
        </div>
        {hasNextPage ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/${routeLang}/billing/credit-history?page=${page + 1}`}>
              {text.next}
              <ChevronRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            {text.next}
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
    </DashboardPageShell>
  );
}
