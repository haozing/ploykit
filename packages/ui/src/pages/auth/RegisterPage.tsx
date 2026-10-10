
import { useState } from 'react';
import { z } from 'zod';
import { AuthShell } from '../../layouts/AuthShell';
import { FormField } from '../../components/FormField';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { FieldDescription, FieldSeparator } from '../../components/ui/field';
import { useApi } from '@ploykit/hooks';
import { useAuth } from '@ploykit/hooks';
import { useSiteConfig } from '@ploykit/hooks';
import { useZodForm } from '@ploykit/hooks';
import { apiErrorMessage } from '../../lib/api-error';
import { toast } from '../../components/toast';
import type { PKUser } from '@ploykit/hooks';


function passwordKinds(pw: string): number {
  let kinds = 0;
  if (/[0-9]/.test(pw)) kinds++;
  if (/[a-z]/.test(pw)) kinds++;
  if (/[A-Z]/.test(pw)) kinds++;
  if (/[^0-9a-zA-Z]/.test(pw)) kinds++;
  return kinds;
}


export const passwordSchema = z
  .string()
  .min(10, '密码至少 10 位')
  .refine(
    (pw) => new TextEncoder().encode(pw).length <= 128,
    '密码过长（按字节计最多 128，一个汉字占 3 字节）',
  )
  .refine(
    (pw) => passwordKinds(pw) >= 3,
    '需包含大写/小写/数字/符号中的至少三类',
  );

export const registerSchema = z.object({
  
  email: z.string().min(1, '请输入邮箱').max(254, '邮箱过长').email('邮箱格式不正确'),
  password: passwordSchema,
  
  display_name: z.string().max(100, '昵称最多 100 字符').optional(),
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
  description = '填写以下信息开始使用',
}: RegisterPageProps) {
  const api = useApi();
  const { refresh } = useAuth();
  
  
  
  const { data: siteCfg } = useSiteConfig();
  const inviteOnly = siteCfg?.allow_signup === '0';
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
      await api.post<{ user: PKUser; expires_at: string }>(
        '/auth/register',
        body,
      )
      await refresh();
      toast.success('注册成功');
      if (onSuccess) onSuccess();
      else window.location.href = '/app';
    } catch (e) {
      
      
      const msg = apiErrorMessage(e, '注册失败，请稍后重试');
      setServerError(msg);
      toast.error(msg);
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
            <p className="text-sm text-balance text-muted-foreground">
              {description}
            </p>
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
            <Input
              id="reg-password"
              type="password"
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

          <Button type="submit" disabled={submitting}>
            {submitting ? '注册中…' : '创建账号'}
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
