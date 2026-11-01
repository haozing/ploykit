
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
import { useT } from '../../i18n';

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

// 统计卡口径 i18n key（原 zh 字面量 map，B 方案 i18n 后改为 key → 字典翻译；
// 近 30 天新增用户的口径含动态数值（近 7 天人数），随 stats 元组逐卡下发）


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

// 事件汇总表列定义已移入组件（i18n：表头走组件级 t()，随 Provider 语言切换）
export function OverviewPage() {
  const t = useT();
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
        toast.success(
          typeof r.failed === 'number' && r.failed > 0
            ? t('admin.overview.announceSentSome', { sent: r.sent, failed: r.failed })
            : t('admin.overview.announceSent', { sent: r.sent }),
        );
      } else if (target === 'user') {
        toast.success(t('admin.overview.announceSentUser'));
      } else {

        toast.success(t('admin.overview.announceSentAll'));
      }
      setAnnounceOpen(false);
      setTitle('');
      setBody('');
      setLink('');
      setTargetUser('');
    },
    onError: (e) => toast.error(adminError(e, t('admin.overview.announceSendFailed'))),
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
      header: t('admin.overview.colEventType'),
      render: (r) => <EventTypeCode type={r.event_type} />,
    },
    {
      key: 'entity',
      header: t('admin.overview.colEntity'),
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
      header: t('admin.overview.colWorkspace'),
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
                    aria-label={t('admin.overview.copyWsIdAria', { id: r.workspace_id })}
                    onClick={() => {
                      const full = r.workspace_id ?? '';
                      if (typeof navigator.clipboard?.writeText === 'function') {
                        void navigator.clipboard
                          .writeText(full)
                          .then(() => toast.success(t('admin.overview.wsIdCopied')))
                          .catch(() =>
                            toast.error(t('admin.overview.copyFailedFull', { value: full })),
                          );
                      } else {
                        toast.info(t('admin.overview.copyUnsupported', { value: full }));
                      }
                    }}
                  />
                }
              >
                <Copy size={12} aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>
                {t('admin.overview.copyFullIdTip', { id: r.workspace_id })}
              </TooltipContent>
            </Tooltip>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {t('admin.overview.workspacePlatform')}
          </span>
        ),
    },
    {
      key: 'created_at',
      header: t('admin.overview.colTime'),
      className: 'w-44',
      render: (r) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDateTime(r.created_at)}
        </span>
      ),
    },
  ];

  // 事件汇总表列（i18n：表头走组件级 t()）
  const analyticsColumns: Column<AnalyticsRow>[] = [
    {
      key: 'event_type',
      header: t('admin.overview.colEventType'),
      render: (r) => <EventTypeCode type={r.event_type} />,
    },
    {
      key: 'count',
      header: t('admin.overview.colCount'),
      className: 'w-24 text-right',
      render: (r) => (
        <span className="font-medium tabular-nums">
          {r.count.toLocaleString()}
        </span>
      ),
    },
    {
      key: 'last_at',
      header: t('admin.overview.colLastAt'),
      className: 'w-44',
      render: (r) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDateTime(r.last_at)}
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
  // 7 天数值并入 30 天卡的口径 tooltip（第三元为逐卡已翻译口径，无则无 tooltip）
  const stats: [string, number, string?][] = statsQ.data
    ? [
        ['admin.overview.statTotalUsers', statsQ.data.total_users, t('admin.overview.caliberTotalUsers')],
        ['admin.overview.statActiveUsers', statsQ.data.active_users, t('admin.overview.caliberActiveUsers')],
        ['admin.overview.statWorkspaces', statsQ.data.total_workspaces],
        ['admin.overview.statPaidWorkspaces', statsQ.data.paid_workspaces, t('admin.overview.caliberPaidWorkspaces')],
        [
          'admin.overview.statNewUsers30d',
          statsQ.data.new_users_30d,
          t('admin.overview.caliberNewUsers30d', {
            n7d: statsQ.data.new_users_7d.toLocaleString(),
          }),
        ],
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin.overview.pageTitle')}
        actions={
          <Button onClick={() => setAnnounceOpen(true)}>
            <Megaphone /> {t('admin.overview.announceBtn')}
          </Button>
        }
      />

      {statsQ.isPending && <PageLoading label={t('admin.overview.loadingStats')} />}
      {statsQ.isError && (
        <PageError
          message={adminError(statsQ.error, t('admin.overview.statsLoadFailed'))}
          onRetry={() => void statsQ.refetch()}
        />
      )}
      {statsQ.isSuccess && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {stats.map(([labelKey, value, tip]) => {
            return (
              <Card key={labelKey} size="sm">
                <CardHeader>
                  <CardDescription>{t(labelKey)}</CardDescription>
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
            <h2 className="font-medium">{t('admin.overview.recentTitle')}</h2>
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
              <SelectTrigger size="sm" aria-label={t('admin.overview.recentTypeAria')}>
                <SelectValue>{recentType || t('admin.overview.allTypes')}</SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="all">{t('admin.overview.allTypes')}</SelectItem>
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
              {t('admin.overview.recentLoadFailed', {
                reason: apiErrorMessage(recentQ.error, t('admin.overview.unknownError')),
              })}
              <Button
                variant="link"
                size="sm"
                onClick={() => void recentQ.refetch()}
              >
                {t('admin.overview.retry')}
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
                    label={t('admin.overview.recentEmptyFiltered', { type: recentType })}
                    hint={t('admin.overview.recentEmptyFilteredHint')}
                  />
                ) : (
                  <PageEmpty
                    label={t('admin.overview.noEvents')}
                    hint={t('admin.overview.noEventsHint')}
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
              <h2 className="font-medium">{t('admin.overview.summaryTitle')}</h2>
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
                <SelectTrigger size="sm" aria-label={t('admin.overview.rangeAria')}>
                  <SelectValue>{t('admin.overview.lastNDays', { days })}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  {DAY_OPTIONS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {t('admin.overview.lastNDays', { days: d })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardAction>
          </CardHeader>
          <div className="px-6">
            {analyticsQ.isError ? (
              <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                {t('admin.overview.summaryLoadFailed', {
                  reason: apiErrorMessage(analyticsQ.error, t('admin.overview.unknownError')),
                })}
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => void analyticsQ.refetch()}
                >
                  {t('admin.overview.retry')}
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
                    label={t('admin.overview.noEvents')}
                    hint={t('admin.overview.noEventsAnalyticsHint')}
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
            <DialogTitle>{t('admin.overview.announceBtn')}</DialogTitle>
            <DialogDescription>
              {t('admin.overview.announceDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <FormField label={t('admin.overview.targetLabel')} htmlFor="announce-target">
              <Select
                value={target}
                onValueChange={(v) => {
                  if (v === 'user' || v === 'all') setTarget(v);
                }}
              >
                <SelectTrigger id="announce-target" aria-label={t('admin.overview.targetLabel')}>
                  <SelectValue>
                    {target === 'all'
                      ? t('admin.overview.targetAll')
                      : t('admin.overview.targetUser')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value="all">{t('admin.overview.targetAll')}</SelectItem>
                  <SelectItem value="user">{t('admin.overview.targetUser')}</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            {target === 'user' && (
              <FormField label={t('admin.overview.userIdLabel')} htmlFor="announce-user">
                <Input
                  id="announce-user"
                  className="font-mono"
                  placeholder={t('admin.overview.userIdPh')}
                  value={targetUser}
                  onChange={(e) => setTargetUser(e.target.value)}
                />
              </FormField>
            )}
            <FormField label={t('admin.overview.titleLabel')} htmlFor="announce-title">
              <Input
                id="announce-title"
                placeholder={t('admin.overview.titlePh')}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </FormField>
            <FormField label={t('admin.overview.bodyLabel')} htmlFor="announce-body">
              <Textarea
                id="announce-body"
                className="min-h-24"
                placeholder={t('admin.overview.bodyPh')}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </FormField>
            <FormField label={t('admin.overview.linkLabel')} htmlFor="announce-link">
              <Input
                id="announce-link"
                placeholder={t('admin.overview.linkPh')}
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnnounceOpen(false)}>
              {t('admin.overview.cancel')}
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
                  {t('admin.overview.send')}
                </>
              ) : (
                t('admin.overview.send')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
