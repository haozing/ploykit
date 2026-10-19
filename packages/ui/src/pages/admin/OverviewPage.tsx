
import { useEffect, useState } from 'react';
import { useLocation, useSearchParamsCompat } from '../../router';
import { Copy, Megaphone } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { components } from '@ploykit/client';
import { DataTable, type Column } from '../../components/DataTable';
import { FormField } from '../../components/FormField';
import {
  PageEmpty,
  PageError,
  PageHeader,
  PageLoading,
} from '../../components/Page';
import { toast } from '../../components/toast';
import { Button } from '../../components/ui/button';
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
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Spinner } from '../../components/ui/spinner';
import { Textarea } from '../../components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import { useApi } from '@ploykit/hooks';
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
  付费工作区: '当前套餐不是免费套餐的工作区数',
  // 近 30 天新增用户的口径含动态数值（近 7 天人数），随 stats 元组逐卡下发
};


function EventTypeCode({ type }: { type: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <code
            tabIndex={0}
            className="block max-w-[16rem] truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
          />
        }
      >
        {type}
      </TooltipTrigger>
      <TooltipContent>{type}</TooltipContent>
    </Tooltip>
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
  
  const [searchParams, setSearchParams] = useSearchParamsCompat();
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
        
        toast.success('公告已发送给全部活跃用户，发送明细可在「审计」页查看');
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
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  tabIndex={0}
                  className="block max-w-[16rem] truncate font-mono text-xs text-muted-foreground"
                />
              }
            >
              {[r.entity_type, r.entity_id].filter(Boolean).join(' ')}
            </TooltipTrigger>
            <TooltipContent>
              {`${r.entity_type ?? ''} ${r.entity_id ?? ''}`}
            </TooltipContent>
          </Tooltip>
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
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    tabIndex={0}
                    className="font-mono text-xs text-muted-foreground"
                  />
                }
              >
                {r.workspace_id.slice(0, 8)}
              </TooltipTrigger>
              <TooltipContent>{r.workspace_id}</TooltipContent>
            </Tooltip>
            {/* B7：短期补偿——ID 无名称解析，给一键复制完整 ID */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-6 p-0 text-muted-foreground"
                    aria-label={`复制工作区 ID ${r.workspace_id}`}
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
                  />
                }
              >
                <Copy size={12} aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>复制完整 ID：{r.workspace_id}</TooltipContent>
            </Tooltip>
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
    // 适配层 useLocation().hash 不带前导 '#'（RR 语义同 tanstack）
    if (hash === 'analytics') {
      document
        .getElementById('admin-analytics')
        ?.scrollIntoView({ block: 'start' });
    }
  }, [hash]);

  // 统计卡收敛（方案 A）：近 7 天 ⊂ 近 30 天，删除 7 天卡，
  // 7 天数值并入 30 天卡的口径 tooltip（第三元为逐卡口径，缺省回退 STATS_CALIBER）
  const stats: [string, number, string?][] = statsQ.data
    ? [
        ['总用户', statsQ.data.total_users],
        ['活跃用户', statsQ.data.active_users],
        ['工作区', statsQ.data.total_workspaces],
        ['付费工作区', statsQ.data.paid_workspaces],
        [
          '近 30 天新增用户',
          statsQ.data.new_users_30d,
          `最近 30 天内注册的用户数；其中近 7 天 ${statsQ.data.new_users_7d.toLocaleString()} 人`,
        ],
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="概览"
        actions={
          <Button onClick={() => setAnnounceOpen(true)}>
            <Megaphone /> 发布公告
          </Button>
        }
      />

      {statsQ.isPending && <PageLoading label="加载指标中…" />}
      {statsQ.isError && (
        <PageError
          message={adminError(statsQ.error, '指标加载失败')}
          onRetry={() => void statsQ.refetch()}
        />
      )}
      {statsQ.isSuccess && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {stats.map(([label, value, caliber]) => {
            const tip = caliber ?? STATS_CALIBER[label];
            return (
              <Card key={label} size="sm">
                <CardHeader>
                  <CardDescription>{label}</CardDescription>
                  {/* 口径说明经 Tooltip 悬停/聚焦查看（UsagePage 先例：CardTitle 无
                      render 通道，Tooltip 套外层、Trigger render 成 span 包标题文本；
                      tabIndex 保键盘可达） */}
                  <CardTitle className="text-2xl font-semibold tabular-nums">
                    {tip ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={<span tabIndex={0} className="cursor-help" />}
                        >
                          {value.toLocaleString()}
                        </TooltipTrigger>
                        <TooltipContent>{tip}</TooltipContent>
                      </Tooltip>
                    ) : (
                      value.toLocaleString()
                    )}
                  </CardTitle>
                </CardHeader>
              </Card>
            );
          })}
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
          <CardAction>
            <Select
              value={recentType || 'all'}
              onValueChange={(v) => {
                const next = typeof v === 'string' && v !== 'all' ? v : '';
                setRecentType(next);
                updateParams({ type: next });
              }}
            >
              <SelectTrigger size="sm" aria-label="按事件类型筛选最近事件">
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
              最近事件加载失败（{apiErrorMessage(recentQ.error, '未知错误')}）
              <Button
                variant="link"
                size="sm"
                onClick={() => void recentQ.refetch()}
              >
                重试
              </Button>
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
                    label={`最近没有「${recentType}」事件`}
                    hint="清除类型过滤可查看全部事件"
                  />
                ) : (
                  <PageEmpty
                    label="暂无事件"
                    hint="工作区内产生业务事件后会出现在这里"
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
              <h2 className="font-medium">事件汇总</h2>
            </CardTitle>
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
                事件汇总加载失败（
                {apiErrorMessage(analyticsQ.error, '未知错误')}）
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => void analyticsQ.refetch()}
                >
                  重试
                </Button>
              </p>
            ) : (
              <DataTable
                columns={analyticsColumns}
                rows={analyticsQ.data ?? []}
                rowKey={(r) => r.event_type}
                loading={analyticsQ.isPending}
                empty={
                  <PageEmpty
                    label="暂无事件"
                    hint="用户开始使用产品后，事件会出现在这里；若产品已运行仍为空，通常是事件上报未接入"
                  />
                }
              />
            )}
          </div>
        </Card>
      </section>

      {/* 发布公告：target user/all；title/body 必填，link 可选；同题同日去重。
          B6：文案去 API 词汇（type=/user_id/uuid/审计事件名）。 */}
      <Dialog open={announceOpen} onOpenChange={setAnnounceOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>发布公告</DialogTitle>
            <DialogDescription>
              以站内通知发送。「全部活跃用户」单次上限 1000
              人；同标题同日只发一次（重复发送自动跳过）。
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
                  placeholder="粘贴完整用户 ID（可从用户详情页获取）"
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
              <Textarea
                id="announce-body"
                className="min-h-24"
                placeholder="如：维护期间系统将短暂不可用，请提前保存工作"
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
              {notifyM.isPending ? (
                <>
                  <Spinner aria-hidden="true" />
                  发送
                </>
              ) : (
                '发送'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
