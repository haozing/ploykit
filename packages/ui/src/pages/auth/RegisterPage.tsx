
import { useRef, useState } from 'react';
// zod/mini：注册页是整站唯一带校验 schema 的公开页，全量 zod 会把整个
// classic API 面（约 39KB gzip）拖进每个访客的首包。mini 只带核心校验器 +
// 显式 check 组合，同样的规则体积约为其十分之一；错误对象结构一致
// （`_zod.traits` 带 `$ZodError`），useZodForm 的 resolver 无需改动。
import * as z from 'zod/mini';
import { AuthShell } from '../../layouts/AuthShell';
import { FormField } from '../../components/FormField';
import { PasswordField } from '../../components/PasswordField';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { FieldDescription, FieldSeparator } from '../../components/ui/field';
import { Spinner } from '../../components/ui/spinner';
import { TurnstileWidget, type TurnstileWidgetHandle } from '../../auth/TurnstileWidget';
import { useAuth } from '@ploykit/hooks';
import { useSiteConfig } from '@ploykit/hooks';
import { useZodForm } from '@ploykit/hooks';
import { apiErrorMessage } from '../../lib/api-error';
import { postTurnstileProtected, turnstileSiteKey } from '../../lib/turnstile';
import { passwordKinds, passwordSchema } from '../../lib/password-schema';
import { toast } from '../../components/toast';
import type { PKUser } from '@ploykit/hooks';

// 密码强度规则住在 lib/password-schema：它同时被重置密码页与设置区的
// 改密页复用，留在本文件会把整个注册页组件连带拖进设置区的 chunk。
export { passwordSchema };

export const registerSchema = z.object({
  
  email: z.string().check(
    z.minLength(1, '请输入邮箱'),
    z.maxLength(254, '邮箱过长'),
    z.email('邮箱格式不正确'),
  ),
  password: passwordSchema,
  
  display_name: z.optional(z.string().check(z.maxLength(100, '昵称最多 100 字符'))),
});

export type RegisterForm = z.infer<typeof registerSchema>;

export interface RegisterPageProps {
  
  onSuccess?: () => void;
  
  loginPath?: string;
  title?: string;
  description?: string;
}

export function RegisterPage({
  onSuccess,
  loginPath = '/login',
  title = '创建账号',
  description,
}: RegisterPageProps) {
  const { refresh } = useAuth();

  const { data: siteCfg } = useSiteConfig();
  const inviteOnly = siteCfg?.allow_signup === '0';
  // Turnstile：/config 带回非空 site key 才启用（未配置的产品整个 widget
  // render null，表单行为与本批之前完全一致）。token 一次性，提交失败后
  // reset 重取。
  const turnstileRequired = turnstileSiteKey(siteCfg) !== null;
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useZodForm<RegisterForm>({
    schema: registerSchema,
    defaultValues: { email: '', password: '', display_name: '' },
  });

  const handleSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    setSubmitting(true);
    try {
      const body: { email: string; password: string; display_name?: string } = {
        email: values.email,
        password: values.password,
      }
      if (values.display_name?.trim()) body.display_name = values.display_name.trim()
      await postTurnstileProtected<{ user: PKUser; expires_at: string }>(
        '/auth/register',
        body,
        turnstileToken,
      )
      await refresh();
      toast.success('注册成功');
      if (onSuccess) onSuccess();
      else window.location.href = '/app';
    } catch (e) {
      const msg = apiErrorMessage(e, '注册失败，请稍后重试');
      setServerError(msg);
      toast.error(msg);
      // token 一次性：无论何种失败（含 400 E_TURNSTILE）都不复用，重置出题。
      if (turnstileRequired) {
        setTurnstileToken(null);
        turnstileRef.current?.reset();
      }
    } finally {
      setSubmitting(false);
    }
  });

  const pw = form.watch('password') ?? '';
  const kinds = passwordKinds(pw);

  return (
    <>
      {inviteOnly && (
        <div className="fixed inset-x-0 top-0 z-50 border-b border-primary/25 bg-primary/10 px-4 py-2 text-center text-sm text-primary">
          当前为邀请制注册：仅白名单邮箱可完成注册（最终以服务端校验为准）
        </div>
      )}
      <AuthShell footer={<span>注册即代表同意我们的服务条款与隐私政策</span>}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="flex flex-col items-center gap-1 text-center">
            <h1 className="text-2xl font-bold">{title}</h1>
            {description && (
              <p className="text-sm text-balance text-muted-foreground">
                {description}
              </p>
            )}
          </div>

          <FormField
            label="邮箱"
            error={form.formState.errors.email?.message}
            htmlFor="reg-email"
          >
            <Input
              id="reg-email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              {...form.register('email')}
            />
          </FormField>

          <FormField
            label="密码"
            error={form.formState.errors.password?.message}
            htmlFor="reg-password"
          >
            <PasswordField
              id="reg-password"
              placeholder="至少 10 位，含三类字符"
              autoComplete="new-password"
              {...form.register('password')}
            />
            {pw.length > 0 && (
              <FieldDescription>
                字符类别：大写 {/[A-Z]/.test(pw) ? '✓' : '—'} / 小写{' '}
                {/[a-z]/.test(pw) ? '✓' : '—'} / 数字{' '}
                {/[0-9]/.test(pw) ? '✓' : '—'} / 符号{' '}
                {/[^0-9a-zA-Z]/.test(pw) ? '✓' : '—'}
                （已满足 {kinds}/3 类）
              </FieldDescription>
            )}
          </FormField>

          <FormField
            label="昵称（可选）"
            error={form.formState.errors.display_name?.message}
            htmlFor="reg-name"
          >
            <Input
              id="reg-name"
              type="text"
              maxLength={100}
              placeholder="怎么称呼你？"
              {...form.register('display_name')}
            />
          </FormField>

          {serverError && (
            <p role="alert" className="text-sm text-destructive">
              {serverError}
            </p>
          )}

          <TurnstileWidget
            ref={turnstileRef}
            onToken={setTurnstileToken}
            onExpire={() => setTurnstileToken(null)}
            onError={(msg) => setServerError(msg)}
          />

          <Button type="submit" disabled={submitting || (turnstileRequired && !turnstileToken)}>
            {submitting ? (
              <>
                <Spinner aria-hidden="true" />
                注册中…
              </>
            ) : (
              '创建账号'
            )}
          </Button>

          <FieldSeparator>已有账号？</FieldSeparator>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              window.location.href = loginPath;
            }}
          >
            登录
          </Button>
        </form>
      </AuthShell>
    </>
  );
}
