import Link from 'next/link';
import { AuthShell } from '@host/components/ProductShell';
import { FormField, Input } from '@host/components/ui';
import { cn } from '@host/components/ui/cn';
import { readHostMessageValue } from '@host/lib/host-i18n';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';

interface AuthPageCopy {
  modes: Record<AuthPageMode, [string, string, string]>;
  email: string;
  emailPlaceholder: string;
  displayName: string;
  displayNamePlaceholder: string;
  resetToken: string;
  resetTokenPlaceholder: string;
  password: string;
  passwordPlaceholder: string;
  error: string;
  login: string;
  register: string;
  forgotPassword: string;
}

type AuthPageMode = 'login' | 'register' | 'forgot-password' | 'reset-password';

export function AuthPage({
  lang,
  mode,
  nextPath,
  error,
  notice,
  token,
}: {
  lang: SupportedLanguage;
  mode: AuthPageMode;
  nextPath?: string;
  error?: string;
  notice?: string;
  token?: string;
}) {
  const allCopy = readHostMessageValue<AuthPageCopy>(lang, 'auth.page');
  const copy = allCopy.modes[mode];
  const action = {
    login: '/api/auth/login',
    register: '/api/auth/register',
    'forgot-password': '/api/auth/password-reset/request',
    'reset-password': '/api/auth/password-reset/confirm',
  }[mode];
  const links = [
    { href: '/login', label: allCopy.login, active: mode === 'login' },
    { href: '/register', label: allCopy.register, active: mode === 'register' },
    {
      href: '/forgot-password',
      label: allCopy.forgotPassword,
      active: mode === 'forgot-password' || mode === 'reset-password',
    },
  ];

  return (
    <AuthShell lang={lang} title={copy[0]} subtitle={copy[1]}>
      <form className="grid gap-4" action={action} method="post">
        <input type="hidden" name="next" value={nextPath ?? localizedPath(lang, '/dashboard')} />
        {mode !== 'reset-password' ? (
          <FormField
            label={allCopy.email}
            name="email"
            type="email"
            placeholder={allCopy.emailPlaceholder}
          />
        ) : null}
        {mode === 'register' ? (
          <FormField
            label={allCopy.displayName}
            name="displayName"
            placeholder={allCopy.displayNamePlaceholder}
          />
        ) : null}
        {mode === 'reset-password' ? (
          <label className="grid gap-2 text-sm font-medium text-admin-text">
            <span>{allCopy.resetToken}</span>
            <Input
              name="token"
              defaultValue={token ?? ''}
              placeholder={allCopy.resetTokenPlaceholder}
            />
          </label>
        ) : null}
        {mode !== 'forgot-password' ? (
          <FormField
            label={allCopy.password}
            name="password"
            type="password"
            placeholder={allCopy.passwordPlaceholder}
          />
        ) : null}
        {error ? (
          <p className="rounded-admin-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-6 text-red-700">
            {allCopy.error}
          </p>
        ) : null}
        {notice ? (
          <p className="rounded-admin-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm leading-6 text-emerald-700">
            {notice}
          </p>
        ) : null}
        <button
          type="submit"
          className="inline-flex h-11 w-full items-center justify-center rounded-admin-md border border-admin-primary bg-admin-primary px-4 text-sm font-semibold !text-white shadow-[0_12px_28px_rgba(37,99,235,0.18)] transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50 dark:!text-white dark:hover:bg-blue-400"
        >
          {copy[2]}
        </button>
      </form>
      <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {links.map((item) => (
          <Link
            key={item.href}
            href={localizedPath(lang, item.href)}
            aria-current={item.active ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-10 items-center justify-center rounded-admin-md border px-3 text-center text-sm font-semibold transition-colors',
              item.active
                ? 'border-admin-primary/20 bg-admin-primary-soft text-admin-primary'
                : 'border-admin-border bg-admin-surface/85 text-admin-text-muted hover:border-admin-primary/20 hover:bg-admin-surface-muted hover:text-admin-text'
            )}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </AuthShell>
  );
}
