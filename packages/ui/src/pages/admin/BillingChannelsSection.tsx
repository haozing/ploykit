
import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormField } from '../../components/FormField';
import {
  PageEmpty,
  PageError,
  PageLoading,
} from '../../components/Page';
import { StatusBadge } from '../../components/StatusBadge';
import { toast } from '../../components/toast';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
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

// BC-6 后台支付渠道自助配置（docs/plan-billing-channel-framework-2026-10-23.md）：
// GET /api/admin/billing/channels 每渠道一卡，ConfigSchema FieldSpec 驱动表单
// （框架 UI 不认识具体渠道字段也能画表单，第四渠道零 UI 改动）；
// PUT /api/admin/billing/channels/{name} 保存，POST test-connection 探活，
// webhook URL 一键复制贴渠道后台。挂在 PlansPage（不新增侧边栏导航项）。

/** secret 字段"已设置"哨兵（BC-5）：已配置的 secret 回 "__SET__"，真实值永不回传 */
export const SECRET_SET = '__SET__';

export interface ChannelFieldOption {
  value: string;
  label: string;
}

export interface ChannelFieldSpec {
  key: string;
  label: string;
  type: 'text' | 'secret' | 'select';
  required: boolean;
  help: string;
  options: ChannelFieldOption[] | null;
}

export interface ChannelCapabilities {
  catalog_based: boolean;
  supports_cancel_url: boolean;
  display_order: number;
  currencies: string[];
}

export interface ChannelCard {
  name: string;
  configured: boolean;
  key_masked: string;
  webhook_configured: boolean;
  capabilities: ChannelCapabilities;
  schema: ChannelFieldSpec[];
  /** text=实际值；secret=已设则 "__SET__" 否则 "" */
  values: Record<string, string>;
  config_source: 'db' | 'env' | '';
  /**
   * 该渠道当前由进程环境变量提供的配置字段键列表（后端可选下发；后端未合入时
   * undefined 走旧行为）。required 空值豁免与 mode 徽标均以它为准。
   */
  env_provided?: string[];
}

export interface BillingChannelsEnvelope {
  channels: ChannelCard[];
}

export const BILLING_CHANNELS_QUERY_KEY = ['admin', 'billing-channels'] as const;

export function webhookUrl(origin: string, name: string): string {
  return `${origin}/webhooks/billing/${name}`;
}

// AdminSettingsPage copyCallbackUrl 同款降级策略：无 clipboard API 时
// toast 展示完整地址（不做降级选中复制）
function copyWebhookUrl(name: string, url: string) {
  if (typeof navigator.clipboard?.writeText === 'function') {
    void navigator.clipboard
      .writeText(url)
      .then(() => toast.success(`${name} Webhook URL 已复制`))
      .catch(() => toast.error(`复制失败，完整地址：${url}`));
  } else {
    toast.info(`当前环境不支持自动复制，完整地址：${url}`);
  }
}

// 水合规则（与 AdminSettingsPage smtp_pass 同款）：text/select 用 values 实际值，
// secret 一律空串回填（"__SET__" 哨兵只驱动"已设置"标记，不进 state）
function hydrateDraft(channel: ChannelCard): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const spec of channel.schema) {
    draft[spec.key] = spec.type === 'secret' ? '' : channel.values[spec.key] ?? '';
  }
  return draft;
}

interface ChannelCardFormProps {
  channel: ChannelCard;
}

function ChannelCardForm({ channel }: ChannelCardFormProps) {
  const api = useApi();
  const qc = useQueryClient();

  const [draft, setDraft] = useState<Record<string, string>>(() =>
    hydrateDraft(channel),
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  // 保存成功后失效重取，新 channel 到达即重置草稿（ PlansPage PlanCard 同款）
  useEffect(() => {
    setDraft(hydrateDraft(channel));
    setFormError(null);
  }, [channel]);

  const setField = (key: string, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // 提交体契约：fields 含 schema 全部键；secret 留空 = 保持不变（空串原样提交）
  const buildFields = (): {
    fields?: Record<string, string>;
    error?: string;
  } => {
    const fields: Record<string, string> = {};
    const missing: string[] = [];
    for (const spec of channel.schema) {
      const v = (draft[spec.key] ?? '').trim();
      // required 校验：text/select 必填；两类空值豁免——
      // a) secret 已设置（__SET__）时留空合法（保持不变语义）；
      // b) 该字段当前由环境变量提供（env_provided 含键）：留空=保存后回退 env 值
      //    （stripe 经 STRIPE_SECRET_KEY 配置时，管理员只补贴 webhook 密钥不被挡死）
      if (
        spec.required &&
        v === '' &&
        !(spec.type === 'secret' && channel.values[spec.key] === SECRET_SET) &&
        !(channel.env_provided ?? []).includes(spec.key)
      ) {
        missing.push(spec.label);
      }
      fields[spec.key] = v;
    }
    if (missing.length > 0) {
      return { error: `必填项未填写：${missing.join('、')}` };
    }
    return { fields };
  };

  const saveM = useMutation({
    mutationFn: (fields: Record<string, string>) =>
      // 响应体是 {channel: card} 信封（admin routes_billingops 同款写法），结果
      // 未被使用——类型如实标注，勿写成裸 ChannelCard 误导后续消费方
      api.put<{ channel: ChannelCard }>(
        `/api/admin/billing/channels/${encodeURIComponent(channel.name)}`,
        { fields },
      ),
    onSuccess: () => {
      toast.success(`渠道 ${channel.name} 已保存`);
      void qc.invalidateQueries({ queryKey: BILLING_CHANNELS_QUERY_KEY });
    },
    onError: (e) =>
      setFormError(adminError(e, `渠道 ${channel.name} 保存失败`)),
  });

  // 既有端点（OrdersPage 支付渠道卡同款）：成功无 body、失败 4xx/5xx 带 err
  const testConnM = useMutation({
    mutationFn: () =>
      api.post('/api/admin/billing/test-connection', {
        channel: channel.name,
      }),
    onSuccess: () => setTestMsg('连接正常'),
    onError: (e) =>
      setTestMsg(`测试失败：${adminError(e, '未知错误')}`),
  });

  const submit = () => {
    setFormError(null);
    setTestMsg(null);
    const { fields, error } = buildFields();
    if (!fields) {
      setFormError(error ?? '表单有误');
      return;
    }
    saveM.mutate(fields);
  };

  const url = webhookUrl(
    typeof window === 'undefined' ? '' : window.location.origin,
    channel.name,
  );
  const isTestMode = channel.values.mode === 'test';
  // mode 由环境变量提供（DB 无值）：不猜 test/prod，只标注来源；
  // values.mode 有值时维持现状（isTestMode 直读 DB 值）
  const modeFromEnv =
    !channel.values.mode && (channel.env_provided ?? []).includes('mode');

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{channel.name}</CardTitle>
        <CardAction>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {channel.configured ? (
              <Badge>已配置</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                未配置
              </Badge>
            )}
            {channel.config_source === 'db' && (
              <Badge variant="secondary">后台配置</Badge>
            )}
            {channel.config_source === 'env' && (
              <Badge variant="outline">环境变量</Badge>
            )}
            {modeFromEnv && (
              <Badge variant="outline" className="text-muted-foreground">
                模式：环境变量提供
              </Badge>
            )}
            {channel.webhook_configured ? (
              <StatusBadge label="回调验签已配" tone="positive" />
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      tabIndex={0}
                      className="inline-flex cursor-help"
                    />
                  }
                >
                  <StatusBadge label="回调验签未配" tone="warning" />
                </TooltipTrigger>
                <TooltipContent>
                  未配置回调验签时，支付成功但权益不会发放
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {isTestMode && (
          <Alert role="status" variant="warning">
            <AlertDescription>
              当前为测试模式，不会产生真实扣款。
              {channel.name === 'waffo' && (
                <>
                  {' '}
                  测试卡号：成功 4576 7500 0000 0110 / 拒付 4576 7500 0000 0220。
                </>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div>
          <p className="text-sm font-medium">Webhook 回调地址</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded bg-muted px-2 py-1 font-mono text-xs break-all text-muted-foreground">
              {url}
            </code>
            <Tooltip>
              {/* MembersPage 转让按钮同款 TooltipTrigger render 配方 */}
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`复制 ${channel.name} Webhook URL`}
                    onClick={() => copyWebhookUrl(channel.name, url)}
                  />
                }
              >
                <Copy size={12} aria-hidden="true" />
                复制
              </TooltipTrigger>
              <TooltipContent>复制 {channel.name} Webhook URL</TooltipContent>
            </Tooltip>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            将此 URL 粘贴到渠道后台的 Webhook 设置。
          </p>
        </div>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {channel.schema.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {channel.schema.map((spec) => {
                const fieldId = `ch-${channel.name}-${spec.key}`;
                const value = draft[spec.key] ?? '';
                // secret 已设置 → label 旁标"已设置"（掩码/哨兵不进输入框）
                const label =
                  spec.type === 'secret' &&
                  channel.values[spec.key] === SECRET_SET
                    ? `${spec.label}（已设置）`
                    : spec.label;
                const description =
                  spec.type === 'secret'
                    ? spec.help
                      ? `${spec.help}；留空保持不变`
                      : '留空保持不变'
                    : spec.help || undefined;
                return (
                  <FormField
                    key={spec.key}
                    label={label}
                    description={description}
                    required={spec.required}
                    htmlFor={fieldId}
                  >
                    {spec.type === 'select' ? (
                      <Select
                        value={value}
                        onValueChange={(v) => setField(spec.key, v)}
                      >
                        <SelectTrigger
                          id={fieldId}
                          size="sm"
                          className="w-full"
                          aria-label={spec.label}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start">
                          {(spec.options ?? []).map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={fieldId}
                        type={spec.type === 'secret' ? 'password' : 'text'}
                        autoComplete={
                          spec.type === 'secret' ? 'new-password' : 'off'
                        }
                        placeholder={
                          spec.type === 'secret' ? '******' : undefined
                        }
                        value={value}
                        onChange={(e) => setField(spec.key, e.target.value)}
                      />
                    )}
                  </FormField>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm" disabled={saveM.isPending}>
              {saveM.isPending && <Spinner aria-hidden="true" />}保存
            </Button>
            <Tooltip>
              {/* disabled 按钮不派发指针事件，Tooltip 的 Trigger 需包一层 span */}
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!channel.configured || testConnM.isPending}
                  onClick={() => {
                    setTestMsg(null);
                    testConnM.mutate();
                  }}
                >
                  {testConnM.isPending ? '测试中…' : '测试连接'}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {!channel.configured
                  ? '渠道未配置密钥，无法测试'
                  : '向渠道发起一次只读连通性请求'}
              </TooltipContent>
            </Tooltip>
            {/* 测试连接读的是已保存配置：表单里新贴的密钥未保存时测的是旧值 */}
            <span className="text-xs text-muted-foreground">
              测试连接使用已保存的配置；修改后请先保存再测试。
            </span>
          </div>

          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          {testMsg && (
            <Alert role="status" className="bg-muted">
              <AlertDescription>{testMsg}</AlertDescription>
            </Alert>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

export function BillingChannelsSection() {
  const api = useApi();

  const channelsQ = useQuery({
    queryKey: BILLING_CHANNELS_QUERY_KEY,
    queryFn: () =>
      api.get<BillingChannelsEnvelope>('/api/admin/billing/channels'),
  });

  const channels = [...(channelsQ.data?.channels ?? [])].sort(
    (a, b) =>
      a.capabilities.display_order - b.capabilities.display_order ||
      a.name.localeCompare(b.name),
  );

  return (
    <section className="mt-10">
      <h2 className="text-base font-semibold">支付渠道</h2>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        贴入渠道密钥并保存即可启用，无需修改环境变量或重启；密钥加密存储，保存后不再回显。
      </p>
      {channelsQ.isError ? (
        <PageError
          message={adminError(channelsQ.error, '渠道配置加载失败')}
          onRetry={() => void channelsQ.refetch()}
        />
      ) : channelsQ.isPending ? (
        <PageLoading label="加载支付渠道中…" />
      ) : channels.length === 0 ? (
        <PageEmpty
          label="暂无已注册渠道"
          hint="渠道由框架注册后在此显示"
        />
      ) : (
        <div className="space-y-3">
          {channels.map((ch) => (
            <ChannelCardForm key={ch.name} channel={ch} />
          ))}
        </div>
      )}
    </section>
  );
}
