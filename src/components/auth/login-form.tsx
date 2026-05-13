/**
 * Login form component
 *
 * Uses Better Auth signIn method for email/password login.
 * Supports form validation, loading state, error messages.
 */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/contexts/language-context';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle } from 'lucide-react';

interface SignInResponse {
  redirect?: boolean;
  url?: string;
  user?: {
    email?: string;
  };
  code?: string;
  message?: string;
}

export function LoginForm() {
  const _router = useRouter();
  const searchParams = useSearchParams();
  const { getLangPath } = useLanguage();
  const t = useTranslations('auth.login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    submitButtonRef.current?.setAttribute('data-auth-ready', 'true');
  }, []);

  const callbackUrl = useMemo(() => {
    const raw = searchParams.get('callbackUrl');

    if (!raw) {
      return getLangPath('/');
    }

    // Only allow same-origin relative paths.
    if (!raw.startsWith('/') || raw.startsWith('//')) {
      return getLangPath('/');
    }

    return raw;
  }, [searchParams, getLangPath]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '').trim();

    try {
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          callbackURL: callbackUrl,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as SignInResponse;

      if (!response.ok) {
        setError(result.message || t('errors.loginFailed'));
        setLoading(false);
        return;
      }

      // Use hard refresh to ensure target page fully reloads and refreshes login status
      window.location.href = callbackUrl;
      // Note: Page will redirect immediately, subsequent code will not execute
    } catch (error) {
      setError(error instanceof Error ? error.message : t('errors.loginFailed'));
      setLoading(false); // Reset loading state on error
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>

      <form method="post" onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">{t('fields.email.label')}</Label>
            <Input
              id="email"
              name="email"
              data-testid="login-email"
              type="email"
              placeholder={t('fields.email.placeholder')}
              required
              autoComplete="email"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t('fields.password.label')}</Label>
              <Link
                href={getLangPath('/forgot-password')}
                className="text-sm text-primary hover:underline"
              >
                {t('forgotPassword')}
              </Link>
            </div>
            <Input
              id="password"
              name="password"
              data-testid="login-password"
              type="password"
              placeholder={t('fields.password.placeholder')}
              required
              autoComplete="current-password"
              disabled={loading}
              minLength={8}
            />
          </div>
        </CardContent>

        <CardFooter className="flex flex-col space-y-4">
          <Button
            ref={submitButtonRef}
            type="button"
            className="w-full"
            data-auth-ready="false"
            disabled={loading || undefined}
            onClick={(event) => event.currentTarget.form?.requestSubmit()}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loading ? t('submitting') : t('submit')}
          </Button>

          <p className="text-sm text-center text-muted-foreground dark:text-muted-foreground">
            {t('noAccount')}{' '}
            <Link
              href={
                getLangPath('/register') +
                (searchParams.get('callbackUrl')
                  ? `?callbackUrl=${encodeURIComponent(searchParams.get('callbackUrl')!)}`
                  : '')
              }
              className="text-primary hover:underline font-medium"
            >
              {t('registerNow')}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
