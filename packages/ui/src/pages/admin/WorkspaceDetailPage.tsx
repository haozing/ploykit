
import { useState } from 'react';
import { Link, useNavigate, useParams } from '../../router';
import { ArrowLeft } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@ploykit/client';
import { useConfirm } from '../../components/ConfirmDialog';
import { DataTable, type Column } from '../../components/DataTable';
import { FormField } from '../../components/FormField';
import { PageEmpty, PageError, PageHeader, PageLoading } from '../../components/Page';
import { ImpactConfirmation } from '../../components/SecretModal';
import { SettingsCard } from '../../components/SettingsCard';
import { toast } from '../../components/toast';
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import { useApi } from '@ploykit/hooks';
import { useAuth } from '@ploykit/hooks';
import { useT } from '../../i18n';
import { apiErrorMessage } from '../../lib/api-error';
import { formatDate, formatDateTime, shortID } from '../../lib/utils';
import { adminError } from './shared';

type AdminWorkspace = components['schemas']['AdminWorkspace'];


interface WsMemberRow {
  user_id: string;
  email: string;
  display_name: string;
  role: string;
  created_at: string;
}


interface WsDetail extends AdminWorkspace {
  members: WsMemberRow[];
}

const ROLE_OPTIONS = ['owner', 'admin', 'member'];

export function WorkspaceDetailPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { user } = useAuth();
  const t = useT(); // i18n（g3 分片）：用户可见文案走字典，zh=原文
  const [confirmSlug, setConfirmSlug] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  
  const [cancelSubOpen, setCancelSubOpen] = useState(false);
  
  const [transferTarget, setTransferTarget] = useState<WsMemberRow | null>(
    null,
  );
  
  const [quotaKey, setQuotaKey] = useState('');
  const [quotaReason, setQuotaReason] = useState('');
  const [quotaRef, setQuotaRef] = useState('');
  const [quotaAmount, setQuotaAmount] = useState('');

  const detailQ = useQuery({
    queryKey: ['admin', 'workspace', id],
    queryFn: () => api.get<WsDetail>(`/api/admin/workspaces/${id}`),
    enabled: !!id,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'workspace', id] });
    void qc.invalidateQueries({ queryKey: ['admin', 'workspaces'] });
  };

  const roleM = useMutation({
    mutationFn: (v: { uid: string; email: string; role: string }) =>
      api.patch(`/api/admin/workspaces/${id}/members/${v.uid}`, {
        role: v.role,
      }),
    onSuccess: (_d, v) => {
      toast.success(t('admin.workspaceDetail.toast.roleChanged', { email: v.email, role: v.role }));
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, t('admin.workspaceDetail.toast.roleChangeFailed'))),
  });

  const removeM = useMutation({
    mutationFn: (v: { uid: string; email: string }) =>
      api.delete(`/api/admin/workspaces/${id}/members/${v.uid}`),
    onSuccess: (_d, v) => {
      toast.success(t('admin.workspaceDetail.toast.memberRemoved', { email: v.email }));
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, t('admin.workspaceDetail.toast.memberRemoveFailed'))),
  });

  
  const grantM = useMutation({
    mutationFn: (v: {
      key: string;
      reason: string;
      ref: string;
      amount: number;
    }) =>
      api.post(`/api/admin/workspaces/${id}/quota/grant`, {
        key: v.key,
        reason: v.reason,
        ref: v.ref,
        amount: v.amount,
      }),
    onSuccess: () => {
      toast.success(t('admin.workspaceDetail.toast.quotaGranted'));
      setQuotaKey('');
      setQuotaReason('');
      setQuotaRef('');
      setQuotaAmount('');
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, t('admin.workspaceDetail.toast.quotaGrantFailed'))),
  });

  
  const deleteM = useMutation({
    mutationFn: (slug: string) =>
      api.delete(
        `/api/admin/workspaces/${id}?confirm=${encodeURIComponent(slug)}`,
      ),
    onSuccess: () => {
      toast.success(t('admin.workspaceDetail.toast.deleted'));
      void qc.invalidateQueries({ queryKey: ['admin', 'workspaces'] });
      navigate('/admin/workspaces');
    },
    onError: (e) => toast.error(apiErrorMessage(e, t('admin.workspaceDetail.toast.deleteFailed'))),
  });

  
  
  const cancelSubM = useMutation({
    mutationFn: () =>
      api.post(`/api/admin/workspaces/${id}/cancel-subscription`),
    onSuccess: () => {
      toast.success(t('admin.workspaceDetail.toast.subCanceled'));
      setCancelSubOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, t('admin.workspaceDetail.toast.subCancelFailed'))),
  });

  
  
  const transferM = useMutation({
    mutationFn: (m: WsMemberRow) =>
      api.post(`/api/admin/workspaces/${id}/transfer-ownership`, {
        user_id: m.user_id,
      }),
    onSuccess: (_d, m) => {
      toast.success(t('admin.workspaceDetail.toast.ownershipTransferred', { email: m.email }));
      setTransferTarget(null);
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, t('admin.workspaceDetail.toast.ownershipTransferFailed'))),
  });

  const onGrant = () => {
    const amount = Number.parseInt(quotaAmount, 10);
    if (
      !quotaKey.trim() ||
      !quotaReason.trim() ||
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      toast.error(t('admin.workspaceDetail.toast.quotaInvalid'));
      return;
    }
    grantM.mutate({
      key: quotaKey.trim(),
      reason: quotaReason.trim(),
      ref: quotaRef.trim(),
      amount,
    });
  };

  const onRemoveMember = async (m: WsMemberRow) => {
    const ok = await confirm({
      title: t('admin.workspaceDetail.removeMember.title'),
      description: t('admin.workspaceDetail.removeMember.desc', { email: m.email, role: m.role }),
      confirmText: t('admin.workspaceDetail.removeMember.confirm'),
      danger: true,
    });
    if (ok) removeM.mutate({ uid: m.user_id, email: m.email });
  };

  if (detailQ.isError) {
    return (
      <div>
        <PageHeader title={t('admin.workspaceDetail.title')} />
        <PageError
          message={adminError(detailQ.error, t('admin.workspaceDetail.loadFailed'))}
          onRetry={() => void detailQ.refetch()}
        />
      </div>
    );
  }

  const ws = detailQ.data;
  const slugReadyToDelete = !!ws && confirmSlug.trim() === ws.slug;

  const memberColumns: Column<WsMemberRow>[] = [
    {
      key: 'email',
      header: t('admin.workspaceDetail.memberCol.member'),
      render: (m) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{m.email}</p>
          <p className="truncate text-xs text-muted-foreground">
            {m.display_name || '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'role',
      header: t('admin.workspaceDetail.memberCol.role'),
      className: 'w-40',
      render: (m) => {
        const mutating = roleM.isPending && roleM.variables?.uid === m.user_id;
        return (
          <Select
            value={ROLE_OPTIONS.includes(m.role) ? m.role : 'member'}
            onValueChange={(v) => {
              if (typeof v === 'string' && v !== m.role)
                roleM.mutate({ uid: m.user_id, email: m.email, role: v });
            }}
          >
            <SelectTrigger
              size="sm"
              disabled={mutating}
              aria-label={t('admin.workspaceDetail.memberCol.changeRoleAria', { email: m.email })}
            >
              <SelectValue>{m.role}</SelectValue>
            </SelectTrigger>
            <SelectContent align="start">
              {ROLE_OPTIONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
    },
    {
      key: 'created_at',
      header: t('admin.workspaceDetail.memberCol.joinedAt'),
      className: 'w-28',
      render: (m) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDate(m.created_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('admin.workspaceDetail.memberCol.actions'),
      className: 'w-44',
      render: (m) => {
        
        
        const canTransfer =
          (m.role === 'member' || m.role === 'admin') && m.user_id !== user?.id;
        return (
          <div className="flex items-center justify-end gap-1.5">
            {canTransfer && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={transferM.isPending}
                      onClick={() => setTransferTarget(m)}
                    />
                  }
                >
                  {t('admin.workspaceDetail.actions.transferOwnership')}
                </TooltipTrigger>
                <TooltipContent>
                  {t('admin.workspaceDetail.actions.transferHint')}
                </TooltipContent>
              </Tooltip>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={removeM.isPending}
              onClick={() => void onRemoveMember(m)}
            >
              {t('admin.workspaceDetail.actions.remove')}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={ws ? ws.name : t('admin.workspaceDetail.title')}
        description={
          ws
            ? t('admin.workspaceDetail.descSlug', { slug: ws.slug, id: shortID(ws.id) })
            : t('admin.workspaceDetail.descFallback')
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            render={<Link to="/admin/workspaces" />}
          >
            <ArrowLeft aria-hidden="true" />
            {t('admin.workspaceDetail.backToList')}
          </Button>
        }
      />

      {detailQ.isPending && <PageLoading label={t('admin.workspaceDetail.loading')} />}

      {ws && (
        <>
          <SettingsCard
            title={t('admin.workspaceDetail.basicInfo.title')}
            description={t('admin.workspaceDetail.basicInfo.desc')}
          >
            <div className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <p>
                <span className="text-muted-foreground">{t('admin.workspaceDetail.basicInfo.slugLabel')}</span>
                <span className="font-mono">{ws.slug}</span>
              </p>
              <p className="flex items-center gap-2">
                <span className="text-muted-foreground">{t('admin.workspaceDetail.basicInfo.planLabel')}</span>
                <Badge variant="outline">{ws.plan_code}</Badge>
              </p>
              <p>
                <span className="text-muted-foreground">{t('admin.workspaceDetail.basicInfo.memberCountLabel')}</span>
                <span className="tabular-nums">{ws.member_count}</span>
              </p>
              <p>
                <span className="text-muted-foreground">{t('admin.workspaceDetail.basicInfo.createdAtLabel')}</span>
                {formatDateTime(ws.created_at)}
              </p>
            </div>
          </SettingsCard>

          <SettingsCard
            title={t('admin.workspaceDetail.sub.title')}
            description={t('admin.workspaceDetail.sub.desc')}
            cta={
              ws.plan_code === 'free' ? (
                <Tooltip>
                  {/* disabled 按钮不响应指针事件（pointer-events-none），
                      Trigger 包 span 承接 hover/聚焦展示 Tooltip */}
                  <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
                    <Button variant="destructive" disabled>
                      {cancelSubM.isPending ? t('admin.workspaceDetail.sub.canceling') : t('admin.workspaceDetail.sub.cancel')}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('admin.workspaceDetail.sub.freeHint')}</TooltipContent>
                </Tooltip>
              ) : (
                <Button
                  variant="destructive"
                  disabled={cancelSubM.isPending}
                  onClick={() => setCancelSubOpen(true)}
                >
                  {cancelSubM.isPending ? t('admin.workspaceDetail.sub.canceling') : t('admin.workspaceDetail.sub.cancel')}
                </Button>
              )
            }
          >
            <div className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              <p className="flex items-center gap-2">
                <span className="text-muted-foreground">{t('admin.workspaceDetail.sub.currentPlanLabel')}</span>
                <Badge variant="outline">{ws.plan_code}</Badge>
              </p>
              <p className="flex items-center gap-2">
                <span className="text-muted-foreground">{t('admin.workspaceDetail.sub.statusLabel')}</span>
                {ws.plan_code === 'free' ? (
                  <Badge variant="outline" className="text-muted-foreground">
                    {t('admin.workspaceDetail.sub.notSubscribed')}
                  </Badge>
                ) : (
                  <Badge variant="outline">{t('admin.workspaceDetail.sub.subscribed')}</Badge>
                )}
              </p>
            </div>
          </SettingsCard>

          <SettingsCard
            title={t('admin.workspaceDetail.membersCard.title', { count: ws.members.length })}
            bodyClassName="p-0"
          >
            <div className="px-6 pb-6">
              <DataTable
                columns={memberColumns}
                rows={ws.members}
                rowKey={(m) => m.user_id}
                loading={detailQ.isPending}
                empty={<PageEmpty label={t('admin.workspaceDetail.membersCard.empty')} />}
              />
            </div>
          </SettingsCard>

          <SettingsCard
            title={t('admin.workspaceDetail.quota.title')}
            cta={
              <Button onClick={onGrant} disabled={grantM.isPending}>
                {grantM.isPending ? t('admin.workspaceDetail.quota.granting') : t('admin.workspaceDetail.quota.grant')}
              </Button>
            }
          >
            <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
              <FormField label={t('admin.workspaceDetail.quota.keyLabel')} htmlFor="quota-key">
                <Input
                  id="quota-key"
                  className="font-mono"
                  placeholder={t('admin.workspaceDetail.quota.keyPlaceholder')}
                  value={quotaKey}
                  onChange={(e) => setQuotaKey(e.target.value)}
                />
              </FormField>
              <FormField label={t('admin.workspaceDetail.quota.amountLabel')} htmlFor="quota-amount">
                <Input
                  id="quota-amount"
                  type="number"
                  min={1}
                  step={1}
                  placeholder={t('admin.workspaceDetail.quota.amountPlaceholder')}
                  value={quotaAmount}
                  onChange={(e) => setQuotaAmount(e.target.value)}
                />
              </FormField>
              <FormField label={t('admin.workspaceDetail.quota.reasonLabel')} htmlFor="quota-reason">
                <Input
                  id="quota-reason"
                  placeholder={t('admin.workspaceDetail.quota.reasonPlaceholder')}
                  value={quotaReason}
                  onChange={(e) => setQuotaReason(e.target.value)}
                />
              </FormField>
              <FormField
                label={t('admin.workspaceDetail.quota.refLabel')}
                htmlFor="quota-ref"
              >
                <Input
                  id="quota-ref"
                  className="font-mono"
                  placeholder={t('admin.workspaceDetail.quota.refPlaceholder')}
                  value={quotaRef}
                  onChange={(e) => setQuotaRef(e.target.value)}
                />
              </FormField>
            </div>
          </SettingsCard>

          <SettingsCard
            danger
            title={t('admin.workspaceDetail.delete.title')}
            description={t('admin.workspaceDetail.delete.desc')}
            cta={
              <Button
                variant="destructive"
                disabled={!slugReadyToDelete || deleteM.isPending}
                onClick={() => setDeleteOpen(true)}
              >
                {deleteM.isPending ? t('admin.workspaceDetail.delete.deleting') : t('admin.workspaceDetail.delete.title')}
              </Button>
            }
          >
            <div className="max-w-xl space-y-2">
              <p className="text-sm text-muted-foreground">
                {t('admin.workspaceDetail.delete.confirmInputHint', { slug: ws.slug })}
              </p>
              <Input
                placeholder={ws.slug}
                value={confirmSlug}
                onChange={(e) => setConfirmSlug(e.target.value)}
                aria-label={t('admin.workspaceDetail.delete.inputAria')}
              />
            </div>
          </SettingsCard>

          {/* 删除工作区：Input slug 确认（按钮门控）+ ImpactConfirmation 双层确认 */}
          <ImpactConfirmation
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onConfirm={() => deleteM.mutate(ws.slug)}
            title={t('admin.workspaceDetail.delete.dialogTitle', { name: ws.name })}
            confirmText={t('admin.workspaceDetail.delete.confirmText')}
            danger
            impacts={[
              t('admin.workspaceDetail.delete.impact1'),
              t('admin.workspaceDetail.delete.impact2')
            ]}
          />

          {/* 取消订阅（B1）：ImpactConfirmation 二次确认；渠道取消失败时本地状态不动 */}
          <ImpactConfirmation
            open={cancelSubOpen}
            onOpenChange={setCancelSubOpen}
            onConfirm={() => cancelSubM.mutate()}
            title={t('admin.workspaceDetail.cancelSub.dialogTitle', { name: ws.name })}
            confirmText={t('admin.workspaceDetail.cancelSub.confirmText')}
            danger
            impacts={[
              t('admin.workspaceDetail.cancelSub.impact1'),
              t('admin.workspaceDetail.cancelSub.impact2'),
              t('admin.workspaceDetail.cancelSub.impact3'),
            ]}
          />

          {/* 转让所有权（C 批次）：ImpactConfirmation 列明降级影响——原 owner 降为
              member；转让单事务原子，工作区始终保有 owner（不可造出零 owner 区） */}
          {transferTarget && (
            <ImpactConfirmation
              open
              onOpenChange={(o) => {
                if (!o) setTransferTarget(null);
              }}
              onConfirm={() => transferM.mutate(transferTarget)}
              title={t('admin.workspaceDetail.transfer.dialogTitle', {
                name: ws.name,
                email: transferTarget.email,
              })}
              confirmText={t('admin.workspaceDetail.transfer.confirmText')}
              impacts={[
                ws.members.filter((m) => m.role === 'owner').length > 1
                  ? t('admin.workspaceDetail.transfer.impactMultiOwner', {
                      owners: ws.members
                        .filter((m) => m.role === 'owner')
                        .map((m) => m.email)
                        .join(
                          t('admin.workspaceDetail.transfer.ownerSeparator'),
                        ),
                    })
                  : t('admin.workspaceDetail.transfer.impactSingleOwner', {
                      email:
                        ws.members.find((m) => m.role === 'owner')?.email ?? '—',
                    }),
                t('admin.workspaceDetail.transfer.impactNewOwner', {
                  email: transferTarget.email,
                })
              ]}
            />
          )}
        </>
      )}
    </div>
  );
}
