
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormField } from '../../components/FormField';
import { PageError, PageHeader } from '../../components/Page';
import { toast } from '../../components/toast';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Input } from '../../components/ui/Input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Switch } from '../../components/ui/switch';
import { useApi } from '../../hooks/useApi';
import { SiteBanner } from '../../components/SiteBanner';
import { SITE_CONFIG_QUERY_KEY } from '../../hooks/useSiteConfig';
import { adminError } from './shared';


interface AdminSettingsEnvelope {
  
  items: Record<string, string>;
  
  effective: Record<string, string>;
  defaults: Record<string, string>;
  descriptions: Record<string, string>;
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
      reportKeySaves(results, '公告已保存，全站顶条即时生效', '公告'),
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
    return <p className="text-sm text-muted-foreground">加载设置中…</p>;
  }
  if (settingsQ.isError) {
    return (
      <PageError
        message={adminError(settingsQ.error, '设置加载失败')}
        onRetry={() => void settingsQ.refetch()}
      />
    );
  }
  const desc = settingsQ.data?.descriptions ?? {};

  return (
    <div className="space-y-6">
      <PageHeader
        title="系统"
        
        description="站点公告、维护模式、注册管控、API 限流与邮件通道——保存后全站即时生效（API 限流除外：重启后生效）"
      />

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
          <p className="text-sm text-muted-foreground">{desc.banner_text}</p>
          {/* 即时预览：与产品壳顶条同一组件/同一 props */}
          <div className="rounded-lg border border-dashed">
            <SiteBanner text={bannerText} kind={bannerKind} />
            {!bannerText.trim() && (
              <p className="px-4 py-2 text-xs text-muted-foreground">
                预览：公告为空时不渲染横条
              </p>
            )}
          </div>
          <FormField label="公告文本" htmlFor="banner-text">
            <textarea
              id="banner-text"
              className="flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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
          <p className="text-sm text-muted-foreground">
            {desc.maintenance_mode}
          </p>
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
          <p className="text-sm text-muted-foreground">{desc.allow_signup}</p>
          <div className="flex items-center gap-2 text-sm">
            <Badge variant={allowSignup ? 'secondary' : 'destructive'}>
              {allowSignup ? '开放注册' : '邀请制'}
            </Badge>
            {!allowSignup && (
              <span className="text-muted-foreground">
                注册页会显示"当前为邀请制注册"提示（不阻断提交，服务端才是边界）
              </span>
            )}
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
            {desc.rate_limit_per_user_per_min}{' '}
            修改后需重启生效（启动期静态注入，不做热重载）。
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

      {/* ⑤ 测试邮件（P2-14：去产品指代——框架文案不点名 example 接线） */}
      <Card>
        <CardHeader>
          <CardDescription>邮件通道</CardDescription>
          <CardTitle>发送测试邮件</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            验证出站邮件通道连通性。实际行为取决于部署时的邮件通道：开发通道只打日志、
            不真发信；接入 SMTP 后此按钮发送真实邮件。
          </p>
          <div className="flex max-w-md gap-2">
            <Input
              type="email"
              placeholder="收件邮箱，如 ops@example.com"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              aria-label="测试邮件收件邮箱"
            />
            <Button
              size="sm"
              className="shrink-0"
              disabled={testEmailM.isPending || !testTo.trim()}
              onClick={() => {
                setTestMsg(null);
                testEmailM.mutate();
              }}
            >
              {testEmailM.isPending ? '发送中…' : '发送'}
            </Button>
          </div>
          {testMsg && (
            <p
              role="status"
              className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground"
            >
              {testMsg}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
