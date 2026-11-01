
import { useState } from 'react';
import { Link, useNavigate, useParams } from '../../router';
import { ArrowLeft, Download } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@ploykit/client';
import type { components } from '@ploykit/client';
import { useConfirm } from '../../components/ConfirmDialog';
import { DataTable, type Column } from '../../components/DataTable';
import { PageEmpty, PageError, PageHeader, PageLoading } from '../../components/Page';
import { ImpactConfirmation } from '../../components/SecretModal';
import { SettingsCard } from '../../components/SettingsCard';
import { toast } from '../../components/toast';
import { Badge } from '../../components/ui/badge'
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { useApi, ApiError } from '@ploykit/hooks';
import { useAuth } from '@ploykit/hooks';
import { useT } from '../../i18n';
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


// t 由组件注入（useT()）：模块级函数不能拿 hook，文案走 g2 字典。
type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

function resendErrorMessage(err: unknown, t: TranslateFn): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return t('admin.userDetail.resendAlreadyVerified');
    if (err.status === 429) return t('admin.userDetail.resendCooldown');
  }
  return apiErrorMessage(err, t('admin.userDetail.resendFailed'));
}

export function UserDetailPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const me = useAuth().user;
  const t = useT();
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
      toast.success(t('admin.userDetail.kickSuccess'));
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, t('admin.userDetail.kickFailed'))),
  });

  const revokeSessionM = useMutation({
    mutationFn: (sid: string) =>
      api.post(`/api/admin/users/${id}/sessions/${sid}/revoke`),
    onSuccess: () => {
      toast.success(t('admin.userDetail.sessionRevoked'));
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, t('admin.userDetail.sessionRevokeFailed'))),
  });

  const resetPwdM = useMutation({
    mutationFn: () => api.post(`/api/admin/users/${id}/password-reset`),
    onSuccess: () => toast.success(t('admin.userDetail.resetSent')),
    onError: (e) => toast.error(apiErrorMessage(e, t('admin.userDetail.resetSendFailed'))),
  });

  const resendM = useMutation({
    mutationFn: () => api.post(`/api/admin/users/${id}/resend-verification`),
    onSuccess: () => toast.success(t('admin.userDetail.resendSent')),
    onError: (e) => toast.error(resendErrorMessage(e, t)),
  });

  const markVerifiedM = useMutation({
    mutationFn: () => api.post(`/api/admin/users/${id}/mark-verified`),
    onSuccess: () => {
      toast.success(t('admin.userDetail.markVerifiedDone'));
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, t('admin.userDetail.markVerifiedFailed'))),
  });

  const revokePatM = useMutation({
    mutationFn: (patID: string) =>
      api.post(`/api/admin/users/${id}/pats/${patID}/revoke`),
    onSuccess: () => {
      toast.success(t('admin.userDetail.tokenRevoked'));
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, t('admin.userDetail.tokenRevokeFailed'))),
  });


  const deleteM = useMutation({
    mutationFn: (email: string) =>
      api.delete(`/api/admin/users/${id}?confirm=${encodeURIComponent(email)}`),
    onSuccess: () => {
      toast.success(t('admin.userDetail.deleteSuccess'));
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      navigate('/admin/users');
    },
    onError: (e) => toast.error(apiErrorMessage(e, t('admin.userDetail.deleteFailed'))),
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
      toast.success(t('admin.userDetail.exportStarted'));
    } catch (e) {
      toast.error(apiErrorMessage(e, t('admin.userDetail.exportFailed')));
    } finally {
      setExporting(false);
    }
  };

  const onRevokeSession = async (s: AdminUserSession) => {
    const ok = await confirm({
      title: t('admin.userDetail.revokeSessionTitle'),
      description: t('admin.userDetail.revokeSessionDesc', {
        device: s.device || shortID(s.id),
      }),
      confirmText: t('admin.userDetail.revoke'),
      danger: true,
    });
    if (ok) revokeSessionM.mutate(s.id);
  };

  const onRevokePat = async (p: AdminPATRow) => {
    const ok = await confirm({
      title: t('admin.userDetail.revokePatTitle'),
      description: t('admin.userDetail.revokePatDesc', { name: p.name }),
      confirmText: t('admin.userDetail.revoke'),
      danger: true,
    });
    if (ok) revokePatM.mutate(p.id);
  };

  if (detailQ.isError) {
    return (
      <div>
        <PageHeader title={t('admin.userDetail.title')} />
        <PageError
          message={adminError(detailQ.error, t('admin.userDetail.loadFailed'))}
          onRetry={() => void detailQ.refetch()}
        />
      </div>
    );
  }

  const d = detailQ.data;
  const u = d?.user;
  const isSelf = !!u && me?.id === u.id;
  
  const deleteBlockedReason = isSelf
    ? t('admin.userDetail.deleteBlockedSelf')
    : u?.is_platform_admin
      ? t('admin.userDetail.deleteBlockedAdmin')
      : '';
  const emailReadyToDelete =
    !!u && confirmEmail.trim().toLowerCase() === u.email.toLowerCase();

  const sessionColumns: Column<AdminUserSession>[] = [
    {
      key: 'device',
      header: t('admin.userDetail.colDevice'),
      render: (s) => (
        <div className="min-w-0">
          <p className="truncate">
            {s.device || t('admin.userDetail.unknownDevice')}
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {s.ip_hash ? (
              <Tooltip>
                <TooltipTrigger render={<span tabIndex={0} className="cursor-help" />}>
                  {shortID(s.ip_hash)}
                </TooltipTrigger>
                <TooltipContent>{s.ip_hash}</TooltipContent>
              </Tooltip>
            ) : (
              '—'
            )}
          </p>
        </div>
      ),
    },
    {
      key: 'last_seen_at',
      header: t('admin.userDetail.colLastActive'),
      className: 'w-44',
      render: (s) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDateTime(s.last_seen_at)}
        </span>
      ),
    },
    {
      key: 'expires_at',
      header: t('admin.userDetail.colExpires'),
      className: 'w-44',
      render: (s) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDateTime(s.expires_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('admin.userDetail.colActions'),
      className: 'w-20',
      render: (s) => (
        <Button
          variant="outline"
          size="sm"
          disabled={revokeSessionM.isPending}
          onClick={() => void onRevokeSession(s)}
        >
          {t('admin.userDetail.revoke')}
        </Button>
      ),
    },
  ];

  const patColumns: Column<AdminPATRow>[] = [
    {
      key: 'name',
      header: t('admin.userDetail.colToken'),
      render: (p) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {p.name}
            {p.revoked_at && (
              <Badge variant="outline" className="ml-2 text-muted-foreground">
                {t('admin.userDetail.revokedBadge')}
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
      header: t('admin.userDetail.colCreatedAt'),
      className: 'w-28',
      render: (p) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDate(p.created_at)}
        </span>
      ),
    },
    {
      key: 'last_used_at',
      header: t('admin.userDetail.colLastUsed'),
      className: 'w-44',
      render: (p) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {p.last_used_at
            ? formatDateTime(p.last_used_at)
            : t('admin.userDetail.neverUsed')}
        </span>
      ),
    },
    {
      key: 'expires_at',
      header: t('admin.userDetail.colExpires'),
      className: 'w-28',
      render: (p) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {p.expires_at ? formatDate(p.expires_at) : t('admin.userDetail.neverExpires')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('admin.userDetail.colActions'),
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
            {t('admin.userDetail.revoke')}
          </Button>
        ),
    },
  ];

  const wsColumns: Column<AdminUserWorkspaceRow>[] = [
    {
      key: 'name',
      header: t('admin.userDetail.colWorkspace'),
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
      header: t('admin.userDetail.colRole'),
      className: 'w-24',
      render: (w) => <StatusBadge status={w.role} />,
    },
    {
      key: 'created_at',
      header: t('admin.userDetail.colJoinedAt'),
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
        title={u ? u.email : t('admin.userDetail.title')}
        description={
          u
            ? t('admin.userDetail.headerDesc', {
                name: u.display_name || t('admin.userDetail.noDisplayName'),
                id: shortID(u.id),
              })
            : t('admin.userDetail.headerDescFallback')
        }
        actions={
          <>
            <Tooltip>
              {/* disabled 按钮不派发指针事件，Tooltip 的 Trigger 需包一层 span */}
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting || !u}
                  onClick={() => void onExportData()}
                >
                  <Download />{' '}
                  {exporting ? t('admin.userDetail.exporting') : t('admin.userDetail.exportData')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t('admin.userDetail.exportTooltip')}
              </TooltipContent>
            </Tooltip>
            <Link
              to="/admin/users"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft size={15} className="mr-1 inline" aria-hidden="true" />
              {t('admin.userDetail.backToList')}
            </Link>
          </>
        }
      />

      {detailQ.isPending && <PageLoading label={t('admin.userDetail.loading')} />}

      {u && (
        <>
          <SettingsCard
            title={t('admin.userDetail.securityCardTitle')}
            cta={
              <Button
                variant="destructive"
                onClick={() => setKickOpen(true)}
                disabled={kickM.isPending}
              >
                {kickM.isPending ? t('admin.userDetail.kicking') : t('admin.userDetail.kick')}
              </Button>
            }
          >
            <div className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <p className="flex items-center gap-2">
                <span className="text-muted-foreground">{t('admin.userDetail.fieldStatus')}</span>
                <StatusBadge status={u.status} />
              </p>
              <p className="flex items-center gap-2">
                <span className="text-muted-foreground">{t('admin.userDetail.fieldEmailVerified')}</span>
                {u.email_verified ? (
                  <Badge variant="outline">{t('admin.userDetail.verifiedBadge')}</Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    {t('admin.userDetail.unverifiedBadge')}
                  </Badge>
                )}
              </p>
              <p className="flex items-center gap-2">
                <span className="text-muted-foreground">{t('admin.userDetail.fieldPlatformAdmin')}</span>
                {u.is_platform_admin ? (
                  <Badge variant="secondary">{t('admin.userDetail.yes')}</Badge>
                ) : (
                  <span>{t('admin.userDetail.no')}</span>
                )}
              </p>
              <p>
                <span className="text-muted-foreground">{t('admin.userDetail.fieldCreatedAt')}</span>
                {formatDateTime(u.created_at)}
              </p>
              <p>
                <span className="text-muted-foreground">{t('admin.userDetail.fieldLastLogin')}</span>
                {u.last_login_at
                  ? formatDateTime(u.last_login_at)
                  : t('admin.userDetail.neverSignedIn')}
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={resetPwdM.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: t('admin.userDetail.sendResetTitle'),
                    description: t('admin.userDetail.sendResetDesc', { email: u.email }),
                    confirmText: t('admin.userDetail.sendEmail'),
                  });
                  if (ok) resetPwdM.mutate();
                }}
              >
                {resetPwdM.isPending ? t('admin.userDetail.sending') : t('admin.userDetail.resetPassword')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={resendM.isPending || u.email_verified}
                onClick={async () => {
                  const ok = await confirm({
                    title: t('admin.userDetail.resendTitle'),
                    description: t('admin.userDetail.resendDesc', { email: u.email }),
                    confirmText: t('admin.userDetail.sendEmail'),
                  });
                  if (ok) resendM.mutate();
                }}
              >
                {resendM.isPending ? t('admin.userDetail.sending') : t('admin.userDetail.resend')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={markVerifiedM.isPending || u.email_verified}
                onClick={async () => {
                  const ok = await confirm({
                    title: t('admin.userDetail.markVerifiedTitle'),
                    description: t('admin.userDetail.markVerifiedDesc'),
                    confirmText: t('admin.userDetail.markVerified'),
                  });
                  if (ok) markVerifiedM.mutate();
                }}
              >
                {markVerifiedM.isPending ? t('admin.userDetail.marking') : t('admin.userDetail.markVerified')}
              </Button>
            </div>
          </SettingsCard>

          <SettingsCard
            title={t('admin.userDetail.sessionsCardTitle', {
              count: d?.sessions.length ?? 0,
            })}
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
                    label={t('admin.userDetail.noSessions')}
                    hint={t('admin.userDetail.noSessionsHint')}
                  />
                }
              />
            </div>
          </SettingsCard>

          <SettingsCard
            title={t('admin.userDetail.patsCardTitle', {
              count: d?.pats.length ?? 0,
            })}
            bodyClassName="p-0"
          >
            <div className="px-6 pb-6">
              <DataTable
                columns={patColumns}
                rows={d?.pats ?? []}
                rowKey={(p) => p.id}
                loading={detailQ.isPending}
                empty={<PageEmpty label={t('admin.userDetail.noPats')} />}
              />
            </div>
          </SettingsCard>

          <SettingsCard
            title={t('admin.userDetail.workspacesCardTitle', {
              count: d?.workspaces.length ?? 0,
            })}
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
                    label={t('admin.userDetail.noWorkspaces')}
                    hint={t('admin.userDetail.noWorkspacesHint')}
                  />
                }
              />
            </div>
          </SettingsCard>

          <SettingsCard
            danger
            title={t('admin.userDetail.deleteAccount')}
            description={t('admin.userDetail.deleteCardDesc')}
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
                {deleteM.isPending ? t('admin.userDetail.deleting') : t('admin.userDetail.deleteAccount')}
              </Button>
            }
          >
            <div className="max-w-xl space-y-2">
              {deleteBlockedReason ? (
                <p className="text-sm text-muted-foreground">
                  {t('admin.userDetail.deleteBlockedNotice', {
                    reason: deleteBlockedReason,
                  })}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('admin.userDetail.typeEmailToDelete', { email: u.email })}
                </p>
              )}
              <Input
                placeholder={u.email}
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                aria-label={t('admin.userDetail.confirmEmailAria')}
                disabled={!!deleteBlockedReason}
              />
            </div>
          </SettingsCard>

          {/* 删除账号：Input 邮箱确认（按钮门控）+ ImpactConfirmation 双层确认 */}
          <ImpactConfirmation
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onConfirm={() => deleteM.mutate(u.email)}
            title={t('admin.userDetail.deleteTitle', { email: u.email })}
            confirmText={t('admin.userDetail.deletePermanently')}
            danger
            impacts={[
              t('admin.userDetail.impactDelete1'),
              t('admin.userDetail.impactDelete2'),
              t('admin.userDetail.impactDelete3'),
            ]}
          />

          {/* 踢下线：影响确认（吊销全部在途会话，账号状态不变） */}
          <ImpactConfirmation
            open={kickOpen}
            onOpenChange={setKickOpen}
            onConfirm={() => kickM.mutate()}
            title={t('admin.userDetail.kickTitle', { email: u.email })}
            confirmText={t('admin.userDetail.kick')}
            danger
            impacts={[
              t('admin.userDetail.impactKickSessions'),
              t('admin.userDetail.impactKickNotBan'),
              t('admin.userDetail.impactKickAudit'),
            ]}
          />
        </>
      )}
    </div>
  );
}
