
import { useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { Copy, Megaphone } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { components } from '@ploykit/client';
import { DataTable, type Column } from '../../components/DataTable';
import { FormField } from '../../components/FormField';
import { PageEmpty, PageError, PageHeader } from '../../components/Page';
import { toast } from '../../components/toast';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/Input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { useApi } from '../../hooks/useApi';
import { apiErrorMessage } from '../../lib/api-error';
import { formatDateTime } from '../../lib/utils';
import { adminError } from './shared';

type AdminStats = components['schemas']['AdminStats'];
type AnalyticsRow = components['schemas']['AnalyticsSummaryRow'];


interface RecentEventRow {
  id: number;
  workspace_id?: string;
  user_id?: string;
  event_type: string;
  entity_type?: string;
  entity_id?: string;
  payload: Record<string, unknown>;
  created_at: string;
}

const DAY_OPTIONS = [7, 14, 30, 90];
const RECENT_LIMIT = 20;


const STATS_CALIBER: Record<string, string> = {
  总用户: '全部注册用户（含已封禁）',
  活跃用户: '状态为「生效中」的用户数（非登录活跃度）',
  工作区: '全部工作区总数',
  付费工作区: '当前套餐不是免费套餐的工作区数',
  '近 7 天新增用户': '最近 7 天内注册的用户数',
  '近 30 天新增用户': '最近 30 天内注册的用户数',
};


function EventTypeCode({ type }: { type: string }) {
  return (
    <code
      className="block max-w-[16rem] truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
      title={type}
    >
      {type}
    </code>
  );
}

const analyticsColumns: Column<AnalyticsRow>[] = [
  {
    key: 'event_type',
    header: '事件类型',
    render: (r) => <EventTypeCode type={r.event_type} />,
  },
  {
    key: 'count',
    header: '次数',
    className: 'w-24 text-right',
    render: (r) => (
      <span className="font-medium tabular-nums">
        {r.count.toLocaleString()}
      </span>
    ),
  },
  {
    key: 'last_at',
    header: '最近发生',
    className: 'w-44',
    render: (r) => (
      <span className="whitespace-nowrap text-muted-foreground">
        {formatDateTime(r.last_at)}
      </span>
    ),
  },
];

export function OverviewPage() {
  const api = useApi();
  const { hash } = useLocation();
  
  const [searchParams, setSearchParams] = useSearchParams();
  const daysParam = Number(searchParams.get('days'));
  const [days, setDays] = useState(
    DAY_OPTIONS.includes(daysParam) ? daysParam : 7,
  );
  const [recentType, setRecentType] = useState(searchParams.get('type') ?? '');

  
  const updateParams = (next: { days?: number; type?: string }) => {
    const p = new URLSearchParams(searchParams);
    if (next.days !== undefined) {
      if (next.days === 7) p.delete('days');
      else p.set('days', String(next.days));
    }
    if (next.type !== undefined) {
      if (next.type === '') p.delete('type');
      else p.set('type', next.type);
    }
    setSearchParams(p, { replace: true });
  };

  
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [target, setTarget] = useState<'all' | 'user'>('all');
  const [targetUser, setTargetUser] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');

  const notifyM = useMutation({
    mutationFn: () =>
      api.post<{ status?: string; sent?: number; failed?: number }>(
        '/api/admin/notify',
        {
          target,
          user_id: target === 'user' ? targetUser.trim() : undefined,
          title: title.trim(),
          body: body.trim(),
          link: link.trim() || undefined,
        },
      ),
    onSuccess: (r) => {
      
      
      if (typeof r?.sent === 'number') {
        const failedSuffix =
          typeof r.failed === 'number' && r.failed > 0
            ? `，失败 ${r.failed}`
            : '';
        toast.success(`公告已发送：成功 ${r.sent}${failedSuffix}`);
      } else if (target === 'user') {
        toast.success('公告已发送给指定用户');
      } else {
        
        toast.success('公告已全员发送，逐人明细可在「审计」页查看');
      }
      setAnnounceOpen(false);
      setTitle('');
      setBody('');
      setLink('');
      setTargetUser('');
    },
    onError: (e) => toast.error(adminError(e, '公告发送失败')),
  });

  const statsQ = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => api.get<AdminStats>('/api/admin/stats'),
  });
  const analyticsQ = useQuery({
    queryKey: ['admin', 'analytics', days],
    queryFn: () => api.get<AnalyticsRow[]>(`/api/admin/analytics?days=${days}`),
  });

  
  
  
  const [knownTypes, setKnownTypes] = useState<string[]>([]);
  useEffect(() => {
    const types = (analyticsQ.data ?? []).map((r) => r.event_type);
    if (types.length === 0) return;
    setKnownTypes((prev) => {
      const merged = Array.from(new Set([...prev, ...types])).sort();
      
      return merged.length === prev.length ? prev : merged;
    });
  }, [analyticsQ.data]);

  const recentQ = useQuery({
    queryKey: ['admin', 'analytics-recent', recentType],
    queryFn: () =>
      api.get<RecentEventRow[]>(
        `/api/admin/analytics/recent?limit=${RECENT_LIMIT}${recentType ? `&type=${encodeURIComponent(recentType)}` : ''}`,
      ),
  });
  const recentColumns: Column<RecentEventRow>[] = [
    {
      key: 'event_type',
      header: '事件类型',
      render: (r) => <EventTypeCode type={r.event_type} />,
    },
    {
      key: 'entity',
      header: '对象',
      render: (r) =>
        r.entity_type || r.entity_id ? (
          <span
            className="block max-w-[16rem] truncate font-mono text-xs text-muted-foreground"
            title={`${r.entity_type ?? ''} ${r.entity_id ?? ''}`}
          >
            {[r.entity_type, r.entity_id].filter(Boolean).join(' ')}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: 'workspace_id',
      header: '工作区',
      className: 'w-32',
      render: (r) =>
        r.workspace_id ? (
          <span className="flex items-center gap-1">
            <span
              className="font-mono text-xs text-muted-foreground"
              title={r.workspace_id}
            >
              {r.workspace_id.slice(0, 8)}
            </span>
            {/* B7：短期补偿——ID 无名称解析，给一键复制完整 ID */}
            <Button
              variant="ghost"
              size="sm"
              className="size-6 p-0 text-muted-foreground"
              aria-label={`复制工作区 ID ${r.workspace_id}`}
              title={`复制完整 ID：${r.workspace_id}`}
              onClick={() => {
                const full = r.workspace_id ?? '';
                if (typeof navigator.clipboard?.writeText === 'function') {
                  void navigator.clipboard
                    .writeText(full)
                    .then(() => toast.success('工作区 ID 已复制'))
                    .catch(() =>
                      toast.error(`复制失败，完整 ID：${full}`),
                    );
                } else {
                  toast.info(`当前环境不支持自动复制，完整 ID：${full}`);
                }
              }}
            >
              <Copy size={12} aria-hidden="true" />
            </Button>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">平台</span>
        ),
    },
    {
      key: 'created_at',
      header: '时间',
      className: 'w-44',
      render: (r) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDateTime(r.created_at)}
        </span>
      ),
    },
  ];

  
  useEffect(() => {
    if (hash === '#analytics') {
      document
        .getElementById('admin-analytics')
        ?.scrollIntoView({ block: 'start' });
    }
  }, [hash]);

  const stats: [string, number][] = statsQ.data
    ? [
        ['总用户', statsQ.data.total_users],
        ['活跃用户', statsQ.data.active_users],
        ['工作区', statsQ.data.total_workspaces],
        ['付费工作区', statsQ.data.paid_workspaces],
        ['近 7 天新增用户', statsQ.data.new_users_7d],
        ['近 30 天新增用户', statsQ.data.new_users_30d],
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="概览"
        description="平台全局指标与事件埋点汇总"
        actions={
          <Button onClick={() => setAnnounceOpen(true)}>
            <Megaphone /> 发布公告
          </Button>
        }
      />

      {statsQ.isPending && (
        <p className="text-sm text-muted-foreground">加载指标中…</p>
      )}
      {statsQ.isError && (
        <PageError
          message={adminError(statsQ.error, '指标加载失败')}
          onRetry={() => void statsQ.refetch()}
        />
      )}
      {statsQ.isSuccess && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {stats.map(([label, value]) => (
            <Card key={label} size="sm" title={STATS_CALIBER[label]}>
              <CardHeader>
                <CardDescription>{label}</CardDescription>
                <CardTitle className="text-2xl font-semibold tabular-nums">
                  {value.toLocaleString()}
                </CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {/* 批次 3.3（AN3 活动流）：最近埋点事件倒序 20 条；类型过滤选项跨范围累积
          （B4）。空态区分：全类型无事件 = 管线未接/无流量；过滤后无事件 = 换类型。
          B11：区块名升格 h2，标题在上、说明在下（修视觉倒挂）。 */}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="font-medium">最近事件</h2>
          </CardTitle>
          <CardDescription>活动流：近端埋点事件，按时间倒序</CardDescription>
          <CardAction>
            <Select
              value={recentType || 'all'}
              onValueChange={(v) => {
                const next = typeof v === 'string' && v !== 'all' ? v : '';
                setRecentType(next);
                updateParams({ type: next });
              }}
            >
              <SelectTrigger size="sm" aria-label="按事件类型过滤活动流">
                <SelectValue>{recentType || '全部类型'}</SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="all">全部类型</SelectItem>
                {knownTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardAction>
        </CardHeader>
        <div className="px-6">
          {recentQ.isError ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              活动流加载失败（{apiErrorMessage(recentQ.error, '未知错误')}）
              <button
                className="underline"
                onClick={() => void recentQ.refetch()}
              >
                重试
              </button>
            </p>
          ) : (
            <DataTable
              columns={recentColumns}
              rows={recentQ.data ?? []}
              rowKey={(r) => String(r.id)}
              loading={recentQ.isPending}
              empty={
                recentType ? (
                  <PageEmpty
                    label={`近端无 ${recentType} 事件`}
                    hint="换个类型或清除过滤"
                  />
                ) : (
                  <PageEmpty
                    label="暂无埋点事件"
                    hint="业务流量到达后在此实时可见（analytics 管线产物）"
                  />
                )
              }
            />
          )}
        </div>
      </Card>

      <section id="admin-analytics" className="scroll-mt-4">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="font-medium">事件埋点汇总</h2>
            </CardTitle>
            <CardDescription>按事件类型聚合的出现次数与最近发生时间</CardDescription>
            <CardAction>
              <Select
                value={days}
                onValueChange={(v) => {
                  if (typeof v === 'number') {
                    setDays(v);
                    updateParams({ days: v });
                  }
                }}
              >
                <SelectTrigger size="sm" aria-label="统计时间范围">
                  <SelectValue>近 {days} 天</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  {DAY_OPTIONS.map((d) => (
                    <SelectItem key={d} value={d}>
                      近 {d} 天
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardAction>
          </CardHeader>
          <div className="px-6">
            {analyticsQ.isError ? (
              <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                埋点汇总加载失败（
                {apiErrorMessage(analyticsQ.error, '未知错误')}）
                <button
                  className="underline"
                  onClick={() => void analyticsQ.refetch()}
                >
                  重试
                </button>
              </p>
            ) : (
              <DataTable
                columns={analyticsColumns}
                rows={analyticsQ.data ?? []}
                rowKey={(r) => r.event_type}
                loading={analyticsQ.isPending}
                empty={
                  <PageEmpty
                    label="暂无埋点事件"
                    hint="近期没有事件写入，或埋点管线未接线"
                  />
                }
              />
            )}
          </div>
        </Card>
      </section>

      <p className="text-xs text-muted-foreground">
        <Badge variant="outline" className="mr-1">
          提示
        </Badge>
        管理台数据为平台级视图；用户/工作区的具体操作见左侧导航。
      </p>

      {/* 发布公告：target user/all；title/body 必填，link 可选；同题同日去重。
          B6：文案去 API 词汇（type=/user_id/uuid/审计事件名）。 */}
      <Dialog open={announceOpen} onOpenChange={setAnnounceOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>发布公告</DialogTitle>
            <DialogDescription>
              以站内通知发送。全员模式单次上限 1000 人；同标题同日只发一次（重复
              发送自动跳过）。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <FormField label="收件范围" htmlFor="announce-target">
              <Select
                value={target}
                onValueChange={(v) => {
                  if (v === 'user' || v === 'all') setTarget(v);
                }}
              >
                <SelectTrigger id="announce-target" aria-label="收件范围">
                  <SelectValue>
                    {target === 'all' ? '全部活跃用户' : '指定用户'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value="all">全部活跃用户</SelectItem>
                  <SelectItem value="user">指定用户</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            {target === 'user' && (
              <FormField label="用户 ID（必填）" htmlFor="announce-user">
                <Input
                  id="announce-user"
                  className="font-mono"
                  placeholder="输入目标用户的用户 ID"
                  value={targetUser}
                  onChange={(e) => setTargetUser(e.target.value)}
                />
              </FormField>
            )}
            <FormField label="标题（必填）" htmlFor="announce-title">
              <Input
                id="announce-title"
                placeholder="如：今晚 22:00 例行维护"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </FormField>
            <FormField label="正文（必填）" htmlFor="announce-body">
              <textarea
                id="announce-body"
                className="flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="公告内容（支持多行）"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </FormField>
            <FormField label="跳转链接（可选）" htmlFor="announce-link">
              <Input
                id="announce-link"
                placeholder="https://… 或站内页面路径；填写后通知可点击跳转"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnnounceOpen(false)}>
              取消
            </Button>
            <Button
              disabled={
                notifyM.isPending ||
                !title.trim() ||
                !body.trim() ||
                (target === 'user' && !targetUser.trim())
              }
              onClick={() => notifyM.mutate()}
            >
              {notifyM.isPending ? '发送中…' : '发送'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
