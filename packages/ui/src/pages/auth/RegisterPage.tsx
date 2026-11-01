
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
import { useT, t as tt } from '../../i18n';
import type { PKUser } from '@ploykit/hooks';

// 密码强度规则住在 lib/password-schema：它同时被重置密码页与设置区的
// 改密页复用，留在本文件会把整个注册页组件连带拖进设置区的 chunk。
export { passwordSchema };

// 校验文案经 error map 惰性取字典（i18n B 方案）：解析时才调 t；纯函数测试
// （无 Provider）拿 en 默认。password 字段的强度文案来自 lib/password-schema
// （共享 lib，不在 g7 分片，保持原样）。
export const registerSchema = z.object({

  email: z.string().check(
    z.minLength(1, { error: () => tt('auth.register.emailRequired') }),
    z.maxLength(254, { error: () => tt('auth.register.emailTooLong') }),
    z.email({ error: () => tt('auth.register.emailInvalid') }),
  ),
  password: passwordSchema,

  display_name: z.optional(z.string().check(z.maxLength(100, { error: () => tt('auth.register.nameTooLong') }))),
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
  title,
  description,
}: RegisterPageProps) {
  const { refresh } = useAuth();
  const t = useT(); // i18n（B 方案）：默认标题走字典，title prop 优先
  const pageTitle = title ?? t('auth.register.title');

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
      toast.success(t('auth.register.successToast'));
      if (onSuccess) onSuccess();
      else window.location.href = '/app';
    } catch (e) {
      const msg = apiErrorMessage(e, t('auth.register.failed'));
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
          {t('auth.register.inviteOnly')}
        </div>
      )}
      <AuthShell footer={<span>{t('auth.register.legalNote')}</span>}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="flex flex-col items-center gap-1 text-center">
            <h1 className="text-2xl font-bold">{pageTitle}</h1>
            {description && (
              <p className="text-sm text-balance text-muted-foreground">
                {description}
              </p>
            )}
          </div>

          <FormField
            label={t('auth.register.emailLabel')}
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
            label={t('auth.register.passwordLabel')}
            error={form.formState.errors.password?.message}
            htmlFor="reg-password"
          >
            <PasswordField
              id="reg-password"
              placeholder={t('auth.register.passwordPlaceholder')}
              autoComplete="new-password"
              {...form.register('password')}
            />
            {pw.length > 0 && (
              <FieldDescription>
                {t('auth.register.kinds', {
                  upper: /[A-Z]/.test(pw) ? '✓' : '—',
                  lower: /[a-z]/.test(pw) ? '✓' : '—',
                  digit: /[0-9]/.test(pw) ? '✓' : '—',
                  symbol: /[^0-9a-zA-Z]/.test(pw) ? '✓' : '—',
                  kinds,
                })}
              </FieldDescription>
            )}
          </FormField>

          <FormField
            label={t('auth.register.nameLabel')}
            error={form.formState.errors.display_name?.message}
            htmlFor="reg-name"
          >
            <Input
              id="reg-name"
              type="text"
              maxLength={100}
              placeholder={t('auth.register.namePlaceholder')}
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
                {t('auth.register.submitting')}
              </>
            ) : (
              t('auth.register.submit')
            )}
          </Button>

          <FieldSeparator>{t('auth.register.hasAccount')}</FieldSeparator>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              window.location.href = loginPath;
            }}
          >
            {t('auth.register.signIn')}
          </Button>
        </form>
      </AuthShell>
    </>
  );
}
