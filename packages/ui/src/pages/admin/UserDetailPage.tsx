
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Download } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@ploykit/client';
import type { components } from '@ploykit/client';
import { useConfirm } from '../../components/ConfirmDialog';
import { DataTable, type Column } from '../../components/DataTable';
import { PageEmpty, PageError, PageHeader } from '../../components/Page';
import { ImpactConfirmation } from '../../components/SecretModal';
import { SettingsCard } from '../../components/SettingsCard';
import { toast } from '../../components/toast';
import { Badge } from '../../components/ui/badge'
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useApi, ApiError } from '@ploykit/hooks';
import { useAuth } from '@ploykit/hooks';
import { apiErrorMessage } from '../../lib/api-error';
import { formatDate, formatDateTime, shortID } from '../../lib/utils';
import { adminError } from './shared';

type AdminUser = components['schemas']['AdminUser'];


interface AdminUserSession {
  id: string;
  device: string;
  ip_hash: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at?: string;
}


interface AdminPATRow {
  id: string;
  name: string;
  prefix: string;
  last_used_at?: string;
  expires_at?: string;
  created_at: string;
  revoked_at?: string;
}


interface AdminUserWorkspaceRow {
  id: string;
  slug: string;
  name: string;
  role: string;
  created_at: string;
}


interface AdminUserDetail {
  user: AdminUser;
  sessions: AdminUserSession[];
  pats: AdminPATRow[];
  workspaces: AdminUserWorkspaceRow[];
}


function resendErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return '该用户邮箱已验证，无需重发';
    if (err.status === 429) return '发送冷却中，请约 1 分钟后再试';
  }
  return apiErrorMessage(err, '验证邮件发送失败');
}

export function UserDetailPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const me = useAuth().user;
  const [confirmEmail, setConfirmEmail] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [kickOpen, setKickOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const detailQ = useQuery({
    queryKey: ['admin', 'user', id],
    queryFn: () => api.get<AdminUserDetail>(`/api/admin/users/${id}`),
    enabled: !!id,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'user', id] });
    void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
  };

  
  const kickM = useMutation({
    mutationFn: () => api.post(`/api/admin/users/${id}/kick`),
    onSuccess: () => {
      toast.success('已吊销该用户全部在途会话');
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, '踢下线失败')),
  });

  const revokeSessionM = useMutation({
    mutationFn: (sid: string) =>
      api.post(`/api/admin/users/${id}/sessions/${sid}/revoke`),
    onSuccess: () => {
      toast.success('会话已吊销');
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, '会话吊销失败')),
  });

  const resetPwdM = useMutation({
    mutationFn: () => api.post(`/api/admin/users/${id}/password-reset`),
    onSuccess: () => toast.success('重置邮件已发送'),
    onError: (e) => toast.error(apiErrorMessage(e, '重置邮件发送失败')),
  });

  const resendM = useMutation({
    mutationFn: () => api.post(`/api/admin/users/${id}/resend-verification`),
    onSuccess: () => toast.success('验证邮件已发送'),
    onError: (e) => toast.error(resendErrorMessage(e)),
  });

  const markVerifiedM = useMutation({
    mutationFn: () => api.post(`/api/admin/users/${id}/mark-verified`),
    onSuccess: () => {
      toast.success('已标记邮箱已验证');
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, '标记失败')),
  });

  const revokePatM = useMutation({
    mutationFn: (patID: string) =>
      api.post(`/api/admin/users/${id}/pats/${patID}/revoke`),
    onSuccess: () => {
      toast.success('令牌已吊销');
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, '令牌吊销失败')),
  });

  
  const deleteM = useMutation({
    mutationFn: (email: string) =>
      api.delete(`/api/admin/users/${id}?confirm=${encodeURIComponent(email)}`),
    onSuccess: () => {
      toast.success('账号已删除（软删）');
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      navigate('/admin/users');
    },
    onError: (e) => toast.error(apiErrorMessage(e, '删除失败')),
  });

  
  
  const onExportData = async () => {
    setExporting(true);
    try {
      const blob = await apiFetch<Blob>(`/api/admin/users/${id}/export`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `userdata-${id}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('用户数据导出已开始下载');
    } catch (e) {
      toast.error(apiErrorMessage(e, '导出失败'));
    } finally {
      setExporting(false);
    }
  };

  const onRevokeSession = async (s: AdminUserSession) => {
    const ok = await confirm({
      title: '吊销会话',
      description: `将吊销该设备会话（${s.device || shortID(s.id)}），该设备需要重新登录。`,
      confirmText: '吊销',
      danger: true,
    });
    if (ok) revokeSessionM.mutate(s.id);
  };

  const onRevokePat = async (p: AdminPATRow) => {
    const ok = await confirm({
      title: '吊销访问令牌',
      description: `将吊销「${p.name}」，使用该令牌的集成立即失效。`,
      confirmText: '吊销',
      danger: true,
    });
    if (ok) revokePatM.mutate(p.id);
  };

  if (detailQ.isError) {
    return (
      <div>
        <PageHeader title="用户详情" />
        <PageError
          message={adminError(detailQ.error, '用户详情加载失败')}
          onRetry={() => void detailQ.refetch()}
        />
      </div>
    );
  }

  const d = detailQ.data;
  const u = d?.user;
  const isSelf = !!u && me?.id === u.id;
  
  const deleteBlockedReason = isSelf
    ? '不能删除当前登录的管理员账号自己'
    : u?.is_platform_admin
      ? '不能删除另一位平台管理员（admin-on-admin 禁止）'
      : '';
  const emailReadyToDelete =
    !!u && confirmEmail.trim().toLowerCase() === u.email.toLowerCase();

  const sessionColumns: Column<AdminUserSession>[] = [
    {
      key: 'device',
      header: '设备',
      render: (s) => (
        <div className="min-w-0">
          <p className="truncate">{s.device || '未知设备'}</p>
          <p
            className="truncate font-mono text-xs text-muted-foreground"
            title={s.ip_hash}
          >
            {s.ip_hash ? shortID(s.ip_hash) : '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'last_seen_at',
      header: '最近活跃',
      className: 'w-44',
      render: (s) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDateTime(s.last_seen_at)}
        </span>
      ),
    },
    {
      key: 'expires_at',
      header: '过期时间',
      className: 'w-44',
      render: (s) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDateTime(s.expires_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      className: 'w-20',
      render: (s) => (
        <Button
          variant="outline"
          size="sm"
          disabled={revokeSessionM.isPending}
          onClick={() => void onRevokeSession(s)}
        >
          吊销
        </Button>
      ),
    },
  ];

  const patColumns: Column<AdminPATRow>[] = [
    {
      key: 'name',
      header: '令牌',
      render: (p) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {p.name}
            {p.revoked_at && (
              <Badge variant="outline" className="ml-2 text-muted-foreground">
                已吊销
              </Badge>
            )}
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {p.prefix}…
          </p>
        </div>
      ),
    },
    {
      key: 'created_at',
      header: '创建时间',
      className: 'w-28',
      render: (p) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDate(p.created_at)}
        </span>
      ),
    },
    {
      key: 'last_used_at',
      header: '最近使用',
      className: 'w-44',
      render: (p) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {p.last_used_at ? formatDateTime(p.last_used_at) : '从未使用'}
        </span>
      ),
    },
    {
      key: 'expires_at',
      header: '过期时间',
      className: 'w-28',
      render: (p) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {p.expires_at ? formatDate(p.expires_at) : '永不过期'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      className: 'w-20',
      render: (p) =>
        p.revoked_at ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={revokePatM.isPending}
            onClick={() => void onRevokePat(p)}
          >
            吊销
          </Button>
        ),
    },
  ];

  const wsColumns: Column<AdminUserWorkspaceRow>[] = [
    {
      key: 'name',
      header: '工作区',
      render: (w) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{w.name}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {w.slug}
          </p>
        </div>
      ),
    },
    {
      key: 'role',
      header: '角色',
      className: 'w-24',
      render: (w) => <StatusBadge status={w.role} />,
    },
    {
      key: 'created_at',
      header: '加入时间',
      className: 'w-28',
      render: (w) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDate(w.created_at)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={u ? u.email : '用户详情'}
        description={
          u
            ? `${u.display_name || '未设置昵称'} · 用户 ID ${shortID(u.id)}`
            : '用户资料与会话 / 令牌 / 工作区聚合视图'
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={exporting || !u}
              onClick={() => void onExportData()}
              title="GDPR 用户数据导出（资料 / 成员关系 / 在途会话元数据 / PAT 元数据 / 最近审计事件）"
            >
              <Download /> {exporting ? '导出中…' : '导出数据'}
            </Button>
            <Link
              to="/admin/users"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft size={15} className="mr-1 inline" aria-hidden="true" />
              返回用户列表
            </Link>
          </>
        }
      />

      {detailQ.isPending && (
        <p className="text-sm text-muted-foreground">加载用户详情中…</p>
      )}

      {u && (
        <>
          <SettingsCard
            title="账号资料与安全操作"
            description="状态、验证与登录会话的全局操作（全部记入平台审计）"
            cta={
              <Button
                variant="destructive"
                onClick={() => setKickOpen(true)}
                disabled={kickM.isPending}
              >
                {kickM.isPending ? '踢下线中…' : '踢下线'}
              </Button>
            }
          >
            <div className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <p className="flex items-center gap-2">
                <span className="text-muted-foreground">状态：</span>
                <StatusBadge status={u.status} />
              </p>
              <p className="flex items-center gap-2">
                <span className="text-muted-foreground">邮箱验证：</span>
                {u.email_verified ? (
                  <Badge variant="outline">已验证</Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    未验证
                  </Badge>
                )}
              </p>
              <p className="flex items-center gap-2">
                <span className="text-muted-foreground">平台管理员：</span>
                {u.is_platform_admin ? (
                  <Badge variant="secondary">是</Badge>
                ) : (
                  <span>否</span>
                )}
              </p>
              <p>
                <span className="text-muted-foreground">注册时间：</span>
                {formatDateTime(u.created_at)}
              </p>
              <p>
                <span className="text-muted-foreground">最近登录：</span>
                {u.last_login_at ? formatDateTime(u.last_login_at) : '从未登录'}
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={resetPwdM.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: '发送密码重置邮件',
                    description: `将向 ${u.email} 发送密码重置邮件（走用户自助重置链路，不直接改密码）。`,
                    confirmText: '发送邮件',
                  });
                  if (ok) resetPwdM.mutate();
                }}
              >
                {resetPwdM.isPending ? '发送中…' : '重置密码'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={resendM.isPending || u.email_verified}
                onClick={async () => {
                  const ok = await confirm({
                    title: '重发验证邮件',
                    description: `将向 ${u.email} 补发邮箱验证邮件（1 分钟冷却）。`,
                    confirmText: '发送邮件',
                  });
                  if (ok) resendM.mutate();
                }}
              >
                {resendM.isPending ? '发送中…' : '重发验证'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={markVerifiedM.isPending || u.email_verified}
                onClick={async () => {
                  const ok = await confirm({
                    title: '标记邮箱已验证',
                    description:
                      '邮件链路不可达时的兜底：直接把该邮箱标记为已验证（幂等）。',
                    confirmText: '标记已验证',
                  });
                  if (ok) markVerifiedM.mutate();
                }}
              >
                {markVerifiedM.isPending ? '标记中…' : '标记已验证'}
              </Button>
            </div>
          </SettingsCard>

          <SettingsCard
            title={`在途会话（${d?.sessions.length ?? 0}）`}
            description="该用户当前有效的登录会话；可单设备吊销"
            bodyClassName="p-0"
          >
            <div className="px-6 pb-6">
              <DataTable
                columns={sessionColumns}
                rows={d?.sessions ?? []}
                rowKey={(s) => s.id}
                loading={detailQ.isPending}
                empty={
                  <PageEmpty
                    label="没有在途会话"
                    hint="该用户当前没有任何活跃登录（或已被踢下线）"
                  />
                }
              />
            </div>
          </SettingsCard>

          <SettingsCard
            title={`访问令牌 PAT（${d?.pats.length ?? 0}）`}
            description="目标用户个人访问令牌的只读元数据（不含凭据材料）"
            bodyClassName="p-0"
          >
            <div className="px-6 pb-6">
              <DataTable
                columns={patColumns}
                rows={d?.pats ?? []}
                rowKey={(p) => p.id}
                loading={detailQ.isPending}
                empty={<PageEmpty label="暂无访问令牌" />}
              />
            </div>
          </SettingsCard>

          <SettingsCard
            title={`所属工作区（${d?.workspaces.length ?? 0}）`}
            description="该用户作为成员加入的工作区与角色"
            bodyClassName="p-0"
          >
            <div className="px-6 pb-6">
              <DataTable
                columns={wsColumns}
                rows={d?.workspaces ?? []}
                rowKey={(w) => w.id}
                loading={detailQ.isPending}
                empty={
                  <PageEmpty
                    label="不属于任何工作区"
                    hint="工作区列表器未接线时也显示为空"
                  />
                }
              />
            </div>
          </SettingsCard>

          <SettingsCard
            danger
            title="删除账号"
            description="软删：status=deleted、邮箱改写、PAT 全吊销，不可恢复"
            cta={
              <Button
                variant="destructive"
                disabled={
                  !!deleteBlockedReason ||
                  !emailReadyToDelete ||
                  deleteM.isPending
                }
                onClick={() => setDeleteOpen(true)}
              >
                {deleteM.isPending ? '删除中…' : '删除账号'}
              </Button>
            }
          >
            <div className="max-w-xl space-y-2">
              {deleteBlockedReason ? (
                <p className="text-sm text-muted-foreground">
                  {deleteBlockedReason}，无法在此删除。
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  输入目标邮箱 {u.email} 以确认删除。
                </p>
              )}
              <Input
                placeholder={u.email}
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                aria-label="输入目标邮箱以确认删除"
                disabled={!!deleteBlockedReason}
              />
            </div>
          </SettingsCard>

          {/* 删除账号：Input 邮箱确认（按钮门控）+ ImpactConfirmation 双层确认 */}
          <ImpactConfirmation
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onConfirm={() => deleteM.mutate(u.email)}
            title={`删除账号 ${u.email}`}
            confirmText="永久删除"
            danger
            impacts={[
              '账号进入 deleted 状态，邮箱被改写释放，无法恢复',
              '该用户全部在途会话与个人访问令牌（PAT）立即吊销',
              '名下工作区与业务数据保留，操作记入平台审计日志',
            ]}
          />

          {/* 踢下线：影响确认（吊销全部在途会话，账号状态不变） */}
          <ImpactConfirmation
            open={kickOpen}
            onOpenChange={setKickOpen}
            onConfirm={() => kickM.mutate()}
            title={`踢下线 ${u.email}`}
            confirmText="踢下线"
            danger
            impacts={[
              '该用户全部在途会话立即吊销，所有设备需重新登录',
              '账号状态不变（不是封禁），重新登录即可恢复',
              '操作将记入平台审计日志（admin.user_kick）',
            ]}
          />
        </>
      )}
    </div>
  );
}
