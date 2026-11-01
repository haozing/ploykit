
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@ploykit/hooks';
import { PageError, PageLoading } from '../../components/Page';
import { StatusBadge } from '../../components/StatusBadge';
import { Badge } from '../../components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import type { StatusTone } from '../../lib/utils';
import { useT } from '../../i18n';
import { adminError } from './shared';

/**
 * AdminComplianceCard —— admin 侧合规对账卡，P0 lite
 * （docs/plan-legal-compliance-framework-2026-10-25.md §6 LC-9 / §8）。
 *
 * 自包含组件：自带 useQuery 拉 `GET /api/admin/legal/compliance`（信封契约
 * 见下方类型，后端集成者按此实现），照 NavVisibilityCard 先例挂在产品
 * AdminShell / AdminSettingsPage 的 children 缝——不进框架页内部。
 *
 * 渲染两块：
 * - **缺键红灯**：legal_* 键未填的逐行 key + description（F1 的 grep 人工
 *   环节变成后台红灯）；
 * - **承诺对账清单**：导出端点在不在、retention 任务跑没跑、取消端点
 *   渠道直通还是运营队列、退款政策渠道侧是否已配——ok/warn/manual 三色
 *   状态行（manual = 人工项，附 detail 说明）。
 *
 * P2（LC-9 完整版）才加接受覆盖率/DSAR 计数/取消队列计数，本卡不预留空位。
 */

/** 未填写的 legal_* 键（key + 给管理员看的说明） */
export interface AdminComplianceMissingKey {
  key: string;
  description: string;
}

/** 法务主体配置现状（legal_* 键解析值；空串 = 未填写，对应红灯） */
export interface AdminComplianceLegalConfig {
  entity_name: string;
  jurisdiction: string;
  processor_name: string;
  billing_model: string;
}

export type AdminComplianceCheckStatus = 'ok' | 'warn' | 'manual';

/** 承诺对账清单行：manual = 框架无法自动判定的人工项，附 detail */
export interface AdminComplianceCheck {
  id: string;
  label: string;
  status: AdminComplianceCheckStatus;
  detail?: string;
}

/** GET /api/admin/legal/compliance 响应信封（计划 §8 + LC-9 lite） */
export interface AdminComplianceEnvelope {
  missing_keys: AdminComplianceMissingKey[];
  legal_config: AdminComplianceLegalConfig;
  checks: AdminComplianceCheck[];
}

export const ADMIN_LEGAL_COMPLIANCE_QUERY_KEY = ['admin', 'legal-compliance'] as const;

// 三色语义：ok 绿 / warn 黄 / manual 灰（人工项）。文案是状态词（i18n key，
// 渲染时 t() 解析），check.label 才是"查什么"。
const CHECK_STATUS: Record<AdminComplianceCheckStatus, { tone: StatusTone; labelKey: string }> = {
  ok: { tone: 'positive', labelKey: 'admin.compliance.statusOk' },
  warn: { tone: 'warning', labelKey: 'admin.compliance.statusWarn' },
  manual: { tone: 'neutral', labelKey: 'admin.compliance.statusManual' },
};

function LegalFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-medium">{value || '—'}</span>
    </div>
  );
}

export function AdminComplianceCard() {
  const api = useApi();
  const t = useT();

  const complianceQ = useQuery({
    queryKey: ADMIN_LEGAL_COMPLIANCE_QUERY_KEY,
    queryFn: () => api.get<AdminComplianceEnvelope>('/api/admin/legal/compliance'),
  });

  if (complianceQ.isPending) {
    return <PageLoading label={t('admin.compliance.loading')} />;
  }
  if (complianceQ.isError) {
    return (
      <PageError
        message={adminError(complianceQ.error, t('admin.compliance.loadFailed'))}
        onRetry={() => void complianceQ.refetch()}
      />
    );
  }

  const { missing_keys: missing, legal_config: legal, checks } = complianceQ.data;

  return (
    <Card>
      <CardHeader>
        <CardDescription>{t('admin.compliance.description')}</CardDescription>
        <CardTitle>{t('admin.compliance.title')}</CardTitle>
        <CardAction>
          {missing.length > 0 ? (
            <Badge variant="destructive">
              {t('admin.compliance.missingCount', { count: missing.length })}
            </Badge>
          ) : (
            <Badge variant="secondary">{t('admin.compliance.allSet')}</Badge>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 法务主体现状（legal_* 键解析值）：红灯列表的对照上下文，空值如实显示 — */}
        <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <LegalFact label={t('admin.compliance.factEntityName')} value={legal.entity_name} />
          <LegalFact label={t('admin.compliance.factJurisdiction')} value={legal.jurisdiction} />
          <LegalFact label={t('admin.compliance.factProcessor')} value={legal.processor_name} />
          <LegalFact label={t('admin.compliance.factBillingModel')} value={legal.billing_model} />
        </div>

        {/* 缺键红灯：F1 的 grep 人工环节后台化 */}
        {missing.length > 0 && (
          <div>
            <p className="text-sm font-medium text-destructive">
              {t('admin.compliance.missingTitle')}
            </p>
            <ul className="mt-1.5 space-y-1.5">
              {missing.map((m) => (
                <li
                  key={m.key}
                  className="flex flex-wrap items-baseline gap-x-2 text-sm"
                >
                  <code className="rounded bg-destructive/10 px-1.5 py-0.5 font-mono text-xs text-destructive">
                    {m.key}
                  </code>
                  <span className="text-muted-foreground">{m.description}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 承诺对账清单：ok 绿 / warn 黄 / manual 灰 */}
        {checks.length > 0 && (
          <div>
            <p className="text-sm font-medium">{t('admin.compliance.checksTitle')}</p>
            <ul className="mt-1.5 space-y-1.5">
              {checks.map((c) => {
                const s = CHECK_STATUS[c.status] ?? CHECK_STATUS.manual;
                return (
                  <li key={c.id} className="text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1">{c.label}</span>
                      <StatusBadge tone={s.tone} label={t(s.labelKey)} />
                    </div>
                    {c.detail && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {c.detail}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
