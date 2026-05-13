/**
 * Reset Password Form Component
 *
 * Completes the Better Auth password reset flow after the user opens a reset link.
 */

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { resetPassword } from '@/lib/auth/client';
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
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const { getLangPath } = useLanguage();
  const t = useTranslations('auth.resetPassword');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const token = useMemo(() => searchParams.get('token') || '', [searchParams]);
  const callbackError = searchParams.get('error');
  const hasValidLink = Boolean(token) && callbackError !== 'INVALID_TOKEN';

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!hasValidLink) {
      setError(t('errors.invalidToken'));
      return;
    }

    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const newPassword = String(formData.get('newPassword') || '');
    const confirmPassword = String(formData.get('confirmPassword') || '');

    if (newPassword !== confirmPassword) {
      setError(t('errors.passwordMismatch'));
      setLoading(false);
      return;
    }

    if (newPassword.length < 8) {
      setError(t('errors.passwordTooShort'));
      setLoading(false);
      return;
    }

    try {
      await resetPassword({
        newPassword,
        token,
      });

      setSuccess(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : t('errors.resetFailed'));
    } finally {
      setLoading(false);
    }
  }

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
        <CardFooter>
          <Link href={getLangPath('/login')} className="w-full">
            <Button className="w-full">{t('backToLogin')}</Button>
          </Link>
        </CardFooter>
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
          {!hasValidLink && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{t('errors.invalidToken')}</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="newPassword">{t('fields.newPassword.label')}</Label>
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              placeholder={t('fields.newPassword.placeholder')}
              required
              autoComplete="new-password"
              disabled={loading || !hasValidLink}
              minLength={8}
            />
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
              disabled={loading || !hasValidLink}
              minLength={8}
            />
          </div>
        </CardContent>

        <CardFooter className="flex flex-col space-y-4">
          <Button type="submit" className="w-full" disabled={loading || !hasValidLink}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loading ? t('submitting') : t('submit')}
          </Button>

          <Link href={getLangPath('/forgot-password')} className="w-full">
            <Button type="button" variant="ghost" className="w-full">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('requestNewLink')}
            </Button>
          </Link>
        </CardFooter>
      </form>
    </Card>
  );
}
