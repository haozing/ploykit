/**
 * Forgot Password Form Component
 *
 * Uses Better Auth forgetPassword method to send password reset email
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { forgetPassword } from '@/lib/auth/client';
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
import { Loader2, AlertCircle, CheckCircle2, ArrowLeft } from 'lucide-react';

export function ForgotPasswordForm() {
  const { getLangPath } = useLanguage();
  const t = useTranslations('auth.forgotPassword');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;

    try {
      await forgetPassword({
        email,
        redirectTo: getLangPath('/reset-password'),
      });

      setSuccess(true);
    } catch (error) {
      console.error('Forgot password error:', error);
      setError(error instanceof Error ? error.message : t('errors.sendFailed'));
    } finally {
      setLoading(false);
    }
  }

  // If email sent successfully, show success message
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
            <Button variant="outline" className="w-full">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('backToLogin')}
            </Button>
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
              type="email"
              placeholder={t('fields.email.placeholder')}
              required
              autoComplete="email"
              disabled={loading}
            />
          </div>
        </CardContent>

        <CardFooter className="flex flex-col space-y-4">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loading ? t('submitting') : t('submit')}
          </Button>

          <Link href={getLangPath('/login')} className="w-full">
            <Button variant="ghost" className="w-full">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('backToLogin')}
            </Button>
          </Link>
        </CardFooter>
      </form>
    </Card>
  );
}
