
import { useEffect, useState } from 'react';
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


function parseRateLimit(
  raw: string,
): { ok: true; v: string } | { ok: false; msg: string } {
  const s = raw.trim();
  if (s === '') {
    return { ok: false, msg: '不能留空：填写 0 表示关闭限流' };
  }
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 100000) {
    return { ok: false, msg: '必须是 0..100000 的整数（0 = 关闭限流）' };
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
    return { ok: false, msg: '必须是 1..65535 的整数（留空 = 用缺省 587）' };
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
      .then(() => toast.success(`${name} 回调地址已复制`))
      .catch(() => toast.error(`复制失败，完整地址：${url}`));
  } else {
    toast.info(`当前环境不支持自动复制，完整地址：${url}`);
  }
}

export function AdminSettingsPage() {
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
    const failedLabel = failed.map((f) => f.label).join('、');
    const reason = adminError(failed[0].err, '保存失败');
    if (okCount > 0) {
      toast.error(
        `${what}部分保存：成功 ${okCount}/${results.length} 项已生效；失败项（${failedLabel}）原因：${reason}`,
        { duration: ERROR_TOAST_MS },
      );
    } else {
      toast.error(`${what}保存失败（${failedLabel}）：${reason}`, {
        duration: ERROR_TOAST_MS,
      });
    }
    void rollbackToServer(); 
  };

  
  const saveM = useMutation({
    mutationFn: (p: { key: string; value: string; label: string }) =>
      api.put(`/api/admin/settings/${p.key}`, { value: p.value }),
    onSuccess: (_r, p) => {
      toast.success(`${p.label}已保存`);
      afterSave();
    },
    onError: (e, p) => {
      toast.error(adminError(e, `${p.label}保存失败`), {
        duration: ERROR_TOAST_MS,
      });
      void rollbackToServer(); 
    },
  });

  
  const bannerM = useMutation({
    mutationFn: () =>
      putKeys(api, [
        { key: 'banner_text', label: '公告文本', value: bannerText },
        { key: 'banner_kind', label: '公告样式', value: bannerKind },
      ]),
    onSuccess: (results) =>
      reportKeySaves(results, '公告已保存', '公告'),
  });

  
  const domainsM = useMutation({
    mutationFn: () =>
      api.put('/api/admin/settings/allowed_domains', { value: domains.trim() }),
    onSuccess: () => {
      toast.success('域名白名单已保存');
      afterSave();
    },
    onError: (e) => {
      toast.error(adminError(e, '域名白名单保存失败'), {
        duration: ERROR_TOAST_MS,
      });
      void rollbackToServer();
    },
  });

  
  const rateLimitM = useMutation({
    mutationFn: async () => {
      const perUser = parseRateLimit(rlPerUser);
      const perIP = parseRateLimit(rlPerIP);
      if (!perUser.ok) throw new Error(`每用户限流：${perUser.msg}`);
      if (!perIP.ok) throw new Error(`每 IP 限流：${perIP.msg}`);
      setRlError(null);
      return putKeys(api, [
        {
          key: 'rate_limit_per_user_per_min',
          label: '每用户限流',
          value: perUser.v,
        },
        { key: 'rate_limit_per_ip_per_min', label: '每 IP 限流', value: perIP.v },
        { key: 'rate_limit_allowlist', label: '豁免名单', value: rlAllowlist.trim() },
      ]);
    },
    onSuccess: (results) =>
      reportKeySaves(results, '限流配置已保存（重启后生效）', '限流配置'),
    onError: (e) => {
      const msg = e instanceof Error ? e.message : '限流配置保存失败';
      setRlError(msg);
      toast.error(msg, { duration: ERROR_TOAST_MS });
    },
  });

  
  // SMTP 发信配置（UP-1）：五键批量提交；smtp_pass 留空（含掩码未动）时
  // 从提交列表剔除，绝不把空值/掩码落库
  const smtpM = useMutation({
    mutationFn: async () => {
      const port = parseSmtpPort(smtpPort);
      if (!port.ok) throw new Error(`SMTP 端口：${port.msg}`);
      setSmtpError(null);
      const entries: { key: string; label: string; value: string }[] = [
        { key: 'smtp_host', label: 'SMTP 主机', value: smtpHost.trim() },
        { key: 'smtp_port', label: 'SMTP 端口', value: port.v },
        { key: 'smtp_user', label: 'SMTP 用户名', value: smtpUser.trim() },
        ...(smtpPass !== ''
          ? [{ key: 'smtp_pass', label: 'SMTP 密码', value: smtpPass }]
          : []),
        { key: 'smtp_from', label: '发件人地址', value: smtpFrom.trim() },
      ];
      return putKeys(api, entries);
    },
    onSuccess: (results) =>
      reportKeySaves(results, 'SMTP 配置已保存', 'SMTP 配置'),
    onError: (e) => {
      const msg = e instanceof Error ? e.message : 'SMTP 配置保存失败';
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
      toast.success('站长验证配置已保存');
      afterSave();
    },
    onError: (e) => {
      toast.error(adminError(e, '站长验证配置保存失败'), {
        duration: ERROR_TOAST_MS,
      });
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
          ? `开发通道（emaildev）：${r.hint ?? '邮件内容已打日志，请到后端日志查看'}`
          : '测试邮件已发出，请到收件箱（含垃圾箱）确认',
      );
    },
    onError: (e) => setTestMsg(`发送失败：${adminError(e, '未知错误')}`),
  });

  if (settingsQ.isPending) {
    return <PageLoading label="加载设置中…" />;
  }
  if (settingsQ.isError) {
    return (
      <PageError
        message={adminError(settingsQ.error, '设置加载失败')}
        onRetry={() => void settingsQ.refetch()}
      />
    );
  }
  const mailMode = settingsQ.data?.mail_mode ?? '';
  const oauth = settingsQ.data?.oauth;

  return (
    <div className="space-y-6">
      <PageHeader title="系统" />

      {/* ① 站点公告 */}
      <Card>
        <CardHeader>
          <CardDescription>站点公告</CardDescription>
          <CardTitle>顶部公告横条</CardTitle>
          <CardAction>
            <Badge variant={bannerText.trim() ? 'secondary' : 'outline'}>
              {bannerText.trim() ? '展示中' : '未展示'}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 即时预览：与产品壳顶条同一组件/同一 props */}
          <div className="rounded-lg border border-dashed">
            <SiteBanner text={bannerText} kind={bannerKind} />
          </div>
          <FormField label="公告文本" htmlFor="banner-text">
            {/* stock Textarea：min-h-16/w-full 由组件 token 自带，
                FormField 注入的 aria-invalid 变体从此生效 */}
            <Textarea
              id="banner-text"
              placeholder="如：今晚 22:00–23:00 例行维护，期间可能短暂不可用"
              maxLength={500}
              value={bannerText}
              onChange={(e) => setBannerText(e.target.value)}
            />
          </FormField>
          <FormField label="样式" htmlFor="banner-kind">
            <Select
              value={bannerKind}
              onValueChange={(v) =>
                setBannerKind(v === 'warn' ? 'warn' : 'info')
              }
            >
              <SelectTrigger
                id="banner-kind"
                size="sm"
                aria-label="公告样式"
                className="w-40"
              >
                <SelectValue>
                  {bannerKind === 'warn' ? '警示（橙红）' : '信息（蓝）'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">信息（蓝）</SelectItem>
                <SelectItem value="warn">警示（橙红）</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <div>
            <Button
              size="sm"
              disabled={bannerM.isPending || !hydrated}
              onClick={() => bannerM.mutate()}
            >
              {bannerM.isPending ? '保存中…' : '保存公告'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ② 维护模式（B-settings-7：补状态徽章，与公告/注册/限流卡形态一致） */}
      <Card>
        <CardHeader>
          <CardDescription>维护模式</CardDescription>
          <CardTitle>全站"维护中"提示条</CardTitle>
          <CardAction>
            <div className="flex items-center gap-2">
              <Badge variant={maintenance ? 'destructive' : 'outline'}>
                {maintenance ? '维护中' : '正常运行'}
              </Badge>
              <Switch
                checked={maintenance}
                onCheckedChange={(v) => {
                  
                  if (saveM.isPending) return;
                  setMaintenance(v);
                  saveM.mutate({
                    key: 'maintenance_mode',
                    value: v ? '1' : '0',
                    label: '维护模式',
                  });
                }}
                aria-label="维护模式开关"
              />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">仅提示，不阻断请求。</p>
        </CardContent>
      </Card>

      {/* ③ 注册管控 */}
      <Card>
        <CardHeader>
          <CardDescription>注册管控</CardDescription>
          <CardTitle>注册开关与域名白名单</CardTitle>
          <CardAction>
            <Switch
              checked={allowSignup}
              onCheckedChange={(v) => {
                
                if (saveM.isPending) return;
                setAllowSignup(v);
                saveM.mutate({
                  key: 'allow_signup',
                  value: v ? '1' : '0',
                  label: '注册开关',
                });
              }}
              aria-label="开放注册开关"
            />
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            关闭 = 邀请制，仅白名单内邮箱可注册。
          </p>
          <div className="flex items-center gap-2 text-sm">
            <Badge variant={allowSignup ? 'secondary' : 'destructive'}>
              {allowSignup ? '开放注册' : '邀请制'}
            </Badge>
          </div>
          <FormField
            label="域名白名单（逗号分隔，空 = 不限）"
            htmlFor="allowed-domains"
          >
            <Input
              id="allowed-domains"
              placeholder="如：corp.com, edu.cn"
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
              {domainsM.isPending ? '保存中…' : '保存白名单'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>API 限流</CardDescription>
          <CardTitle>每用户 / 每 IP 限流与豁免名单</CardTitle>
          <CardAction>
            <Badge
              variant={
                rlPerUser !== '0' || rlPerIP !== '0' ? 'secondary' : 'outline'
              }
            >
              {rlPerUser !== '0' || rlPerIP !== '0' ? '启用中' : '按缺省'}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            0 = 关闭；修改后需重启生效。
          </p>
          <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
            {/* B-settings-10：text + inputMode（type=number 对垃圾字符静默置空，
                会被当成留空→0=关闭限流落库）；空值/非法值保存前拒绝并就地提示 */}
            <FormField
              label="每用户请求/分（0 = 关闭）"
              htmlFor="rl-per-user"
              error={
                rlError?.startsWith('每用户') ? rlError : undefined
              }
            >
              <Input
                id="rl-per-user"
                type="text"
                inputMode="numeric"
                placeholder="如 600；0 = 关闭"
                value={rlPerUser}
                onChange={(e) => {
                  setRlPerUser(e.target.value);
                  if (rlError?.startsWith('每用户')) setRlError(null);
                }}
                aria-invalid={rlError?.startsWith('每用户') ? true : undefined}
              />
            </FormField>
            <FormField
              label="每 IP 请求/分（认证路径；0 = 关闭）"
              htmlFor="rl-per-ip"
              error={rlError?.startsWith('每 IP') ? rlError : undefined}
            >
              <Input
                id="rl-per-ip"
                type="text"
                inputMode="numeric"
                placeholder="缺省 30；0 = 关闭"
                value={rlPerIP}
                onChange={(e) => {
                  setRlPerIP(e.target.value);
                  if (rlError?.startsWith('每 IP')) setRlError(null);
                }}
                aria-invalid={rlError?.startsWith('每 IP') ? true : undefined}
              />
            </FormField>
          </div>
          <FormField
            label="豁免名单（逗号分隔 IP 或 CIDR，空 = 无豁免）"
            htmlFor="rl-allowlist"
          >
            <Input
              id="rl-allowlist"
              className="font-mono"
              placeholder="如 10.0.0.5, 192.168.0.0/16"
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
              {rateLimitM.isPending ? '保存中…' : '保存限流配置'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* SMTP 发信配置（UP-1）：形态对齐限流卡；smtp_pass 掩码不回填、留空跳过提交 */}
      <Card>
        <CardHeader>
          <CardDescription>发信通道</CardDescription>
          <CardTitle>SMTP 发信配置</CardTitle>
          <CardAction>
            <Badge variant={mailMode === 'smtp' ? 'secondary' : 'outline'}>
              {mailMode === 'smtp'
                ? 'SMTP 直发'
                : mailMode === 'dev'
                  ? '开发通道'
                  : '未接入'}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            配置后即时生效；密码不回显，留空表示不修改。
          </p>
          <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
            <FormField label="SMTP 服务器" htmlFor="smtp-host">
              <Input
                id="smtp-host"
                placeholder="如 smtp.example.com；留空 = 开发通道"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
              />
            </FormField>
            <FormField
              label="端口（留空 = 缺省 587）"
              htmlFor="smtp-port"
              error={smtpError?.startsWith('SMTP 端口') ? smtpError : undefined}
            >
              {/* 与限流卡同款处置：text + inputMode（type=number 对垃圾字符静默置空）；
                  非法端口保存前拒绝并就地提示 */}
              <Input
                id="smtp-port"
                type="text"
                inputMode="numeric"
                placeholder="缺省 587"
                value={smtpPort}
                onChange={(e) => {
                  setSmtpPort(e.target.value);
                  if (smtpError?.startsWith('SMTP 端口')) setSmtpError(null);
                }}
                aria-invalid={
                  smtpError?.startsWith('SMTP 端口') ? true : undefined
                }
              />
            </FormField>
            <FormField label="SMTP 用户名" htmlFor="smtp-user">
              <Input
                id="smtp-user"
                className="font-mono"
                placeholder="如 no-reply@example.com"
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
              />
            </FormField>
            <FormField label="SMTP 密码（留空 = 不修改）" htmlFor="smtp-pass">
              <Input
                id="smtp-pass"
                type="password"
                placeholder="******"
                autoComplete="new-password"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
              />
            </FormField>
            <FormField label="发件人地址" htmlFor="smtp-from">
              <Input
                id="smtp-from"
                type="email"
                placeholder="如 no-reply@example.com"
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
              {smtpM.isPending ? '保存中…' : '保存 SMTP 配置'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ⑤ 测试邮件（P2-14：去产品指代——框架文案不点名 example 接线） */}
      <Card>
        <CardHeader>
          <CardDescription>邮件通道</CardDescription>
          <CardTitle>发送测试邮件</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* SecuritySettingsPage PasswordField 同款结构：FormField 提供可见
              label，id 手动落到 InputGroupInput 上——label htmlFor 关联不因
              包裹层而断；本处无 error/description/required，FormField 不触发
              cloneElement 注入，aria 属性不受包裹层影响 */}
          <FormField label="测试邮件收件邮箱" htmlFor="test-email-to">
            <InputGroup className="max-w-md">
              <InputGroupInput
                id="test-email-to"
                type="email"
                placeholder="收件邮箱，如 ops@example.com"
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
                  {testEmailM.isPending ? '发送中…' : '发送'}
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
          <CardDescription>站长验证</CardDescription>
          <CardTitle>搜索引擎站点验证</CardTitle>
          <CardAction>
            <Badge variant={verifyMeta.trim() ? 'secondary' : 'outline'}>
              {verifyMeta.trim() ? '已注入' : '未配置'}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            完整 meta 标签或 name|content 对；清空即移除，原文不回显。
          </p>
          <FormField
            label="验证标记（完整 meta 标签或 name|content 对）"
            htmlFor="site-verification-meta"
          >
            <Textarea
              id="site-verification-meta"
              placeholder={
                '<meta name="google-site-verification" content="abc123XYZ" /> 或 google-site-verification|abc123XYZ'
              }
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
              {verifyM.isPending ? '保存中…' : '保存验证配置'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 登录方式（UP-6）：只读状态卡；信封无 oauth 字段 = 后端未接线，整卡隐藏 */}
      {oauth && (
        <Card>
          <CardHeader>
            <CardDescription>登录方式</CardDescription>
            <CardTitle>OAuth 第三方登录</CardTitle>
            <CardAction>
              <Badge variant={oauth.length > 0 ? 'secondary' : 'outline'}>
                {oauth.length > 0 ? `已启用 ${oauth.length} 个` : '未启用'}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              回调地址按请求 Host 实时生成；反向代理需转发 Host 与
              X-Forwarded-Proto，否则登录报 redirect_uri_mismatch。
            </p>
            {oauth.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                设置 GOOGLE_CLIENT_ID / GOOGLE_SECRET、GITHUB_CLIENT_ID /
                GITHUB_SECRET 环境变量并重启后在此显示。
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
                            aria-label={`复制 ${p.name} 回调地址`}
                            onClick={() =>
                              copyCallbackUrl(p.name, p.callback_url)
                            }
                          />
                        }
                      >
                        <Copy size={12} aria-hidden="true" />
                      </TooltipTrigger>
                      <TooltipContent>复制 {p.name} 回调地址</TooltipContent>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
