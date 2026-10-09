
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@ploykit/client';
import { useConfirm } from '../../components/ConfirmDialog';
import { DataTable, type Column } from '../../components/DataTable';
import { FormField } from '../../components/FormField';
import { PageEmpty, PageError, PageHeader } from '../../components/Page';
import { ImpactConfirmation } from '../../components/SecretModal';
import { SettingsCard } from '../../components/SettingsCard';
import { toast } from '../../components/toast';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
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


const QUOTA_KEY_HINT = '如 tasks_monthly';

export function WorkspaceDetailPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { user } = useAuth();
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
      toast.success(`${v.email} 角色已变更为 ${v.role}`);
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, '角色变更失败')),
  });

  const removeM = useMutation({
    mutationFn: (v: { uid: string; email: string }) =>
      api.delete(`/api/admin/workspaces/${id}/members/${v.uid}`),
    onSuccess: (_d, v) => {
      toast.success(`${v.email} 已移出工作区`);
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, '移除成员失败')),
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
      toast.success('配额已授予（加成额度立即生效）');
      setQuotaKey('');
      setQuotaReason('');
      setQuotaRef('');
      setQuotaAmount('');
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, '配额授予失败')),
  });

  
  const deleteM = useMutation({
    mutationFn: (slug: string) =>
      api.delete(
        `/api/admin/workspaces/${id}?confirm=${encodeURIComponent(slug)}`,
      ),
    onSuccess: () => {
      toast.success('工作区已删除');
      void qc.invalidateQueries({ queryKey: ['admin', 'workspaces'] });
      navigate('/admin/workspaces');
    },
    onError: (e) => toast.error(apiErrorMessage(e, '删除失败')),
  });

  
  
  const cancelSubM = useMutation({
    mutationFn: () =>
      api.post(`/api/admin/workspaces/${id}/cancel-subscription`),
    onSuccess: () => {
      toast.success('订阅已取消，工作区已降级为 free');
      setCancelSubOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, '取消订阅失败')),
  });

  
  
  const transferM = useMutation({
    mutationFn: (m: WsMemberRow) =>
      api.post(`/api/admin/workspaces/${id}/transfer-ownership`, {
        user_id: m.user_id,
      }),
    onSuccess: (_d, m) => {
      toast.success(`所有权已转让给 ${m.email}（原 owner 已降为 member）`);
      setTransferTarget(null);
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e, '所有权转让失败')),
  });

  const onGrant = () => {
    const amount = Number.parseInt(quotaAmount, 10);
    if (
      !quotaKey.trim() ||
      !quotaReason.trim() ||
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      toast.error('请填写配额键、原因与正整数额度');
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
      title: '移除成员',
      description: `将把 ${m.email} 移出本工作区（${m.role}）。最后一个 owner 受保护，无法移除。`,
      confirmText: '移除',
      danger: true,
    });
    if (ok) removeM.mutate({ uid: m.user_id, email: m.email });
  };

  if (detailQ.isError) {
    return (
      <div>
        <PageHeader title="工作区详情" />
        <PageError
          message={adminError(detailQ.error, '工作区详情加载失败')}
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
      header: '成员',
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
      header: '角色',
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
              aria-label={`变更 ${m.email} 角色`}
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
      header: '加入时间',
      className: 'w-28',
      render: (m) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDate(m.created_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      className: 'w-44',
      render: (m) => {
        
        
        const canTransfer =
          (m.role === 'member' || m.role === 'admin') && m.user_id !== user?.id;
        return (
          <div className="flex items-center justify-end gap-1.5">
            {canTransfer && (
              <Button
                variant="outline"
                size="sm"
                disabled={transferM.isPending}
                title="目标升为 owner，当前 owner 降为 member（单事务原子）"
                onClick={() => setTransferTarget(m)}
              >
                转让所有权
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={removeM.isPending}
              onClick={() => void onRemoveMember(m)}
            >
              移除
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={ws ? ws.name : '工作区详情'}
        description={
          ws
            ? `${ws.slug} · 工作区 ID ${shortID(ws.id)}`
            : '基础信息 + 成员表 + 配额调整'
        }
        actions={
          <Link
            to="/admin/workspaces"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={15} className="mr-1 inline" aria-hidden="true" />
            返回工作区列表
          </Link>
        }
      />

      {detailQ.isPending && (
        <p className="text-sm text-muted-foreground">加载工作区详情中…</p>
      )}

      {ws && (
        <>
          <SettingsCard
            title="基础信息"
            description="工作区档案（行内套餐变更在工作区列表页）"
          >
            <div className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <p>
                <span className="text-muted-foreground">标识（slug）：</span>
                <span className="font-mono">{ws.slug}</span>
              </p>
              <p className="flex items-center gap-2">
                <span className="text-muted-foreground">套餐：</span>
                <Badge variant="outline">{ws.plan_code}</Badge>
              </p>
              <p>
                <span className="text-muted-foreground">成员数：</span>
                <span className="tabular-nums">{ws.member_count}</span>
              </p>
              <p>
                <span className="text-muted-foreground">创建时间：</span>
                {formatDateTime(ws.created_at)}
              </p>
            </div>
          </SettingsCard>

          <SettingsCard
            title="订阅"
            description="计费区：当前套餐与订阅取消（渠道侧先取消，成功后立即降级 free；不发退款——退款属后续批次）"
            cta={
              <Button
                variant="destructive"
                disabled={ws.plan_code === 'free' || cancelSubM.isPending}
                title={
                  ws.plan_code === 'free'
                    ? '当前已是 free，无可取消订阅'
                    : undefined
                }
                onClick={() => setCancelSubOpen(true)}
              >
                {cancelSubM.isPending ? '取消中…' : '取消订阅'}
              </Button>
            }
          >
            <div className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              <p className="flex items-center gap-2">
                <span className="text-muted-foreground">当前套餐：</span>
                <Badge variant="outline">{ws.plan_code}</Badge>
              </p>
              <p className="flex items-center gap-2">
                <span className="text-muted-foreground">订阅状态：</span>
                {ws.plan_code === 'free' ? (
                  <Badge variant="outline" className="text-muted-foreground">
                    未订阅
                  </Badge>
                ) : (
                  <Badge variant="outline">订阅中</Badge>
                )}
              </p>
            </div>
          </SettingsCard>

          <SettingsCard
            title={`成员（${ws.members.length}）`}
            description="行内改角色、转让所有权或移除；last-owner 保护由服务端兜底（409）"
            bodyClassName="p-0"
          >
            <div className="px-6 pb-6">
              <DataTable
                columns={memberColumns}
                rows={ws.members}
                rowKey={(m) => m.user_id}
                loading={detailQ.isPending}
                empty={<PageEmpty label="暂无成员" />}
              />
            </div>
          </SettingsCard>

          <SettingsCard
            title="配额调整"
            description="手动授予加成额度（quota.Grant：同 键+原因+引用 幂等一次，正数加成）"
            cta={
              <Button onClick={onGrant} disabled={grantM.isPending}>
                {grantM.isPending ? '授予中…' : '授予配额'}
              </Button>
            }
          >
            <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
              <FormField label="配额键（key）" htmlFor="quota-key">
                <Input
                  id="quota-key"
                  className="font-mono"
                  placeholder={QUOTA_KEY_HINT}
                  value={quotaKey}
                  onChange={(e) => setQuotaKey(e.target.value)}
                />
              </FormField>
              <FormField label="额度（amount，正整数）" htmlFor="quota-amount">
                <Input
                  id="quota-amount"
                  type="number"
                  min={1}
                  step={1}
                  placeholder="如 100"
                  value={quotaAmount}
                  onChange={(e) => setQuotaAmount(e.target.value)}
                />
              </FormField>
              <FormField label="原因（reason，必填）" htmlFor="quota-reason">
                <Input
                  id="quota-reason"
                  placeholder="如 客户补偿 / 活动赠送"
                  value={quotaReason}
                  onChange={(e) => setQuotaReason(e.target.value)}
                />
              </FormField>
              <FormField
                label="引用（ref，可选；参与幂等键）"
                htmlFor="quota-ref"
              >
                <Input
                  id="quota-ref"
                  className="font-mono"
                  placeholder="如 ticket-1234"
                  value={quotaRef}
                  onChange={(e) => setQuotaRef(e.target.value)}
                />
              </FormField>
            </div>
          </SettingsCard>

          <SettingsCard
            danger
            title="删除工作区"
            description="不可逆级联删除（成员/资源随工作区销毁，走 BeforeDelete 钩子）"
            cta={
              <Button
                variant="destructive"
                disabled={!slugReadyToDelete || deleteM.isPending}
                onClick={() => setDeleteOpen(true)}
              >
                {deleteM.isPending ? '删除中…' : '删除工作区'}
              </Button>
            }
          >
            <div className="max-w-xl space-y-2">
              <p className="text-sm text-muted-foreground">
                输入工作区 slug {ws.slug} 以确认删除。
              </p>
              <Input
                placeholder={ws.slug}
                value={confirmSlug}
                onChange={(e) => setConfirmSlug(e.target.value)}
                aria-label="输入工作区 slug 以确认删除"
              />
            </div>
          </SettingsCard>

          {/* 删除工作区：Input slug 确认（按钮门控）+ ImpactConfirmation 双层确认 */}
          <ImpactConfirmation
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onConfirm={() => deleteM.mutate(ws.slug)}
            title={`删除工作区 ${ws.name}`}
            confirmText="永久删除"
            danger
            impacts={[
              '工作区及其全部业务数据被级联删除，不可恢复',
              '全部成员关系解除，成员不再能访问该工作区',
              'BeforeDelete 钩子可阻断删除（409），操作记入平台审计日志',
            ]}
          />

          {/* 取消订阅（B1）：ImpactConfirmation 二次确认；渠道取消失败时本地状态不动 */}
          <ImpactConfirmation
            open={cancelSubOpen}
            onOpenChange={setCancelSubOpen}
            onConfirm={() => cancelSubM.mutate()}
            title={`取消工作区 ${ws.name} 的订阅`}
            confirmText="立即取消订阅"
            danger
            impacts={[
              '工作区立即降级为 free 套餐，配额随之收缩',
              '渠道侧订阅同步取消（Stripe 停止后续扣款）；渠道取消失败时本地状态保持不变',
              '本操作不发退款（退款属后续批次），操作记入平台审计日志',
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
              title={`转让 ${ws.name} 的所有权给 ${transferTarget.email}`}
              confirmText="确认转让"
              impacts={[
                ws.members.filter((m) => m.role === 'owner').length > 1
                  ? `当前 owner（${ws.members
                      .filter((m) => m.role === 'owner')
                      .map((m) => m.email)
                      .join(
                        '、',
                      )}）中最早加入者将降为 member，不再保有工作区最高权`
                  : `当前 owner ${
                      ws.members.find((m) => m.role === 'owner')?.email ?? '—'
                    } 将降为 member，不再保有工作区最高权`,
                `${transferTarget.email} 将成为新 owner（单事务原子完成，工作区始终保有 owner）`,
                '目标须是本工作区活跃成员；BeforeOwnerChange 钩子可阻断（409），操作记入平台审计日志',
              ]}
            />
          )}
        </>
      )}
    </div>
  );
}
