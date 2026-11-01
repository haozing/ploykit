
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParamsCompat } from '../../router';
import {
  MoreHorizontal,
  LogIn,
  ShieldCheck,
  ShieldOff,
  UserCog,
  UserRoundSearch,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@ploykit/client';
import { useConfirm } from '../../components/ConfirmDialog';
import { DataTable, type Column } from '../../components/DataTable';
import { PageEmpty, PageError, PageHeader } from '../../components/Page';
import { ImpactConfirmation } from '../../components/SecretModal';
import { toast } from '../../components/toast';
import { Badge } from '../../components/ui/badge'
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { useApi } from '@ploykit/hooks';
import { useAuth } from '@ploykit/hooks';
import { useT } from '../../i18n';
import { formatDate, formatDateTime } from '../../lib/utils';
import {
  ADMIN_PAGE_SIZE,
  adminError,
  adminListQuery,
  type AdminListEnvelope,
} from './shared';

type AdminUser = components['schemas']['AdminUser'];


// 状态过滤选项：label 走 i18n 字典（g2 分片），组件内按 labelKey 取文案。
const STATUS_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'active', labelKey: 'admin.users.statusActive' },
  { value: 'disabled', labelKey: 'admin.users.statusBanned' },
];

type RowAction =
  | { kind: 'disable'; user: AdminUser }
  | { kind: 'enable'; user: AdminUser }
  | { kind: 'impersonate'; user: AdminUser };

export interface UsersPageProps {
  
  impersonatePath?: string;
}

export function UsersPage({ impersonatePath = '/app' }: UsersPageProps = {}) {
  const api = useApi();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const me = useAuth().user;
  const t = useT();
  const statusOptions = STATUS_OPTIONS.map((s) => ({ value: s.value, label: t(s.labelKey) }));
  
  
  const [searchParams, setSearchParams] = useSearchParamsCompat();
  const q = searchParams.get('q') ?? '';
  const statusParam = searchParams.get('status') ?? '';
  const status = STATUS_OPTIONS.some((s) => s.value === statusParam)
    ? statusParam
    : '';
  const page = Math.max(
    1,
    Number.parseInt(searchParams.get('page') ?? '1', 10) || 1,
  );
  const applyFilter = (nextQ: string, nextStatus: string, nextPage: number) => {
    const p = new URLSearchParams(searchParams);
    if (nextQ) p.set('q', nextQ);
    else p.delete('q');
    if (nextStatus) p.set('status', nextStatus);
    else p.delete('status');
    if (nextPage > 1) p.set('page', String(nextPage));
    else p.delete('page');
    setSearchParams(p, { replace: true });
  };
  const [searchInput, setSearchInput] = useState(q);
  const [action, setAction] = useState<RowAction | null>(null);

  
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchInput.trim();
      if (next !== q) applyFilter(next, status, 1);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const usersQ = useQuery({
    queryKey: ['admin', 'users', page, q, status],
    queryFn: () =>
      api.get<AdminListEnvelope<AdminUser>>(
        `/api/admin/users${adminListQuery(page, ADMIN_PAGE_SIZE, { q, status })}`,
      ),
  });

  
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'user'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
  };

  const statusM = useMutation({
    mutationFn: (v: { user: AdminUser; status: 'active' | 'disabled' }) =>
      api.patch(`/api/admin/users/${v.user.id}/status`, { status: v.status }),
    onSuccess: (_d, v) => {
      toast.success(
        v.status === 'disabled'
          ? t('admin.users.banToast', { email: v.user.email })
          : t('admin.users.unbanToast', { email: v.user.email }),
      );
      setAction(null);
      void invalidate();
    },
    onError: (e) => toast.error(adminError(e, t('admin.users.actionFailed'))),
  });

  const adminFlagM = useMutation({
    mutationFn: (v: { user: AdminUser; isAdmin: boolean }) =>
      api.patch(`/api/admin/users/${v.user.id}/admin`, { is_admin: v.isAdmin }),
    onSuccess: (_d, v) => {
      toast.success(
        v.isAdmin
          ? t('admin.users.grantAdminToast', { email: v.user.email })
          : t('admin.users.revokeAdminToast', { email: v.user.email }),
      );
      void invalidate();
    },
    onError: (e) => toast.error(adminError(e, t('admin.users.actionFailed'))),
  });

  
  const impersonateM = useMutation({
    mutationFn: (user: AdminUser) =>
      api.post(`/api/admin/users/${user.id}/impersonate`),
    onSuccess: () => {
      window.location.href = impersonatePath;
    },
    onError: (e) => {
      toast.error(adminError(e, t('admin.users.impersonateFailed')));
      setAction(null);
    },
  });

  const onToggleAdmin = async (user: AdminUser) => {
    const revoke = user.is_platform_admin;
    const ok = await confirm({
      title: revoke ? t('admin.users.revokeAdmin') : t('admin.users.grantAdmin'),
      description: revoke
        ? t('admin.users.revokeAdminDesc', { email: user.email })
        : t('admin.users.grantAdminDesc', { email: user.email }),
      confirmText: revoke
        ? t('admin.users.revokeAdminConfirm')
        : t('admin.users.grantAdminConfirm'),
      danger: revoke,
    });
    if (ok) adminFlagM.mutate({ user, isAdmin: !revoke });
  };

  const raw = usersQ.data?.items ?? [];
  const total = usersQ.data?.total ?? 0;
  
  const pastEnd = !usersQ.isPending && raw.length === 0 && page > 1;
  const filtered = !!(q || status);

  const columns: Column<AdminUser>[] = [
    {
      key: 'email',
      header: t('admin.users.colUser'),
      render: (u) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {u.email}
            {u.is_platform_admin && (
              <Badge variant="secondary" className="ml-2">
                {t('admin.users.platformAdminBadge')}
              </Badge>
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {u.display_name || '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('admin.users.colStatus'),
      className: 'w-24',
      render: (u) => <StatusBadge status={u.status} />,
    },
    {
      key: 'email_verified',
      header: t('admin.users.colEmailVerified'),
      className: 'w-24',
      render: (u) =>
        u.email_verified ? (
          <Badge variant="outline">{t('admin.users.verifiedBadge')}</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            {t('admin.users.unverifiedBadge')}
          </Badge>
        ),
    },
    {
      key: 'created_at',
      header: t('admin.users.colCreatedAt'),
      className: 'w-28',
      render: (u) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDate(u.created_at)}
        </span>
      ),
    },
    {
      key: 'last_login_at',
      header: t('admin.users.colLastLogin'),
      className: 'w-44',
      render: (u) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {u.last_login_at ? formatDateTime(u.last_login_at) : t('admin.users.neverSignedIn')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('admin.users.colActions'),
      className: 'w-16',
      render: (u) => {

        if (me?.id === u.id) {
          return (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/admin/users/${u.id}`)}
            >
              <UserRoundSearch /> {t('admin.users.detailsBtn')}
            </Button>
          );
        }
        return (
          <DropdownMenu>
            {/* 触发器走 Button（WebhooksPage 先例 render 挂法）：获得 Button
                语义与一致的可视态，aria-label 保留行级语义（操作 {email}） */}
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('admin.users.rowActionsAria', { email: u.email })}
                />
              }
            >
              <MoreHorizontal size={16} aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {/* GroupLabel 必须包在 Group 内（Base UI Menu.GroupLabel 渲染即读组上下文，
                  裸置于 Content 会 throw #31 整页崩溃——B-users-1 S0 修复） */}
              <DropdownMenuGroup>
                <DropdownMenuLabel className="truncate">
                  {u.email}
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => navigate(`/admin/users/${u.id}`)}
              >
                <UserRoundSearch /> {t('admin.users.menuUserDetail')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {u.status === 'active' ? (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setAction({ kind: 'disable', user: u })}
                >
                  <ShieldOff /> {t('admin.users.menuBan')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() => setAction({ kind: 'enable', user: u })}
                >
                  <ShieldCheck /> {t('admin.users.menuUnban')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => void onToggleAdmin(u)}>
                <UserCog />{' '}
                {u.is_platform_admin ? t('admin.users.revokeAdmin') : t('admin.users.grantAdmin')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* 管理员互模被服务端禁止（防权限逃逸），行内禁用入口 */}
              <DropdownMenuItem
                disabled={u.is_platform_admin}
                onClick={() => setAction({ kind: 'impersonate', user: u })}
              >
                <LogIn /> {t('admin.users.menuImpersonate')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader title={t('admin.users.title')} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          className="w-72"
          placeholder={t('admin.users.searchPlaceholder')}
          aria-label={t('admin.users.searchAria')}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyFilter(searchInput.trim(), status, 1);
          }}
        />
        <Select
          value={status || 'all'}
          onValueChange={(v) => {
            const next =
              typeof v === 'string' && v !== 'all' ? v : '';
            applyFilter(q, next, 1);
          }}
        >
          <SelectTrigger size="sm" className="w-44" aria-label={t('admin.users.filterStatusAria')}>
            <SelectValue>
              {status
                ? (statusOptions.find((s) => s.value === status)?.label ??
                  status)
                : t('admin.users.allStatuses')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="all">{t('admin.users.allStatuses')}</SelectItem>
            {statusOptions.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => {
              setSearchInput('');
              applyFilter('', '', 1);
            }}
          >
            {t('admin.users.clearFilters')}
          </Button>
        )}
      </div>

      {usersQ.isError ? (
        <PageError
          message={adminError(usersQ.error, t('admin.users.loadFailed'))}
          onRetry={() => void usersQ.refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={raw}
          rowKey={(u) => u.id}
          loading={usersQ.isPending}
          pagination={{
            page,
            pageSize: ADMIN_PAGE_SIZE,
            total,
            onPageChange: (p) => applyFilter(q, status, p),
          }}
          empty={
            pastEnd ? (
              <div className="flex flex-col items-center gap-2">
                <PageEmpty
                  label={t('admin.users.emptyPastEnd')}
                  hint={t('admin.users.emptyPastEndHint')}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => applyFilter(q, status, 1)}
                >
                  {t('admin.users.backToFirstPage')}
                </Button>
              </div>
            ) : filtered ? (
              <PageEmpty
                label={t('admin.users.emptyNoMatch')}
                hint={t('admin.users.emptyNoMatchHint')}
              />
            ) : (
              <PageEmpty label={t('admin.users.emptyNoUsers')} />
            )
          }
        />
      )}

      {/* 封禁/解封：影响确认（勾选接受后才可执行） */}
      <ImpactConfirmation
        open={action?.kind === 'disable' || action?.kind === 'enable'}
        onOpenChange={(o) => !o && setAction(null)}
        title={
          action?.kind === 'disable'
            ? t('admin.users.banTitle', { email: action.user.email })
            : action?.kind === 'enable'
              ? t('admin.users.unbanTitle', { email: action.user.email })
              : ''
        }
        danger={action?.kind === 'disable'}
        confirmText={action?.kind === 'disable' ? t('admin.users.banConfirm') : t('admin.users.unbanConfirm')}
        impacts={
          action?.kind === 'disable'
            ? [
                t('admin.users.impactBanLogin'),
                t('admin.users.impactDataKept'),
                t('admin.users.impactAuditLog'),
              ]
            : [t('admin.users.impactUnbanLogin'), t('admin.users.impactAuditLog')]
        }
        onConfirm={() => {
          if (action) {
            statusM.mutate({
              user: action.user,
              status: action.kind === 'disable' ? 'disabled' : 'active',
            });
          }
        }}
      />

      {/* 模拟登录：影响确认；成功后整页跳 /app（Cookie 已被目标会话覆盖） */}
      <ImpactConfirmation
        open={action?.kind === 'impersonate'}
        onOpenChange={(o) => !o && setAction(null)}
        title={
          action?.kind === 'impersonate'
            ? t('admin.users.impersonateTitle', { email: action.user.email })
            : ''
        }
        confirmText={t('admin.users.impersonateConfirm')}
        pending={impersonateM.isPending}
        impacts={[
          t('admin.users.impactImpersonateBrowser'),
          t('admin.users.impactImpersonateSession'),
          t('admin.users.impactImpersonateAudit'),
        ]}
        onConfirm={() => {
          if (action?.kind === 'impersonate') impersonateM.mutate(action.user);
        }}
      />
    </div>
  );
}
