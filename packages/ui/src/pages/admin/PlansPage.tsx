
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { FormField } from '../../components/FormField';
import {
  PageEmpty,
  PageError,
  PageHeader,
  PageLoading,
} from '../../components/Page';
import { toast } from '../../components/toast';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Spinner } from '../../components/ui/spinner';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import { useApi } from '@ploykit/hooks';
import { useT } from '../../i18n';
import { adminError } from './shared';
import { BillingChannelsSection } from './BillingChannelsSection';
import { BILLING_CATALOG_QUERY_KEY, CatalogMapping } from './CatalogMapping';

// UP-5：套餐目录编辑。GET /api/admin/plans → {items, plans: PlanView[]}；
// PATCH /api/admin/plans/{code} 全量语义（body 整卡提交，code 不可改走路径）。
// PATCH 落库即生效（所有读取方直读库无缓存），已创建订单金额不受影响。

export interface AdminPlanView {
  code: string;
  name: string;
  currency: string;
  trial_days: number;
  sort_no: number;
  limits: Record<string, number>;
}

interface AdminPlansEnvelope {
  items: string[];
  plans: AdminPlanView[];
}

interface PlanUpdateBody {
  name: string;
  currency: string;
  sort_no: number;
  limits: Record<string, number>;
}

// 服务端校验兜底（limits 键 ^[a-z][a-z0-9_]{0,63}$、值整数、-1=无限哨兵）；
// 这里做同规则的轻量前置，避免明显的坏请求打过去。
const LIMIT_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const INT_RE = /^-?\d+$/;

const COMMON_CURRENCIES = ['USD', 'EUR', 'CNY', 'GBP'];

// 已知价格键：渲染为数值输入并给单位提示；其余键给"高级键"弱提示但放行
// （limits 是自由 KV，billing 不认识的键无害）。
const KNOWN_PRICE_KEYS = new Set([
  'price_monthly_cents',
  'price_yearly_cents',
  'price_one_time_cents',
]);

const UNLIMITED = -1;

interface LimitRow {
  key: string;
  value: string;
}

interface PlanDraft {
  name: string;
  currency: string;
  sortNo: string;
  limits: LimitRow[];
}

function draftFrom(plan: AdminPlanView): PlanDraft {
  return {
    name: plan.name,
    currency: plan.currency,
    sortNo: String(plan.sort_no),
    limits: Object.entries(plan.limits ?? {}).map(([key, value]) => ({
      key,
      value: String(value),
    })),
  };
}

// 纯校验函数：错误文案走字典（t 由调用方传入，保持模块级函数可测）
function buildBody(
  d: PlanDraft,
  t: (key: string, vars?: Record<string, string | number>) => string,
): { body?: PlanUpdateBody; error?: string } {
  const name = d.name.trim();
  if (!name) return { error: t('admin.plans.errNameRequired') };
  if (!CURRENCY_RE.test(d.currency.trim()))
    return { error: t('admin.plans.errCurrency') };
  const sortNo = d.sortNo.trim();
  if (!INT_RE.test(sortNo)) return { error: t('admin.plans.errSortInt') };
  const limits: Record<string, number> = {};
  for (const row of d.limits) {
    const k = row.key.trim();
    const v = row.value.trim();
    // 整行留空的行忽略（误触加行不阻塞保存）
    if (!k && !v) continue;
    if (!k) return { error: t('admin.plans.errLimitKeyMissing') };
    if (!LIMIT_KEY_RE.test(k))
      return {
        error: t('admin.plans.errLimitKeyFormat', { key: k }),
      };
    if (k in limits)
      return { error: t('admin.plans.errLimitKeyDup', { key: k }) };
    if (!INT_RE.test(v))
      return {
        error: t('admin.plans.errLimitValueInt', { key: k, unlimited: UNLIMITED }),
      };
    limits[k] = Number(v);
  }
  return { body: { name, currency: d.currency.trim(), sort_no: Number(sortNo), limits } };
}

interface PlanCardProps {
  plan: AdminPlanView;
  open: boolean;
  saving: boolean;
  apiError?: string;
  onToggle: () => void;
  onSave: (code: string, body: PlanUpdateBody) => void;
}

function PlanCard({ plan, open, saving, apiError, onToggle, onSave }: PlanCardProps) {
  const t = useT();
  const [draft, setDraft] = useState<PlanDraft>(() => draftFrom(plan));
  const [customCurrency, setCustomCurrency] = useState(
    !COMMON_CURRENCIES.includes(plan.currency),
  );
  const [formError, setFormError] = useState<string | null>(null);

  // 保存成功后列表失效重取，新 plan 到达即重置草稿（列表即时反映）
  useEffect(() => {
    setDraft(draftFrom(plan));
    setCustomCurrency(!COMMON_CURRENCIES.includes(plan.currency));
    setFormError(null);
  }, [plan]);

  const limitCount = draft.limits.length;

  const addRow = () =>
    setDraft((d) => ({ ...d, limits: [...d.limits, { key: '', value: '' }] }));

  const removeRow = (i: number) =>
    setDraft((d) => ({
      ...d,
      limits: d.limits.filter((_, idx) => idx !== i),
    }));

  const setRow = (i: number, patch: Partial<LimitRow>) =>
    setDraft((d) => ({
      ...d,
      limits: d.limits.map((row, idx) => (idx === i ? { ...row, ...patch } : row)),
    }));

  const submit = () => {
    setFormError(null);
    const { body, error } = buildBody(draft, t);
    if (!body) {
      setFormError(error ?? t('admin.shared.formInvalid'));
      return;
    }
    onSave(plan.code, body);
  };

  const shownError = formError ?? apiError;

  return (
    <li className="rounded-lg border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={t('admin.plans.editAria', { code: plan.code })}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        {open ? (
          <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />
        )}
        <span className="font-medium">{plan.name}</span>
        {/* 原生 title → Tooltip：触发器 render 成 span（code 处于 toggle button
            内部，Base UI Trigger 默认渲染 button，嵌套按钮非法——UsagePage 挂法） */}
        <Tooltip>
          <TooltipTrigger render={<span tabIndex={0} className="cursor-help" />}>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {plan.code}
            </code>
          </TooltipTrigger>
          <TooltipContent>{t('admin.plans.codeTooltip')}</TooltipContent>
        </Tooltip>
        <Badge variant="outline">{plan.currency}</Badge>
        <span className="text-xs text-muted-foreground">
          {t('admin.plans.sortMeta', { no: plan.sort_no })}
        </span>
        {plan.trial_days > 0 && (
          <span className="text-xs text-muted-foreground">
            {t('admin.plans.trialMeta', { days: plan.trial_days })}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {t('admin.plans.limitCountMeta', { count: limitCount })}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {open ? t('admin.plans.collapse') : t('admin.plans.expand')}
        </span>
      </button>

      {open && (
        <form
          className="border-t px-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField
              label={t('admin.plans.nameLabel')}
              htmlFor={`plans-name-${plan.code}`}
            >
              <Input
                id={`plans-name-${plan.code}`}
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
              />
            </FormField>
            <FormField
              label={t('admin.plans.currencyLabel')}
              description={t('admin.plans.currencyDesc')}
            >
              <Select
                value={customCurrency ? 'custom' : draft.currency}
                onValueChange={(v) => {
                  if (v === 'custom') {
                    setCustomCurrency(true);
                  } else {
                    setCustomCurrency(false);
                    setDraft((d) => ({ ...d, currency: v }));
                  }
                }}
              >
                <SelectTrigger
                  aria-label={t('admin.plans.currencyLabel')}
                  size="sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  {COMMON_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">
                    {t('admin.plans.currencyCustom')}
                  </SelectItem>
                </SelectContent>
              </Select>
              {customCurrency && (
                <Input
                  className="mt-2 font-mono"
                  aria-label={t('admin.plans.currencyCustomAria')}
                  placeholder={t('admin.plans.currencyPlaceholder')}
                  value={draft.currency}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      currency: e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z]/g, '')
                        .slice(0, 3),
                    }))
                  }
                />
              )}
            </FormField>
            <FormField
              label={t('admin.plans.sortLabel')}
              htmlFor={`plans-sort-${plan.code}`}
              description={t('admin.plans.sortDesc')}
            >
              {/* B-settings-10 同款处置：text + inputMode（type=number 对垃圾
                  字符静默置空）；非法值保存前拒绝并就地提示 */}
              <Input
                id={`plans-sort-${plan.code}`}
                type="text"
                inputMode="numeric"
                value={draft.sortNo}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, sortNo: e.target.value }))
                }
              />
            </FormField>
          </div>

          <div className="mt-6">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{t('admin.plans.limitsTitle')}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRow}
              >
                <Plus size={14} aria-hidden="true" />{' '}
                {t('admin.plans.addLimitKey')}
              </Button>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              {t('admin.plans.limitsHint', { unlimited: UNLIMITED })}
            </p>
            <div className="space-y-2">
              {draft.limits.map((row, i) => {
                const key = row.key.trim();
                const knownPrice = KNOWN_PRICE_KEYS.has(key);
                const unknownKey = key !== '' && !knownPrice;
                const unlimited = row.value.trim() === String(UNLIMITED);
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input
                      aria-label={t('admin.plans.limitKeyAria')}
                      className="w-48 font-mono"
                      placeholder={t('admin.plans.limitKeyPlaceholder')}
                      value={row.key}
                      onChange={(e) => setRow(i, { key: e.target.value })}
                    />
                    <Input
                      aria-label={t('admin.plans.limitValueAria')}
                      type="text"
                      inputMode="numeric"
                      className="w-36"
                      placeholder={t('admin.plans.limitValuePlaceholder', {
                        unlimited: UNLIMITED,
                      })}
                      value={row.value}
                      onChange={(e) => setRow(i, { value: e.target.value })}
                    />
                    {knownPrice && (
                      <span className="text-xs text-muted-foreground">
                        {t('admin.plans.priceHint')}
                      </span>
                    )}
                    {unknownKey && (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span tabIndex={0} className="inline-flex cursor-help" />
                          }
                        >
                          <Badge variant="outline" className="text-muted-foreground">
                            {t('admin.plans.advancedKey')}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t('admin.plans.advancedKeyTip')}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {unlimited && (
                      <span className="text-xs font-medium text-muted-foreground">
                        {t('admin.plans.unlimitedBadge')}
                      </span>
                    )}
                    <span className="flex-1" />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('admin.plans.deleteLimitAria', {
                        name: key || i + 1,
                      })}
                      onClick={() => removeRow(i)}
                    >
                      {t('admin.plans.deleteRow')}
                    </Button>
                  </div>
                );
              })}
              {draft.limits.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t('admin.plans.noLimits')}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {/* 保存中文案恒定（ProfileSettingsPage 先例：aria-hidden Spinner 不进可及名，
                按钮可访问名保持字典值，测试与读屏稳定） */}
            <Button type="submit" size="sm" disabled={saving}>
              {saving && <Spinner aria-hidden="true" />}
              {t('admin.shared.save')}
            </Button>
            {shownError && (
              <Alert variant="destructive">
                <AlertDescription>{shownError}</AlertDescription>
              </Alert>
            )}
          </div>
        </form>
      )}
    </li>
  );
}

export function PlansPage() {
  const api = useApi();
  const qc = useQueryClient();
  const t = useT();

  const [openCodes, setOpenCodes] = useState<Set<string>>(() => new Set());
  const toggle = (code: string) =>
    setOpenCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const plansQ = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: () => api.get<AdminPlansEnvelope>('/api/admin/plans'),
  });

  // 每卡独立的保存错误（404/400 后端消息就地展示，不弹 toast 抢焦点）
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});

  const saveM = useMutation({
    mutationFn: (v: { code: string; body: PlanUpdateBody }) =>
      api.patch<AdminPlanView>(
        `/api/admin/plans/${encodeURIComponent(v.code)}`,
        v.body,
      ),
    onSuccess: (_d, v) => {
      toast.success(t('admin.plans.saved', { code: v.code }));
      setCardErrors((prev) => {
        if (!(v.code in prev)) return prev;
        const next = { ...prev };
        delete next[v.code];
        return next;
      });
      // 列表即时反映（WorkspacesPage 的套餐下拉同键，一并失效）
      void qc.invalidateQueries({ queryKey: ['admin', 'plans'] });
      // 同页"渠道商品映射"的已同步/目标价比对全部 join catalog 的套餐价——
      // 改价后一并失效，否则映射表仍按旧价比对（复用 CatalogMapping 导出的键）
      void qc.invalidateQueries({ queryKey: BILLING_CATALOG_QUERY_KEY });
    },
    onError: (e, v) =>
      setCardErrors((prev) => ({
        ...prev,
        [v.code]: adminError(
          e,
          t('admin.plans.saveFailed', { code: v.code }),
        ),
      })),
  });

  const plans = [...(plansQ.data?.plans ?? [])].sort(
    (a, b) => a.sort_no - b.sort_no || a.code.localeCompare(b.code),
  );

  return (
    <div>
      <PageHeader
        title={t('admin.plans.title')}
        description={t('admin.plans.description')}
      />

      {plansQ.isError ? (
        <PageError
          message={adminError(plansQ.error, t('admin.plans.loadFailed'))}
          onRetry={() => void plansQ.refetch()}
        />
      ) : plansQ.isPending ? (
        <PageLoading label={t('admin.plans.loading')} />
      ) : plans.length === 0 ? (
        <PageEmpty
          label={t('admin.plans.emptyLabel')}
          hint={t('admin.plans.emptyHint')}
        />
      ) : (
        <ul className="space-y-3">
          {plans.map((plan) => (
            <PlanCard
              key={plan.code}
              plan={plan}
              open={openCodes.has(plan.code)}
              saving={saveM.isPending && saveM.variables?.code === plan.code}
              apiError={cardErrors[plan.code]}
              onToggle={() => toggle(plan.code)}
              onSave={(code, body) => saveM.mutate({ code, body })}
            />
          ))}
        </ul>
      )}

      {/* BC-6：渠道自助配置挂在套餐页内（不新增侧边栏导航项） */}
      <BillingChannelsSection />
      <CatalogMapping />
    </div>
  );
}
