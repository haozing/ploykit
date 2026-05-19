import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { formatDistance } from 'date-fns';
import { enUS, zhCN } from 'date-fns/locale';
import {
  CheckCircleIcon,
  ChevronLeft,
  ChevronRight,
  ClockIcon,
  Download,
  DollarSignIcon,
  RefreshCwIcon,
  XCircleIcon,
} from 'lucide-react';

import { auth } from '@/lib/auth';
import { getUserOrders } from '@/lib/services/billing/order-service';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { DashboardPageHeader, DashboardPageShell } from '@/components/dashboard/page-shell';

const PAGE_SIZE = 20;

type PageProps = {
  params: Promise<{ lang: string }>;
  searchParams?: Promise<{ page?: string }>;
};

const copy = {
  zh: {
    title: '订单历史',
    subtitle: '查看你的订阅、续费、退款和一次性购买记录。',
    emptyTitle: '暂无订单记录',
    emptyDescription: '当你完成购买或订阅变更后，订单会显示在这里。',
    date: '日期',
    type: '类型',
    amount: '金额',
    plan: '计划',
    status: '状态',
    provider: '支付方式',
    exportCsv: '导出 CSV',
    previous: '上一页',
    next: '下一页',
    page: '第 {page} 页',
  },
  en: {
    title: 'Order History',
    subtitle: 'Review your subscription, renewal, refund, and one-time purchase records.',
    emptyTitle: 'No orders yet',
    emptyDescription: 'Orders will appear here after purchases or subscription changes.',
    date: 'Date',
    type: 'Type',
    amount: 'Amount',
    plan: 'Plan',
    status: 'Status',
    provider: 'Payment Method',
    exportCsv: 'Export CSV',
    previous: 'Previous',
    next: 'Next',
    page: 'Page {page}',
  },
};

const orderTypeLabels = {
  zh: {
    subscription_created: '订阅创建',
    subscription_renewed: '订阅续费',
    subscription_cancelled: '订阅取消',
    one_time_purchase: '一次性购买',
    refund: '退款',
  },
  en: {
    subscription_created: 'Subscription Created',
    subscription_renewed: 'Subscription Renewed',
    subscription_cancelled: 'Subscription Cancelled',
    one_time_purchase: 'One-time Purchase',
    refund: 'Refund',
  },
};

const statusLabels = {
  zh: {
    succeeded: '成功',
    pending: '处理中',
    failed: '失败',
    refunded: '已退款',
  },
  en: {
    succeeded: 'Succeeded',
    pending: 'Pending',
    failed: 'Failed',
    refunded: 'Refunded',
  },
};

function normalizeLang(lang: string): keyof typeof copy {
  return lang.startsWith('zh') ? 'zh' : 'en';
}

function parsePage(value: string | undefined): number {
  const page = Number(value || '1');
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function orderTypeLabel(orderType: string, lang: keyof typeof copy): string {
  return orderTypeLabels[lang][orderType as keyof (typeof orderTypeLabels)['en']] || orderType;
}

function formatAmount(amount: string | null, currency: string | null, lang: keyof typeof copy) {
  if (!amount) {
    return '-';
  }

  return new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

function statusBadge(status: string, lang: keyof typeof copy) {
  const config = {
    succeeded: {
      icon: CheckCircleIcon,
      className: 'border-green-200 bg-green-50 text-green-700',
    },
    pending: {
      icon: ClockIcon,
      className: 'border-yellow-200 bg-yellow-50 text-yellow-700',
    },
    failed: {
      icon: XCircleIcon,
      className: 'border-red-200 bg-red-50 text-red-700',
    },
    refunded: {
      icon: RefreshCwIcon,
      className: 'border-muted bg-muted text-muted-foreground',
    },
  }[status] || {
    icon: ClockIcon,
    className: 'border-muted bg-muted text-muted-foreground',
  };
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={`gap-1.5 ${config.className}`}>
      <Icon className="h-3.5 w-3.5" />
      {statusLabels[lang][status as keyof (typeof statusLabels)['en']] || status}
    </Badge>
  );
}

export default async function OrdersPage({ params, searchParams }: PageProps) {
  const { lang: routeLang } = await params;
  const { page: pageParam } = (await searchParams) || {};
  const page = parsePage(pageParam);
  const lang = normalizeLang(routeLang);
  const text = copy[lang];

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect(`/${routeLang}/login?callbackUrl=/${routeLang}/billing/orders`);
  }

  const offset = (page - 1) * PAGE_SIZE;
  const orders = await getUserOrders(session.user.id, PAGE_SIZE + 1, offset);
  const visibleOrders = orders.slice(0, PAGE_SIZE);
  const hasNextPage = orders.length > PAGE_SIZE;
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
            <a href="/api/user/orders?limit=100&format=csv">
              <Download className="mr-2 h-4 w-4" />
              {text.exportCsv}
            </a>
          </Button>
        }
      />

      {visibleOrders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <DollarSignIcon className="h-12 w-12 text-muted-foreground" />
            <h2 className="text-xl font-semibold">{text.emptyTitle}</h2>
            <p className="text-muted-foreground">{text.emptyDescription}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="border-b px-0 py-0">
            <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr_1fr] gap-4 px-6 py-3 text-sm font-medium text-muted-foreground">
              <div>{text.date}</div>
              <div>{text.type}</div>
              <div>{text.amount}</div>
              <div>{text.plan}</div>
              <div>{text.status}</div>
            </div>
          </CardHeader>
          <CardContent className="px-0 py-0">
            {visibleOrders.map((order) => (
              <div
                key={order.id}
                className="grid grid-cols-[1.2fr_1fr_1fr_1fr_1fr] gap-4 border-b px-6 py-4 text-sm last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="font-medium">
                    {new Date(order.createdAt).toLocaleDateString(localeCode, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDistance(new Date(order.createdAt), new Date(), {
                      addSuffix: true,
                      locale,
                    })}
                  </div>
                </div>
                <div className="min-w-0 break-words">{orderTypeLabel(order.orderType, lang)}</div>
                <div className="font-medium">
                  {formatAmount(order.amount, order.currency, lang)}
                </div>
                <div className="min-w-0 break-words">
                  {order.plan?.name || <span className="text-muted-foreground">-</span>}
                </div>
                <div>{statusBadge(order.status, lang)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        {page <= 1 ? (
          <Button variant="outline" size="sm" disabled>
            <ChevronLeft className="mr-2 h-4 w-4" />
            {text.previous}
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href={`/${routeLang}/billing/orders?page=${page - 1}`}>
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
            <Link href={`/${routeLang}/billing/orders?page=${page + 1}`}>
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
