
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DataTable, type Column } from '../../components/DataTable';
import { PageEmpty, PageError, PageLoading } from '../../components/Page';
import { StatusBadge } from '../../components/StatusBadge';
import { toast } from '../../components/toast';
import { Button } from '../../components/ui/button';
import { useApi } from '@ploykit/hooks';
import { adminError, formatCents } from './shared';
import {
  BILLING_CHANNELS_QUERY_KEY,
  type BillingChannelsEnvelope,
} from './BillingChannelsSection';

// BC-7 目录型渠道商品映射（docs/plan-billing-channel-framework-2026-10-23.md）：
// GET /api/admin/billing/catalog → 已注册映射行 + 套餐价目；对 catalog_based 渠道
// × 套餐 × [monthly, yearly] 的空位给出"未注册"行与注册按钮（收编一次性
// create-products 脚本），改价后逐行"同步价格"对齐渠道目录价。
// 价格真源在 DB（套餐 limits）：行状态按 join 出的套餐价比对，非行内快照。

export interface CatalogMappingRow {
  channel: string;
  plan_code: string;
  interval: string;
  channel_product_id: string;
  synced_price_cents: number;
  plan_price_cents: number;
  synced_at: string;
}

export interface CatalogPlan {
  code: string;
  name: string;
  currency: string;
  monthly_cents: number;
  yearly_cents: number;
}

export interface BillingCatalogEnvelope {
  rows: CatalogMappingRow[];
  plans: CatalogPlan[];
}

export const BILLING_CATALOG_QUERY_KEY = ['admin', 'billing-catalog'] as const;

const INTERVALS = ['monthly', 'yearly'] as const;

const INTERVAL_LABEL: Record<string, string> = {
  monthly: '每月',
  yearly: '每年',
};

function intervalLabel(interval: string): string {
  return INTERVAL_LABEL[interval] ?? interval;
}

interface MappingRow {
  channel: string;
  planCode: string;
  planName: string;
  currency: string;
  interval: string;
  registered: CatalogMappingRow | null;
  /** 套餐当前标价（join plans 算出；孤儿行回退行内 plan_price_cents） */
  expectedCents: number;
}

function buildMappings(
  channels: BillingChannelsEnvelope['channels'],
  rows: CatalogMappingRow[],
  plans: CatalogPlan[],
): MappingRow[] {
  const out: MappingRow[] = [];
  const covered = new Set<string>();
  const comboKey = (c: string, p: string, i: string) => `${c}\u0000${p}\u0000${i}`;

  const catalogChannels = [...channels]
    .filter((c) => c.capabilities.catalog_based)
    .sort(
      (a, b) =>
        a.capabilities.display_order - b.capabilities.display_order ||
        a.name.localeCompare(b.name),
    );

  for (const ch of catalogChannels) {
    for (const plan of plans) {
      for (const interval of INTERVALS) {
        covered.add(comboKey(ch.name, plan.code, interval));
        const registered =
          rows.find(
            (r) =>
              r.channel === ch.name &&
              r.plan_code === plan.code &&
              r.interval === interval,
          ) ?? null;
        out.push({
          channel: ch.name,
          planCode: plan.code,
          planName: plan.name,
          currency: plan.currency,
          interval,
          registered,
          expectedCents:
            interval === 'monthly' ? plan.monthly_cents : plan.yearly_cents,
        });
      }
    }
  }

  // 孤儿行：套餐已下架或渠道非目录型的存量映射，原样展示（价格回退行内快照）
  for (const r of rows) {
    if (covered.has(comboKey(r.channel, r.plan_code, r.interval))) continue;
    covered.add(comboKey(r.channel, r.plan_code, r.interval));
    out.push({
      channel: r.channel,
      planCode: r.plan_code,
      planName: r.plan_code,
      currency: '',
      interval: r.interval,
      registered: r,
      expectedCents: r.plan_price_cents,
    });
  }

  return out;
}

export function CatalogMapping() {
  const api = useApi();
  const qc = useQueryClient();

  // 与 BillingChannelsSection 同键同源（react-query 共享缓存），只读复用
  const channelsQ = useQuery({
    queryKey: BILLING_CHANNELS_QUERY_KEY,
    queryFn: () =>
      api.get<BillingChannelsEnvelope>('/api/admin/billing/channels'),
  });
  const catalogQ = useQuery({
    queryKey: BILLING_CATALOG_QUERY_KEY,
    queryFn: () => api.get<BillingCatalogEnvelope>('/api/admin/billing/catalog'),
  });

  const registerM = useMutation({
    mutationFn: (v: {
      channel: string;
      plan_code: string;
      interval: string;
    }) =>
      api.post<{ channel_product_id: string }>(
        `/api/admin/billing/channels/${encodeURIComponent(v.channel)}/register-product`,
        { plan_code: v.plan_code, interval: v.interval },
      ),
    onSuccess: (_d, v) => {
      toast.success(
        `已注册 ${v.channel} · ${v.plan_code}（${intervalLabel(v.interval)}）商品`,
      );
      void qc.invalidateQueries({ queryKey: BILLING_CATALOG_QUERY_KEY });
    },
    onError: (e) => toast.error(adminError(e, '商品注册失败')),
  });

  const syncM = useMutation({
    mutationFn: (v: {
      channel: string;
      plan_code: string;
      interval: string;
    }) =>
      api.post<{ synced_price_cents: number }>(
        `/api/admin/billing/channels/${encodeURIComponent(v.channel)}/sync-price`,
        { plan_code: v.plan_code, interval: v.interval },
      ),
    onSuccess: (_d, v) => {
      toast.success(
        `已同步 ${v.channel} · ${v.plan_code}（${intervalLabel(v.interval)}）价格`,
      );
      void qc.invalidateQueries({ queryKey: BILLING_CATALOG_QUERY_KEY });
    },
    onError: (e) => toast.error(adminError(e, '价格同步失败')),
  });

  // 未注册任何目录型渠道 → 整卡隐藏（BC-6：catalog_based 渠道才有商品映射）；
  // 加载中/加载失败同样不占位（渠道区错误已在上方"支付渠道"区展示）
  const hasCatalogChannel = (channelsQ.data?.channels ?? []).some(
    (c) => c.capabilities.catalog_based,
  );
  if (!hasCatalogChannel) return null;

  const rows = buildMappings(
    channelsQ.data?.channels ?? [],
    catalogQ.data?.rows ?? [],
    catalogQ.data?.plans ?? [],
  );

  const pendingCombo = (row: MappingRow): boolean => {
    const m = registerM.isPending ? registerM : syncM.isPending ? syncM : null;
    const v = m?.variables;
    return (
      !!v &&
      v.channel === row.channel &&
      v.plan_code === row.planCode &&
      v.interval === row.interval
    );
  };

  const columns: Column<MappingRow>[] = [
    {
      key: 'channel',
      header: '渠道',
      className: 'w-24',
      render: (r) => <span className="text-muted-foreground">{r.channel}</span>,
    },
    {
      key: 'plan',
      header: '套餐',
      render: (r) => (
        <div className="min-w-0 max-w-[12rem]">
          <p className="truncate">{r.planName}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {r.planCode}
          </p>
        </div>
      ),
    },
    {
      key: 'interval',
      header: '周期',
      className: 'w-16',
      render: (r) => intervalLabel(r.interval),
    },
    {
      key: 'product',
      header: '渠道商品 ID',
      render: (r) =>
        r.registered ? (
          <span className="font-mono text-xs break-all text-muted-foreground">
            {r.registered.channel_product_id}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'price',
      header: '同步价',
      className: 'w-40',
      render: (r) => {
        if (!r.registered)
          return <span className="text-muted-foreground">—</span>;
        const currency = r.currency || 'CNY';
        const synced = formatCents(r.registered.synced_price_cents, currency);
        if (r.registered.synced_price_cents === r.expectedCents)
          return (
            <span className="whitespace-nowrap tabular-nums">{synced}</span>
          );
        return (
          <span className="whitespace-nowrap tabular-nums">
            {synced}
            <span className="text-muted-foreground">
              {' '}
              → 目标 {formatCents(r.expectedCents, currency)}
            </span>
          </span>
        );
      },
    },
    {
      key: 'status',
      header: '状态',
      className: 'w-28',
      render: (r) => {
        if (!r.registered)
          return <StatusBadge label="未注册" tone="neutral" />;
        return r.registered.synced_price_cents === r.expectedCents ? (
          <StatusBadge label="已同步" tone="positive" />
        ) : (
          <StatusBadge label="价格待同步" tone="warning" />
        );
      },
    },
    {
      key: 'actions',
      header: '操作',
      className: 'w-28',
      render: (r) => {
        const pending = pendingCombo(r);
        const args = {
          channel: r.channel,
          plan_code: r.planCode,
          interval: r.interval,
        };
        return r.registered ? (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => syncM.mutate(args)}
          >
            {pending ? '同步中…' : '同步价格'}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => registerM.mutate(args)}
          >
            {pending ? '注册中…' : '注册'}
          </Button>
        );
      },
    },
  ];

  return (
    <section className="mt-10">
      <h2 className="text-base font-semibold">渠道商品映射</h2>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        目录型渠道需先注册商品才能收款；改价后在此同步渠道目录价，使买家实付与套餐标价一致。
      </p>
      {catalogQ.isError ? (
        <PageError
          message={adminError(catalogQ.error, '渠道商品映射加载失败')}
          onRetry={() => void catalogQ.refetch()}
        />
      ) : catalogQ.isPending ? (
        <PageLoading label="加载商品映射中…" />
      ) : (catalogQ.data?.plans ?? []).length === 0 ? (
        <PageEmpty label="暂无套餐" hint="套餐创建后在此维护渠道商品映射" />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => `${r.channel}:${r.planCode}:${r.interval}`}
        />
      )}
    </section>
  );
}
