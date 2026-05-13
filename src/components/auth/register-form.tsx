/**
 * Registration Form Component
 *
 * Uses Better Auth signUp method for email/password registration
 * Supports form validation, loading state, error messages, password strength check
 */

'use client';

import { useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { signUp } from '@/lib/auth/client';
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
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

export function RegisterForm() {
  const _router = useRouter();
  const searchParams = useSearchParams();
  const { getLangPath } = useLanguage();
  const t = useTranslations('auth.register');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
    const name = formData.get('name') as string;
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const confirmPassword = formData.get('confirmPassword') as string;

    // Client validation
    if (password !== confirmPassword) {
      setError(t('errors.passwordMismatch'));
      setLoading(false);
      return;
    }

    if (password.length < 8) {
      setError(t('errors.passwordTooShort'));
      setLoading(false);
      return;
    }

    try {
      // Use Better Auth for registration
      await signUp.email({
        email,
        password,
        name,
        callbackURL: callbackUrl, // Redirect after successful registration
      });

      setSuccess(true);

      // After successful registration, redirect to specified page or home
      setTimeout(() => {
        // Use hard refresh to ensure target page fully reloads and refreshes login status
        window.location.href = callbackUrl;
      }, 1500);
    } catch (error) {
      console.error('Register error:', error);
      setError(error instanceof Error ? error.message : t('errors.registerFailed'));
    } finally {
      setLoading(false);
    }
  }

  // If registration successful, show success message
  if (success) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-success">
            <CheckCircle2 className="h-5 w-5" />
            {t('success.title')}
          </CardTitle>
          <CardDescription>{t('success.description')}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">{t('fields.name.label')}</Label>
            <Input
              id="name"
              name="name"
              type="text"
              placeholder={t('fields.name.placeholder')}
              required
              autoComplete="name"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">{t('fields.email.label')}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder={t('fields.email.placeholder')}
              required
              autoComplete="email"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">{t('fields.password.label')}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder={t('fields.password.placeholder')}
              required
              autoComplete="new-password"
              disabled={loading}
              minLength={8}
            />
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">
              {t('fields.password.hint')}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">{t('fields.confirmPassword.label')}</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              placeholder={t('fields.confirmPassword.placeholder')}
              required
              autoComplete="new-password"
              disabled={loading}
              minLength={8}
            />
          </div>
        </CardContent>

        <CardFooter className="flex flex-col space-y-4">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loading ? t('submitting') : t('submit')}
          </Button>

          <p className="text-sm text-center text-muted-foreground dark:text-muted-foreground">
            {t('hasAccount')}{' '}
            <Link href={getLangPath('/login')} className="text-primary hover:underline font-medium">
              {t('loginNow')}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
