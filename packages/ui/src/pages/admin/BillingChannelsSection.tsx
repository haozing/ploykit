
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
import { t, useT } from '../../i18n';
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
// toast 展示完整地址（不做降级选中复制）。非 React 事件处理器 → 模块级 t()。
function copyWebhookUrl(name: string, url: string) {
  if (typeof navigator.clipboard?.writeText === 'function') {
    void navigator.clipboard
      .writeText(url)
      .then(() => toast.success(t('admin.billingChannels.copied', { name })))
      .catch(() =>
        toast.error(t('admin.billingChannels.copyFailedFull', { url })),
      );
  } else {
    toast.info(t('admin.billingChannels.copyUnsupported', { url }));
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
  const t = useT();

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
      return {
        error: t('admin.billingChannels.missingRequired', {
          fields: missing.join(t('admin.shared.listSep')),
        }),
      };
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
      toast.success(t('admin.billingChannels.saved', { name: channel.name }));
      void qc.invalidateQueries({ queryKey: BILLING_CHANNELS_QUERY_KEY });
    },
    onError: (e) =>
      setFormError(
        adminError(e, t('admin.billingChannels.saveFailed', { name: channel.name })),
      ),
  });

  // 既有端点（OrdersPage 支付渠道卡同款）：成功无 body、失败 4xx/5xx 带 err
  const testConnM = useMutation({
    mutationFn: () =>
      api.post('/api/admin/billing/test-connection', {
        channel: channel.name,
      }),
    onSuccess: () => setTestMsg(t('admin.billingChannels.testOk')),
    onError: (e) =>
      setTestMsg(
        t('admin.billingChannels.testFailed', {
          msg: adminError(e, t('admin.billingChannels.unknownError')),
        }),
      ),
  });

  const submit = () => {
    setFormError(null);
    setTestMsg(null);
    const { fields, error } = buildFields();
    if (!fields) {
      setFormError(error ?? t('admin.shared.formInvalid'));
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
              <Badge>{t('admin.billingChannels.badgeConfigured')}</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                {t('admin.billingChannels.badgeNotConfigured')}
              </Badge>
            )}
            {channel.config_source === 'db' && (
              <Badge variant="secondary">
                {t('admin.billingChannels.sourceDb')}
              </Badge>
            )}
            {channel.config_source === 'env' && (
              <Badge variant="outline">
                {t('admin.billingChannels.sourceEnv')}
              </Badge>
            )}
            {modeFromEnv && (
              <Badge variant="outline" className="text-muted-foreground">
                {t('admin.billingChannels.modeFromEnv')}
              </Badge>
            )}
            {channel.webhook_configured ? (
              <StatusBadge
                label={t('admin.billingChannels.webhookSigned')}
                tone="positive"
              />
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
                  <StatusBadge
                    label={t('admin.billingChannels.webhookNotSigned')}
                    tone="warning"
                  />
                </TooltipTrigger>
                <TooltipContent>
                  {t('admin.billingChannels.webhookNotSignedTip')}
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
              {t('admin.billingChannels.testModeNotice')}
              {channel.name === 'waffo' && (
                <>
                  {' '}
                  {t('admin.billingChannels.testCards')}
                </>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div>
          <p className="text-sm font-medium">
            {t('admin.billingChannels.webhookUrlTitle')}
          </p>
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
                    aria-label={t('admin.billingChannels.copyWebhookAria', {
                      name: channel.name,
                    })}
                    onClick={() => copyWebhookUrl(channel.name, url)}
                  />
                }
              >
                <Copy size={12} aria-hidden="true" />
                {t('admin.billingChannels.copy')}
              </TooltipTrigger>
              <TooltipContent>
                {t('admin.billingChannels.copyWebhookAria', {
                  name: channel.name,
                })}
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('admin.billingChannels.pasteHint')}
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
                    ? t('admin.billingChannels.secretSetSuffix', {
                        label: spec.label,
                      })
                    : spec.label;
                const description =
                  spec.type === 'secret'
                    ? spec.help
                      ? t('admin.billingChannels.helpKeepEmpty', {
                          help: spec.help,
                        })
                      : t('admin.billingChannels.keepEmpty')
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
              {saveM.isPending && <Spinner aria-hidden="true" />}
              {t('admin.shared.save')}
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
                  {testConnM.isPending
                    ? t('admin.billingChannels.testing')
                    : t('admin.billingChannels.testConn')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {!channel.configured
                  ? t('admin.billingChannels.testDisabledTip')
                  : t('admin.billingChannels.testReadonlyTip')}
              </TooltipContent>
            </Tooltip>
            {/* 测试连接读的是已保存配置：表单里新贴的密钥未保存时测的是旧值 */}
            <span className="text-xs text-muted-foreground">
              {t('admin.billingChannels.testSavedHint')}
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
  const t = useT();

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
      <h2 className="text-base font-semibold">
        {t('admin.billingChannels.title')}
      </h2>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        {t('admin.billingChannels.description')}
      </p>
      {channelsQ.isError ? (
        <PageError
          message={adminError(channelsQ.error, t('admin.billingChannels.loadFailed'))}
          onRetry={() => void channelsQ.refetch()}
        />
      ) : channelsQ.isPending ? (
        <PageLoading label={t('admin.billingChannels.loading')} />
      ) : channels.length === 0 ? (
        <PageEmpty
          label={t('admin.billingChannels.emptyLabel')}
          hint={t('admin.billingChannels.emptyHint')}
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
