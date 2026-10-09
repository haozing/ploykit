
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
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
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { formatDate, formatDateTime } from '../../lib/utils';
import {
  ADMIN_PAGE_SIZE,
  adminError,
  adminListQuery,
  type AdminListEnvelope,
} from './shared';

type AdminUser = components['schemas']['AdminUser'];


const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'active', label: '生效中' },
  { value: 'disabled', label: '已封禁' },
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
  
  
  const [searchParams, setSearchParams] = useSearchParams();
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
    const t = setTimeout(() => {
      const next = searchInput.trim();
      if (next !== q) applyFilter(next, status, 1);
    }, 300);
    return () => clearTimeout(t);
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
        `${v.user.email} 已${v.status === 'disabled' ? '封禁' : '解封'}`,
      );
      setAction(null);
      void invalidate();
    },
    onError: (e) => toast.error(adminError(e, '操作失败')),
  });

  const adminFlagM = useMutation({
    mutationFn: (v: { user: AdminUser; isAdmin: boolean }) =>
      api.patch(`/api/admin/users/${v.user.id}/admin`, { is_admin: v.isAdmin }),
    onSuccess: (_d, v) => {
      toast.success(
        `${v.user.email} ${v.isAdmin ? '已授予' : '已撤销'}平台管理员`,
      );
      void invalidate();
    },
    onError: (e) => toast.error(adminError(e, '操作失败')),
  });

  
  const impersonateM = useMutation({
    mutationFn: (user: AdminUser) =>
      api.post(`/api/admin/users/${user.id}/impersonate`),
    onSuccess: () => {
      window.location.href = impersonatePath;
    },
    onError: (e) => {
      toast.error(adminError(e, '模拟登录失败'));
      setAction(null);
    },
  });

  const onToggleAdmin = async (user: AdminUser) => {
    const revoke = user.is_platform_admin;
    const ok = await confirm({
      title: revoke ? '撤销平台管理员' : '授予平台管理员',
      description: revoke
        ? `${user.email} 将失去平台管理权限（管理控制台入口随之消失）。`
        : `${user.email} 将获得平台管理权限，可进入管理控制台操作平台全部数据。`,
      confirmText: revoke ? '撤销管理员' : '授予管理员',
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
      header: '用户',
      render: (u) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {u.email}
            {u.is_platform_admin && (
              <Badge variant="secondary" className="ml-2">
                平台管理员
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
      header: '状态',
      className: 'w-24',
      render: (u) => <StatusBadge status={u.status} />,
    },
    {
      key: 'email_verified',
      header: '邮箱验证',
      className: 'w-24',
      render: (u) =>
        u.email_verified ? (
          <Badge variant="outline">已验证</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            未验证
          </Badge>
        ),
    },
    {
      key: 'created_at',
      header: '注册时间',
      className: 'w-28',
      render: (u) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDate(u.created_at)}
        </span>
      ),
    },
    {
      key: 'last_login_at',
      header: '最近登录',
      className: 'w-44',
      render: (u) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {u.last_login_at ? formatDateTime(u.last_login_at) : '从未登录'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      className: 'w-16',
      render: (u) => {
        
        if (me?.id === u.id) {
          return (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/admin/users/${u.id}`)}
            >
              <UserRoundSearch /> 详情
            </Button>
          );
        }
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground max-md:size-10"
              aria-label={`操作 ${u.email}`}
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
                <UserRoundSearch /> 用户详情
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {u.status === 'active' ? (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setAction({ kind: 'disable', user: u })}
                >
                  <ShieldOff /> 封禁账号
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() => setAction({ kind: 'enable', user: u })}
                >
                  <ShieldCheck /> 解封账号
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => void onToggleAdmin(u)}>
                <UserCog />{' '}
                {u.is_platform_admin ? '撤销平台管理员' : '授予平台管理员'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* 管理员互模被服务端禁止（防权限逃逸），行内禁用入口 */}
              <DropdownMenuItem
                disabled={u.is_platform_admin}
                onClick={() => setAction({ kind: 'impersonate', user: u })}
              >
                <LogIn /> 模拟登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="用户"
        description="平台全部注册用户；支持邮箱/昵称搜索与状态过滤（服务端检索）"
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          className="w-72"
          placeholder="按邮箱前缀 / 昵称搜索…"
          aria-label="搜索用户"
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
          <SelectTrigger size="sm" className="w-44" aria-label="按状态过滤">
            <SelectValue>
              {status
                ? (STATUS_OPTIONS.find((s) => s.value === status)?.label ??
                  status)
                : '全部状态'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="all">全部状态</SelectItem>
            {STATUS_OPTIONS.map((s) => (
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
            清除过滤
          </Button>
        )}
      </div>

      {usersQ.isError ? (
        <PageError
          message={adminError(usersQ.error, '用户列表加载失败')}
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
                <PageEmpty label="没有更多用户了" hint="当前页数据可能已被删除" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => applyFilter(q, status, 1)}
                >
                  返回第一页
                </Button>
              </div>
            ) : filtered ? (
              <PageEmpty
                label="没有匹配用户"
                hint="换个关键词、放宽状态条件或清除过滤"
              />
            ) : (
              <PageEmpty label="暂无用户" />
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
            ? `封禁 ${action.user.email}`
            : action?.kind === 'enable'
              ? `解封 ${action.user.email}`
              : ''
        }
        danger={action?.kind === 'disable'}
        confirmText={action?.kind === 'disable' ? '封禁' : '解封'}
        impacts={
          action?.kind === 'disable'
            ? [
                '该用户将无法通过邮箱密码与 OAuth 登录',
                '其名下工作区与数据保留，不受影响',
                '操作将记入平台审计日志',
              ]
            : ['该用户恢复登录能力', '操作将记入平台审计日志']
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
          action?.kind === 'impersonate' ? `模拟登录 ${action.user.email}` : ''
        }
        confirmText={impersonateM.isPending ? '切换中…' : '以该用户进入产品'}
        impacts={[
          '浏览器将以该用户身份进入产品（/app）',
          '当前管理员会话被替换，退出登录后需重新登录管理员账号',
          '审计将记录 admin.impersonate，操作可追溯',
        ]}
        onConfirm={() => {
          if (action?.kind === 'impersonate') impersonateM.mutate(action.user);
        }}
      />
    </div>
  );
}
