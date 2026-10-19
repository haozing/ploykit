
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
import { adminError } from './shared';

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

function buildBody(
  d: PlanDraft,
): { body?: PlanUpdateBody; error?: string } {
  const name = d.name.trim();
  if (!name) return { error: '名称不能为空' };
  if (!CURRENCY_RE.test(d.currency.trim()))
    return { error: '币种需为 3 位大写字母（如 USD）' };
  const sortNo = d.sortNo.trim();
  if (!INT_RE.test(sortNo)) return { error: '排序需为整数' };
  const limits: Record<string, number> = {};
  for (const row of d.limits) {
    const k = row.key.trim();
    const v = row.value.trim();
    // 整行留空的行忽略（误触加行不阻塞保存）
    if (!k && !v) continue;
    if (!k) return { error: '存在未填写键名的限制行' };
    if (!LIMIT_KEY_RE.test(k))
      return {
        error: `限制键 ${k} 格式有误：小写字母开头，仅小写字母/数字/下划线`,
      };
    if (k in limits) return { error: `限制键 ${k} 重复` };
    if (!INT_RE.test(v))
      return { error: `限制 ${k} 的值需为整数（${UNLIMITED} 表示无限）` };
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
    const { body, error } = buildBody(draft);
    if (!body) {
      setFormError(error ?? '表单有误');
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
        aria-label={`编辑套餐 ${plan.code}`}
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
          <TooltipContent>套餐代码不可修改</TooltipContent>
        </Tooltip>
        <Badge variant="outline">{plan.currency}</Badge>
        <span className="text-xs text-muted-foreground">排序 {plan.sort_no}</span>
        {plan.trial_days > 0 && (
          <span className="text-xs text-muted-foreground">
            试用 {plan.trial_days} 天
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {limitCount} 项限制
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {open ? '收起' : '展开编辑'}
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
            <FormField label="名称" htmlFor={`plans-name-${plan.code}`}>
              <Input
                id={`plans-name-${plan.code}`}
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
              />
            </FormField>
            <FormField
              label="币种"
              description="3 位大写字母；常用币种可选，也可自由输入"
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
                <SelectTrigger aria-label="币种" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  {COMMON_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">自定义…</SelectItem>
                </SelectContent>
              </Select>
              {customCurrency && (
                <Input
                  className="mt-2 font-mono"
                  aria-label="自定义币种"
                  placeholder="如 JPY"
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
              label="排序"
              htmlFor={`plans-sort-${plan.code}`}
              description="展示顺序（任意整数）"
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
              <p className="text-sm font-medium">限制（limits）</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRow}
              >
                <Plus size={14} aria-hidden="true" /> 添加限制键
              </Button>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              值为整数，{UNLIMITED} 表示无限（Unlimited）；键名小写字母开头，仅小写字母/数字/下划线。未知键原样保存（高级键，服务端放行）。
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
                      aria-label="限制键名"
                      className="w-48 font-mono"
                      placeholder="键名，如 credits"
                      value={row.key}
                      onChange={(e) => setRow(i, { key: e.target.value })}
                    />
                    <Input
                      aria-label="限制值"
                      type="text"
                      inputMode="numeric"
                      className="w-36"
                      placeholder={`整数；${UNLIMITED} = 无限`}
                      value={row.value}
                      onChange={(e) => setRow(i, { value: e.target.value })}
                    />
                    {knownPrice && (
                      <span className="text-xs text-muted-foreground">
                        价格（单位：分）
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
                            高级键
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          billing 不认识的高级键：原样保存，服务端放行
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {unlimited && (
                      <span className="text-xs font-medium text-muted-foreground">
                        Unlimited（无限）
                      </span>
                    )}
                    <span className="flex-1" />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`删除限制 ${key || i + 1}`}
                      onClick={() => removeRow(i)}
                    >
                      删除
                    </Button>
                  </div>
                );
              })}
              {draft.limits.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  暂无限制键（limits 为空对象）
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {/* 保存中文案恒定（ProfileSettingsPage 先例：aria-hidden Spinner 不进可及名，
                按钮可访问名保持「保存」，测试与读屏稳定） */}
            <Button type="submit" size="sm" disabled={saving}>
              {saving && <Spinner aria-hidden="true" />}保存
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
      toast.success(`套餐 ${v.code} 已保存`);
      setCardErrors((prev) => {
        if (!(v.code in prev)) return prev;
        const next = { ...prev };
        delete next[v.code];
        return next;
      });
      // 列表即时反映（WorkspacesPage 的套餐下拉同键，一并失效）
      void qc.invalidateQueries({ queryKey: ['admin', 'plans'] });
    },
    onError: (e, v) =>
      setCardErrors((prev) => ({
        ...prev,
        [v.code]: adminError(e, `套餐 ${v.code} 保存失败`),
      })),
  });

  const plans = [...(plansQ.data?.plans ?? [])].sort(
    (a, b) => a.sort_no - b.sort_no || a.code.localeCompare(b.code),
  );

  return (
    <div>
      <PageHeader
        title="套餐"
        description="编辑套餐与配额。已创建订单不受影响。"
      />

      {plansQ.isError ? (
        <PageError
          message={adminError(plansQ.error, '套餐列表加载失败')}
          onRetry={() => void plansQ.refetch()}
        />
      ) : plansQ.isPending ? (
        <PageLoading label="加载套餐中…" />
      ) : plans.length === 0 ? (
        <PageEmpty
          label="暂无套餐"
          hint="套餐由计费种子数据创建；此页编辑已存在的套餐"
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
    </div>
  );
}
