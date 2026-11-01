
import { useEffect, useState, type ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormField } from '../../components/FormField';
import { PageError, PageHeader, PageLoading } from '../../components/Page';
import { toast } from '../../components/toast';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '../../components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Switch } from '../../components/ui/switch';
import { Textarea } from '../../components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import { useApi } from '@ploykit/hooks';
import { SiteBanner } from '../../components/SiteBanner';
import { SITE_CONFIG_QUERY_KEY } from '@ploykit/hooks';
import { adminError } from './shared';
// i18n（B 方案）：组件内 useT()；模块级函数（parseRateLimit/copyCallbackUrl 等
// 非 React 调用点）用同名模块级 t()，随 Provider 的 setUiLang 对齐
import { t, useT } from '../../i18n';


interface OAuthProviderInfo {
  name: string;
  callback_url: string;
}

interface AdminSettingsEnvelope {
  
  items: Record<string, string>;
  
  effective: Record<string, string>;
  defaults: Record<string, string>;
  descriptions: Record<string, string>;
  /** 出站邮件通道（UP-1）：smtp | dev | "" */
  mail_mode: string;
  /** OAuth provider 状态（UP-6）；字段缺失 = 后端未接线，整卡隐藏 */
  oauth?: OAuthProviderInfo[];
}


interface TestEmailResult {
  mode?: string;
  hint?: string;
  status?: string;
}


interface KeySaveResult {
  key: string;
  label: string;
  ok: boolean;
  err?: unknown;
}


const ERROR_TOAST_MS = 8_000;

// 框架内建键全集（= 后端 settings.KeyOrder）。本页对 effective 里不属于
// 内建集的键（产品经 settings.RegisterKeys 注册）渲染通用配置卡；内建键
// 各有专属卡或专属页面，绝不进通用卡。后端增删内建键时同步此清单
//（AdminSettingsPage.test.tsx 的 BUILTIN 清单快照守住漂移）。
export const BUILTIN_SETTING_KEYS = [
  'banner_text',
  'banner_kind',
  'maintenance_mode',
  'allow_signup',
  'allowed_domains',
  'rate_limit_per_user_per_min',
  'rate_limit_per_ip_per_min',
  'rate_limit_allowlist',
  'smtp_host',
  'smtp_port',
  'smtp_user',
  'smtp_pass',
  'smtp_from',
  'site_verification_meta',
  'shell_nav_hidden',
];

// 掩码回显值（settings.MaskedValue）：敏感键读回永远长这样，输入框据此
// 判定"已配置 + 永不回填"。
const MASKED = '******';


function parseRateLimit(
  raw: string,
): { ok: true; v: string } | { ok: false; msg: string } {
  const s = raw.trim();
  if (s === '') {
    return { ok: false, msg: t('admin.settings.rlErrEmpty') };
  }
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 100000) {
    return { ok: false, msg: t('admin.settings.rlErrRange') };
  }
  return { ok: true, v: s };
}


// SMTP 端口：留空合法（后端缺省 587），非空必须是 1..65535 的整数
function parseSmtpPort(
  raw: string,
): { ok: true; v: string } | { ok: false; msg: string } {
  const s = raw.trim();
  if (s === '') {
    return { ok: true, v: '' };
  }
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 65535) {
    return { ok: false, msg: t('admin.settings.smtpPortErrRange') };
  }
  return { ok: true, v: s };
}


async function putKeys(
  api: { put: (url: string, body: unknown) => Promise<unknown> },
  entries: { key: string; label: string; value: string }[],
): Promise<KeySaveResult[]> {
  const results: KeySaveResult[] = [];
  for (const e of entries) {
    try {
      await api.put(`/api/admin/settings/${e.key}`, { value: e.value });
      results.push({ key: e.key, label: e.label, ok: true });
    } catch (err) {
      results.push({ key: e.key, label: e.label, ok: false, err });
    }
  }
  return results;
}


// UP-6 登录方式卡：复制回调地址（与 OverviewPage 复制工作区 ID 同款降级策略）
function copyCallbackUrl(name: string, url: string) {
  if (typeof navigator.clipboard?.writeText === 'function') {
    void navigator.clipboard
      .writeText(url)
      .then(() => toast.success(t('admin.settings.oauthCallbackCopied', { name })))
      .catch(() => toast.error(t('admin.settings.oauthCopyFailed', { url })));
  } else {
    toast.info(t('admin.settings.oauthCopyUnsupported', { url }));
  }
}

// shuijing field report (2026-10-25): the page had zero extension points —
// product cards had to be sibling nodes with their own data sources. Two
// seams now: `children` renders after every framework card (fully custom
// cards), and registered keys (settings.RegisterKeys on the backend) render
// as a generic card from the same list envelope — no product endpoints, no
// product page code.
export function AdminSettingsPage({ children }: { children?: ReactNode }) {
  const t = useT();
  const api = useApi();
  const qc = useQueryClient();

  const settingsQ = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.get<AdminSettingsEnvelope>('/api/admin/settings'),
  });

  
  const [bannerText, setBannerText] = useState('');
  const [bannerKind, setBannerKind] = useState<'info' | 'warn'>('info');
  const [maintenance, setMaintenance] = useState(false);
  const [allowSignup, setAllowSignup] = useState(true);
  const [domains, setDomains] = useState('');
  
  const [rlPerUser, setRlPerUser] = useState('0');
  const [rlPerIP, setRlPerIP] = useState('30');
  const [rlAllowlist, setRlAllowlist] = useState('');
  const [rlError, setRlError] = useState<string | null>(null);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('');
  const [smtpUser, setSmtpUser] = useState('');
  // UP-1 水合规则：smtp_pass 永不回填（真实值与掩码回显都不进 state），
  // state 保持空串、placeholder 显示掩码；留空保存 = 不修改密码
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [smtpError, setSmtpError] = useState<string | null>(null);
  const [verifyMeta, setVerifyMeta] = useState('');
  const [hydrated, setHydrated] = useState(false);

  const eff = settingsQ.data?.effective;

  // 产品注册键（settings.RegisterKeys）：effective 里出现在内建集之外、
  // 且不带 billing_channel. 前缀的键。掩码键（敏感）state 恒空、永不回填，
  // 与 smtp_pass 同款水合规则。
  const extraKeys = Object.keys(settingsQ.data?.effective ?? {})
    .filter(
      (k) =>
        !BUILTIN_SETTING_KEYS.includes(k) &&
        !k.startsWith('billing_channel.'),
    )
    .sort();
  const [extraVals, setExtraVals] = useState<Record<string, string>>({});
  const [extraHydrated, setExtraHydrated] = useState(false);
  // dirty 集合（v2.7.2 修复，oauth 后台化设计 §2.3.1）：只提交用户真正
  // 编辑过的键。旧实现一次 PUT 全部非敏感注册键——水合值来自 effective
  // （可能是 env 兜底值），一次无关保存就会把 env 值冻结进表（D2 fork 失败
  // 模式），env 未配时更会写空串行永久遮蔽兜底且无 DELETE 端点可清。
  // 非敏感键 dirty+清空 = 显式停用（提交空串）；敏感键沿用留空 = 不修改。
  const [extraDirty, setExtraDirty] = useState<Record<string, boolean>>({});
  const extraDirtyCount = extraKeys.filter((k) => extraDirty[k]).length;
  useEffect(() => {
    if (!eff || extraHydrated) return;
    const next: Record<string, string> = {};
    for (const k of extraKeys) {
      if (eff[k] !== MASKED) next[k] = eff[k];
    }
    setExtraVals(next);
    setExtraHydrated(true);
    // extraKeys 依赖 eff 的键集合，水合一次即定格
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eff, extraHydrated]);

  useEffect(() => {
    if (!eff || hydrated) return;
    setBannerText(eff.banner_text ?? '');
    setBannerKind(eff.banner_kind === 'warn' ? 'warn' : 'info');
    setMaintenance(eff.maintenance_mode === '1');
    setAllowSignup(eff.allow_signup !== '0');
    setDomains(eff.allowed_domains ?? '');
    setRlPerUser(eff.rate_limit_per_user_per_min ?? '0');
    setRlPerIP(eff.rate_limit_per_ip_per_min ?? '30');
    setRlAllowlist(eff.rate_limit_allowlist ?? '');
    setSmtpHost(eff.smtp_host ?? '');
    setSmtpPort(eff.smtp_port ?? '');
    setSmtpUser(eff.smtp_user ?? '');
    setSmtpFrom(eff.smtp_from ?? '');
    setVerifyMeta(eff.site_verification_meta ?? '');
    setHydrated(true);
  }, [eff, hydrated]);

  const afterSave = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
    
    qc.invalidateQueries({ queryKey: SITE_CONFIG_QUERY_KEY });
  };

  
  
  const rollbackToServer = async () => {
    await qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
    setHydrated(false);
    setExtraHydrated(false);
  };

  
  const reportKeySaves = (
    results: KeySaveResult[],
    successMsg: string,
    what: string,
  ) => {
    const okCount = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    afterSave(); 
    if (failed.length === 0) {
      toast.success(successMsg);
      return;
    }
    const failedLabel = failed.map((f) => f.label).join(t('admin.settings.labelSep'));
    const reason = adminError(failed[0].err, t('admin.settings.errSaveFailed'));
    if (okCount > 0) {
      toast.error(
        t('admin.settings.partialSaveToast', {
          what,
          ok: okCount,
          total: results.length,
          failed: failedLabel,
          reason,
        }),
        { duration: ERROR_TOAST_MS },
      );
    } else {
      toast.error(t('admin.settings.saveFailedToast', { what, failed: failedLabel, reason }), {
        duration: ERROR_TOAST_MS,
      });
    }
    void rollbackToServer(); 
  };

  
  const saveM = useMutation({
    mutationFn: (p: { key: string; value: string; label: string }) =>
      api.put(`/api/admin/settings/${p.key}`, { value: p.value }),
    onSuccess: (_r, p) => {
      toast.success(t('admin.settings.keySaved', { label: p.label }));
      afterSave();
    },
    onError: (e, p) => {
      toast.error(adminError(e, t('admin.settings.keySaveFailed', { label: p.label })), {
        duration: ERROR_TOAST_MS,
      });
      void rollbackToServer();
    },
  });


  const bannerM = useMutation({
    mutationFn: () =>
      putKeys(api, [
        { key: 'banner_text', label: t('admin.settings.lblBannerText'), value: bannerText },
        { key: 'banner_kind', label: t('admin.settings.lblBannerKind'), value: bannerKind },
      ]),
    onSuccess: (results) =>
      reportKeySaves(results, t('admin.settings.bannerSaved'), t('admin.settings.whatBanner')),
  });


  const domainsM = useMutation({
    mutationFn: () =>
      api.put('/api/admin/settings/allowed_domains', { value: domains.trim() }),
    onSuccess: () => {
      toast.success(t('admin.settings.domainsSaved'));
      afterSave();
    },
    onError: (e) => {
      toast.error(adminError(e, t('admin.settings.domainsSaveFailed')), {
        duration: ERROR_TOAST_MS,
      });
      void rollbackToServer();
    },
  });


  const rateLimitM = useMutation({
    mutationFn: async () => {
      const perUser = parseRateLimit(rlPerUser);
      const perIP = parseRateLimit(rlPerIP);
      if (!perUser.ok) throw new Error(t('admin.settings.rlErrPerUser', { msg: perUser.msg }));
      if (!perIP.ok) throw new Error(t('admin.settings.rlErrPerIp', { msg: perIP.msg }));
      setRlError(null);
      return putKeys(api, [
        {
          key: 'rate_limit_per_user_per_min',
          label: t('admin.settings.lblRlPerUser'),
          value: perUser.v,
        },
        { key: 'rate_limit_per_ip_per_min', label: t('admin.settings.lblRlPerIp'), value: perIP.v },
        { key: 'rate_limit_allowlist', label: t('admin.settings.lblRlAllowlist'), value: rlAllowlist.trim() },
      ]);
    },
    onSuccess: (results) =>
      reportKeySaves(results, t('admin.settings.rlSaved'), t('admin.settings.whatRl')),
    onError: (e) => {
      const msg = e instanceof Error ? e.message : t('admin.settings.rlSaveFailed');
      setRlError(msg);
      toast.error(msg, { duration: ERROR_TOAST_MS });
    },
  });


  // SMTP 发信配置（UP-1）：五键批量提交；smtp_pass 留空（含掩码未动）时
  // 从提交列表剔除，绝不把空值/掩码落库
  const smtpM = useMutation({
    mutationFn: async () => {
      const port = parseSmtpPort(smtpPort);
      if (!port.ok) throw new Error(t('admin.settings.smtpPortErr', { msg: port.msg }));
      setSmtpError(null);
      const entries: { key: string; label: string; value: string }[] = [
        { key: 'smtp_host', label: t('admin.settings.lblSmtpHost'), value: smtpHost.trim() },
        { key: 'smtp_port', label: t('admin.settings.lblSmtpPort'), value: port.v },
        { key: 'smtp_user', label: t('admin.settings.lblSmtpUser'), value: smtpUser.trim() },
        ...(smtpPass !== ''
          ? [{ key: 'smtp_pass', label: t('admin.settings.lblSmtpPass'), value: smtpPass }]
          : []),
        { key: 'smtp_from', label: t('admin.settings.lblSmtpFrom'), value: smtpFrom.trim() },
      ];
      return putKeys(api, entries);
    },
    onSuccess: (results) =>
      reportKeySaves(results, t('admin.settings.smtpSaved'), t('admin.settings.whatSmtp')),
    onError: (e) => {
      const msg = e instanceof Error ? e.message : t('admin.settings.smtpSaveFailed');
      setSmtpError(msg);
      toast.error(msg, { duration: ERROR_TOAST_MS });
    },
  });


  // 站长验证（UP-2）：原样提交，后端归一为 name|content 存储（400 = 校验拒绝）
  const verifyM = useMutation({
    mutationFn: () =>
      api.put('/api/admin/settings/site_verification_meta', {
        value: verifyMeta.trim(),
      }),
    onSuccess: () => {
      toast.success(t('admin.settings.siteVerifySaved'));
      afterSave();
    },
    onError: (e) => {
      toast.error(adminError(e, t('admin.settings.siteVerifySaveFailed')), {
        duration: ERROR_TOAST_MS,
      });
      void rollbackToServer();
    },
  });

  // 产品注册键通用卡：一键一 PUT；只提交 dirty 键（见 extraDirty 注释）。
  // 敏感键（读回为掩码）在 dirty 之上仍叠加「留空 = 不修改」——绝不把
  // 掩码/空值落库；非敏感键 dirty + 空串 = 显式停用，必须放行提交。
  const extraM = useMutation({
    mutationFn: async () => {
      const descriptions = settingsQ.data?.descriptions ?? {};
      const entries = extraKeys
        .filter((k) => {
          if (!extraDirty[k]) return false;
          if (eff?.[k] === MASKED) return (extraVals[k] ?? '') !== '';
          return true;
        })
        .map((k) => ({
          key: k,
          label: descriptions[k] || k,
          value: (extraVals[k] ?? '').trim(),
        }));
      return putKeys(api, entries);
    },
    onSuccess: (results) => {
      // 成功键解除 dirty（失败键保留，修完直接再保存）；敏感键提交后
      // 清掉 state 里的明文——读回永远掩码，state 归位空串防内存驻留。
      const okKeys = new Set(results.filter((r) => r.ok).map((r) => r.key));
      setExtraDirty((prev) => {
        const next = { ...prev };
        for (const k of okKeys) delete next[k];
        return next;
      });
      setExtraVals((prev) => {
        const next = { ...prev };
        for (const k of okKeys) {
          if (eff?.[k] === MASKED) next[k] = '';
        }
        return next;
      });
      reportKeySaves(results, t('admin.settings.extraSaved'), t('admin.settings.lblExtra'));
    },
    onError: (e) => {
      toast.error(adminError(e, t('admin.settings.extraSaveFailed')), {
        duration: ERROR_TOAST_MS,
      });
      setExtraDirty({});
      void rollbackToServer();
    },
  });

  const [testTo, setTestTo] = useState('');
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const testEmailM = useMutation({
    mutationFn: () =>
      api.post<TestEmailResult>('/api/admin/settings/test-email', {
        to: testTo.trim(),
      }),
    onSuccess: (r) => {
      setTestMsg(
        r?.mode === 'dev'
          ? t('admin.settings.devChannelToast', {
              hint: r.hint ?? t('admin.settings.devChannelHintDefault'),
            })
          : t('admin.settings.testEmailSent'),
      );
    },
    onError: (e) =>
      setTestMsg(t('admin.settings.testEmailFailed', { reason: adminError(e, t('admin.settings.unknownError')) })),
  });

  if (settingsQ.isPending) {
    return <PageLoading label={t('admin.settings.loading')} />;
  }
  if (settingsQ.isError) {
    return (
      <PageError
        message={adminError(settingsQ.error, t('admin.settings.loadFailed'))}
        onRetry={() => void settingsQ.refetch()}
      />
    );
  }
  const mailMode = settingsQ.data?.mail_mode ?? '';
  const oauth = settingsQ.data?.oauth;

  return (
    <div className="space-y-6">
      <PageHeader title={t('admin.settings.pageTitle')} />

      {/* ① 站点公告 */}
      <Card>
        <CardHeader>
          <CardDescription>{t('admin.settings.bannerCardDesc')}</CardDescription>
          <CardTitle>{t('admin.settings.bannerCardTitle')}</CardTitle>
          <CardAction>
            <Badge variant={bannerText.trim() ? 'secondary' : 'outline'}>
              {bannerText.trim() ? t('admin.settings.badgeShowing') : t('admin.settings.badgeHidden')}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 即时预览：与产品壳顶条同一组件/同一 props */}
          <div className="rounded-lg border border-dashed">
            <SiteBanner text={bannerText} kind={bannerKind} />
          </div>
          <FormField label={t('admin.settings.lblBannerText')} htmlFor="banner-text">
            {/* stock Textarea：min-h-16/w-full 由组件 token 自带，
                FormField 注入的 aria-invalid 变体从此生效 */}
            <Textarea
              id="banner-text"
              placeholder={t('admin.settings.bannerTextPh')}
              maxLength={500}
              value={bannerText}
              onChange={(e) => setBannerText(e.target.value)}
            />
          </FormField>
          <FormField label={t('admin.settings.lblStyle')} htmlFor="banner-kind">
            <Select
              value={bannerKind}
              onValueChange={(v) =>
                setBannerKind(v === 'warn' ? 'warn' : 'info')
              }
            >
              <SelectTrigger
                id="banner-kind"
                size="sm"
                aria-label={t('admin.settings.lblBannerKind')}
                className="w-40"
              >
                <SelectValue>
                  {bannerKind === 'warn'
                    ? t('admin.settings.kindWarn')
                    : t('admin.settings.kindInfo')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">{t('admin.settings.kindInfo')}</SelectItem>
                <SelectItem value="warn">{t('admin.settings.kindWarn')}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <div>
            <Button
              size="sm"
              disabled={bannerM.isPending || !hydrated}
              onClick={() => bannerM.mutate()}
            >
              {bannerM.isPending ? t('admin.settings.saving') : t('admin.settings.saveBanner')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ② 维护模式（B-settings-7：补状态徽章，与公告/注册/限流卡形态一致） */}
      <Card>
        <CardHeader>
          <CardDescription>{t('admin.settings.lblMaintenance')}</CardDescription>
          <CardTitle>{t('admin.settings.maintenanceCardTitle')}</CardTitle>
          <CardAction>
            <div className="flex items-center gap-2">
              <Badge variant={maintenance ? 'destructive' : 'outline'}>
                {maintenance
                  ? t('admin.settings.badgeMaintOn')
                  : t('admin.settings.badgeRunning')}
              </Badge>
              <Switch
                checked={maintenance}
                onCheckedChange={(v) => {

                  if (saveM.isPending) return;
                  setMaintenance(v);
                  saveM.mutate({
                    key: 'maintenance_mode',
                    value: v ? '1' : '0',
                    label: t('admin.settings.lblMaintenance'),
                  });
                }}
                aria-label={t('admin.settings.maintenanceSwitchAria')}
              />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('admin.settings.maintenanceHint')}</p>
        </CardContent>
      </Card>

      {/* ③ 注册管控 */}
      <Card>
        <CardHeader>
          <CardDescription>{t('admin.settings.signupCardDesc')}</CardDescription>
          <CardTitle>{t('admin.settings.signupCardTitle')}</CardTitle>
          <CardAction>
            <Switch
              checked={allowSignup}
              onCheckedChange={(v) => {

                if (saveM.isPending) return;
                setAllowSignup(v);
                saveM.mutate({
                  key: 'allow_signup',
                  value: v ? '1' : '0',
                  label: t('admin.settings.lblSignup'),
                });
              }}
              aria-label={t('admin.settings.signupSwitchAria')}
            />
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('admin.settings.signupHint')}
          </p>
          <div className="flex items-center gap-2 text-sm">
            <Badge variant={allowSignup ? 'secondary' : 'destructive'}>
              {allowSignup
                ? t('admin.settings.badgeOpenSignup')
                : t('admin.settings.badgeInviteOnly')}
            </Badge>
          </div>
          <FormField
            label={t('admin.settings.lblDomains')}
            htmlFor="allowed-domains"
          >
            <Input
              id="allowed-domains"
              placeholder={t('admin.settings.domainsPh')}
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
            />
          </FormField>
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={domainsM.isPending || !hydrated}
              onClick={() => domainsM.mutate()}
            >
              {domainsM.isPending ? t('admin.settings.saving') : t('admin.settings.saveDomains')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>{t('admin.settings.rlCardDesc')}</CardDescription>
          <CardTitle>{t('admin.settings.rlCardTitle')}</CardTitle>
          <CardAction>
            <Badge
              variant={
                rlPerUser !== '0' || rlPerIP !== '0' ? 'secondary' : 'outline'
              }
            >
              {rlPerUser !== '0' || rlPerIP !== '0'
                ? t('admin.settings.badgeEnabled')
                : t('admin.settings.badgeDefaults')}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('admin.settings.rlHint')}
          </p>
          <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
            {/* B-settings-10：text + inputMode（type=number 对垃圾字符静默置空，
                会被当成留空→0=关闭限流落库）；空值/非法值保存前拒绝并就地提示 */}
            <FormField
              label={t('admin.settings.lblRlPerUserField')}
              htmlFor="rl-per-user"
              error={
                rlError?.startsWith(t('admin.settings.lblRlPerUser')) ? rlError : undefined
              }
            >
              <Input
                id="rl-per-user"
                type="text"
                inputMode="numeric"
                placeholder={t('admin.settings.rlPerUserPh')}
                value={rlPerUser}
                onChange={(e) => {
                  setRlPerUser(e.target.value);
                  if (rlError?.startsWith(t('admin.settings.lblRlPerUser'))) setRlError(null);
                }}
                aria-invalid={rlError?.startsWith(t('admin.settings.lblRlPerUser')) ? true : undefined}
              />
            </FormField>
            <FormField
              label={t('admin.settings.lblRlPerIpField')}
              htmlFor="rl-per-ip"
              error={rlError?.startsWith(t('admin.settings.lblRlPerIp')) ? rlError : undefined}
            >
              <Input
                id="rl-per-ip"
                type="text"
                inputMode="numeric"
                placeholder={t('admin.settings.rlPerIpPh')}
                value={rlPerIP}
                onChange={(e) => {
                  setRlPerIP(e.target.value);
                  if (rlError?.startsWith(t('admin.settings.lblRlPerIp'))) setRlError(null);
                }}
                aria-invalid={rlError?.startsWith(t('admin.settings.lblRlPerIp')) ? true : undefined}
              />
            </FormField>
          </div>
          <FormField
            label={t('admin.settings.lblRlAllowlistField')}
            htmlFor="rl-allowlist"
          >
            <Input
              id="rl-allowlist"
              className="font-mono"
              placeholder={t('admin.settings.rlAllowlistPh')}
              value={rlAllowlist}
              onChange={(e) => setRlAllowlist(e.target.value)}
            />
          </FormField>
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={rateLimitM.isPending || !hydrated}
              onClick={() => rateLimitM.mutate()}
            >
              {rateLimitM.isPending ? t('admin.settings.saving') : t('admin.settings.saveRl')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* SMTP 发信配置（UP-1）：形态对齐限流卡；smtp_pass 掩码不回填、留空跳过提交 */}
      <Card>
        <CardHeader>
          <CardDescription>{t('admin.settings.smtpCardDesc')}</CardDescription>
          <CardTitle>{t('admin.settings.smtpCardTitle')}</CardTitle>
          <CardAction>
            <Badge variant={mailMode === 'smtp' ? 'secondary' : 'outline'}>
              {mailMode === 'smtp'
                ? t('admin.settings.badgeSmtpDirect')
                : mailMode === 'dev'
                  ? t('admin.settings.badgeDevChannel')
                  : t('admin.settings.badgeMailNone')}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('admin.settings.smtpHint')}
          </p>
          <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
            <FormField label={t('admin.settings.lblSmtpHostField')} htmlFor="smtp-host">
              <Input
                id="smtp-host"
                placeholder={t('admin.settings.smtpHostPh')}
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
              />
            </FormField>
            <FormField
              label={t('admin.settings.lblSmtpPortField')}
              htmlFor="smtp-port"
              error={smtpError?.startsWith(t('admin.settings.lblSmtpPort')) ? smtpError : undefined}
            >
              {/* 与限流卡同款处置：text + inputMode（type=number 对垃圾字符静默置空）；
                  非法端口保存前拒绝并就地提示 */}
              <Input
                id="smtp-port"
                type="text"
                inputMode="numeric"
                placeholder={t('admin.settings.smtpPortPh')}
                value={smtpPort}
                onChange={(e) => {
                  setSmtpPort(e.target.value);
                  if (smtpError?.startsWith(t('admin.settings.lblSmtpPort'))) setSmtpError(null);
                }}
                aria-invalid={
                  smtpError?.startsWith(t('admin.settings.lblSmtpPort')) ? true : undefined
                }
              />
            </FormField>
            <FormField label={t('admin.settings.lblSmtpUser')} htmlFor="smtp-user">
              <Input
                id="smtp-user"
                className="font-mono"
                placeholder={t('admin.settings.smtpEmailPh')}
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
              />
            </FormField>
            <FormField label={t('admin.settings.lblSmtpPassField')} htmlFor="smtp-pass">
              <Input
                id="smtp-pass"
                type="password"
                placeholder="******"
                autoComplete="new-password"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
              />
            </FormField>
            <FormField label={t('admin.settings.lblSmtpFrom')} htmlFor="smtp-from">
              <Input
                id="smtp-from"
                type="email"
                placeholder={t('admin.settings.smtpEmailPh')}
                value={smtpFrom}
                onChange={(e) => setSmtpFrom(e.target.value)}
              />
            </FormField>
          </div>
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={smtpM.isPending || !hydrated}
              onClick={() => smtpM.mutate()}
            >
              {smtpM.isPending ? t('admin.settings.saving') : t('admin.settings.saveSmtp')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ⑤ 测试邮件（P2-14：去产品指代——框架文案不点名 example 接线） */}
      <Card>
        <CardHeader>
          <CardDescription>{t('admin.settings.testCardDesc')}</CardDescription>
          <CardTitle>{t('admin.settings.testCardTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* SecuritySettingsPage PasswordField 同款结构：FormField 提供可见
              label，id 手动落到 InputGroupInput 上——label htmlFor 关联不因
              包裹层而断；本处无 error/description/required，FormField 不触发
              cloneElement 注入，aria 属性不受包裹层影响 */}
          <FormField label={t('admin.settings.lblTestTo')} htmlFor="test-email-to">
            <InputGroup className="max-w-md">
              <InputGroupInput
                id="test-email-to"
                type="email"
                placeholder={t('admin.settings.testToPh')}
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  disabled={testEmailM.isPending || !testTo.trim()}
                  onClick={() => {
                    setTestMsg(null);
                    testEmailM.mutate();
                  }}
                >
                  {testEmailM.isPending ? t('admin.settings.sending') : t('admin.settings.send')}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </FormField>
          {testMsg && (
            // role="status" 覆盖 Alert 默认的 role="alert"（alert.tsx {...props}
            // 后展开生效）：发送结果是状态回执而非告警
            <Alert role="status" className="bg-muted">
              <AlertDescription>{testMsg}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* 站长验证（UP-2）：粘贴完整 meta 标签或 name|content 对，后端归一存储；
          注入由站点侧中间件完成，用户输入的 HTML 片段永不回显 */}
      <Card>
        <CardHeader>
          <CardDescription>{t('admin.settings.verifyCardDesc')}</CardDescription>
          <CardTitle>{t('admin.settings.verifyCardTitle')}</CardTitle>
          <CardAction>
            <Badge variant={verifyMeta.trim() ? 'secondary' : 'outline'}>
              {verifyMeta.trim()
                ? t('admin.settings.badgeInjected')
                : t('admin.settings.badgeNotConfigured')}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('admin.settings.verifyHint')}
          </p>
          <FormField
            label={t('admin.settings.lblVerifyMeta')}
            htmlFor="site-verification-meta"
          >
            <Textarea
              id="site-verification-meta"
              placeholder={t('admin.settings.verifyMetaPh')}
              value={verifyMeta}
              onChange={(e) => setVerifyMeta(e.target.value)}
            />
          </FormField>
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={verifyM.isPending || !hydrated}
              onClick={() => verifyM.mutate()}
            >
              {verifyM.isPending ? t('admin.settings.saving') : t('admin.settings.saveVerify')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 登录方式（UP-6）：只读状态卡；信封无 oauth 字段 = 后端未接线，整卡隐藏 */}
      {oauth && (
        <Card>
          <CardHeader>
            <CardDescription>{t('admin.settings.oauthCardDesc')}</CardDescription>
            <CardTitle>{t('admin.settings.oauthCardTitle')}</CardTitle>
            <CardAction>
              <Badge variant={oauth.length > 0 ? 'secondary' : 'outline'}>
                {oauth.length > 0
                  ? t('admin.settings.oauthBadgeOn', { count: oauth.length })
                  : t('admin.settings.badgeNotEnabled')}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('admin.settings.oauthHint')}
            </p>
            {oauth.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('admin.settings.oauthEmpty')}
              </p>
            ) : (
              <ul className="space-y-2">
                {oauth.map((p) => (
                  <li
                    key={p.name}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <Badge variant="secondary">{p.name}</Badge>
                    <code className="font-mono text-xs break-all text-muted-foreground">
                      {p.callback_url}
                    </code>
                    {/* MembersPage 转让按钮同款 TooltipTrigger render 配方：
                        原生 title 换 Tooltip，aria-label 保留供读屏 */}
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-6 shrink-0 p-0 text-muted-foreground"
                            aria-label={t('admin.settings.oauthCopyAria', { name: p.name })}
                            onClick={() =>
                              copyCallbackUrl(p.name, p.callback_url)
                            }
                          />
                        }
                      >
                        <Copy size={12} aria-hidden="true" />
                      </TooltipTrigger>
                      <TooltipContent>
                        {t('admin.settings.oauthCopyAria', { name: p.name })}
                      </TooltipContent>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* 产品注册键通用卡（settings.RegisterKeys）：键由后端注册表驱动，
          descriptions 提供说明文案；敏感键（读回为掩码）走 smtp_pass 同款
          "留空 = 不修改" 语义。无注册键时整卡不渲染 */}
      {extraKeys.length > 0 && (
        <Card>
          <CardHeader>
            <CardDescription>{t('admin.settings.lblExtra')}</CardDescription>
            <CardTitle>{t('admin.settings.extraCardTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {extraKeys.map((k) => {
              const masked = eff?.[k] === MASKED;
              const described =
                settingsQ.data?.descriptions?.[k];
              return (
                <FormField
                  key={k}
                  label={k}
                  htmlFor={`extra-${k}`}
                  description={described}
                >
                  <Input
                    id={`extra-${k}`}
                    className="font-mono"
                    type={masked ? 'password' : 'text'}
                    placeholder={
                      masked
                        ? eff?.[k]
                          ? t('admin.settings.extraMaskedPh')
                          : t('admin.settings.badgeNotConfigured')
                        : ''
                    }
                    autoComplete={masked ? 'new-password' : 'off'}
                    value={extraVals[k] ?? ''}
                    onChange={(e) => {
                      setExtraVals((prev) => ({
                        ...prev,
                        [k]: e.target.value,
                      }));
                      setExtraDirty((prev) => ({ ...prev, [k]: true }));
                    }}
                  />
                </FormField>
              );
            })}
            <div>
              <Button
                size="sm"
                variant="outline"
                disabled={extraM.isPending || !extraHydrated || extraDirtyCount === 0}
                onClick={() => extraM.mutate()}
              >
                {extraM.isPending ? t('admin.settings.saving') : t('admin.settings.saveExtra')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 产品自定义卡：渲染在框架卡之后，产品自带数据源 */}
      {children}
    </div>
  );
}
