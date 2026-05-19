'use client';

import * as React from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { Save, Settings2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { apiFetch } from '@/lib/shared/auth-client';
import type { SystemSettingsPayload } from '@/lib/validations/system-settings';
import { DashboardPageHeader, DashboardPageShell } from '@/components/dashboard/page-shell';

interface SystemSettingsResponse {
  success?: boolean;
  data?: SystemSettingsPayload;
  error?: unknown;
}

async function fetchSystemSettings(url: string): Promise<SystemSettingsPayload> {
  const response = await apiFetch(url);
  const body = (await response.json().catch(() => null)) as SystemSettingsResponse | null;

  if (!response.ok || body?.success !== true || !body.data) {
    throw new Error('Failed to load system settings');
  }

  return body.data;
}

export default function AdminSettingsPage() {
  const t = useTranslations('dashboard.systemSettingsPage');
  const { data, error, isLoading, mutate } = useSWR('/api/admin/settings', fetchSystemSettings, {
    revalidateOnFocus: false,
  });
  const [form, setForm] = React.useState<SystemSettingsPayload | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (data) {
      setForm(data);
    }
  }, [data]);

  const updateSection = <TSection extends keyof SystemSettingsPayload>(
    section: TSection,
    patch: Partial<SystemSettingsPayload[TSection]>
  ) => {
    setForm((current) =>
      current
        ? {
            ...current,
            [section]: {
              ...current[section],
              ...patch,
            },
          }
        : current
    );
  };

  const handleSave = async () => {
    if (!form) return;

    setSaving(true);
    setMessage(null);
    setSaveError(null);

    try {
      const response = await apiFetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = (await response.json().catch(() => null)) as SystemSettingsResponse | null;

      if (!response.ok || body?.success !== true || !body.data) {
        throw new Error('Failed to save system settings');
      }

      setForm(body.data);
      await mutate(body.data, { revalidate: false });
      setMessage(t('messages.saved'));
    } catch (saveFailure) {
      setSaveError(
        saveFailure instanceof Error ? saveFailure.message : 'Failed to save system settings'
      );
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !form) {
    return (
      <DashboardPageShell>
        <div className="space-y-2">
          <div className="h-8 w-56 animate-pulse rounded bg-muted" />
          <div className="h-4 w-96 animate-pulse rounded bg-muted" />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-56 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </DashboardPageShell>
    );
  }

  return (
    <DashboardPageShell>
      <DashboardPageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button onClick={handleSave} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {t('actions.save')}
          </Button>
        }
      />

      {error ? (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle>{t('error.title')}</CardTitle>
            <CardDescription>{t('error.description')}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {message ? <p className="text-sm text-success">{message}</p> : null}
      {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-muted-foreground" />
              <CardTitle>{t('sections.general.title')}</CardTitle>
              <Badge variant="outline">{t('sections.general.badge')}</Badge>
            </div>
            <CardDescription>{t('sections.general.description')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label={t('fields.siteName')}>
              <Input
                value={form.general.siteName}
                onChange={(event) => updateSection('general', { siteName: event.target.value })}
              />
            </Field>
            <Field label={t('fields.supportEmail')}>
              <Input
                type="email"
                value={form.general.supportEmail}
                onChange={(event) => updateSection('general', { supportEmail: event.target.value })}
              />
            </Field>
            <Field label={t('fields.defaultLocale')}>
              <Select
                value={form.general.defaultLocale}
                onValueChange={(value) =>
                  updateSection('general', { defaultLocale: value as 'en' | 'zh' })
                }
              >
                <SelectTrigger aria-label={t('fields.defaultLocale')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">{t('options.english')}</SelectItem>
                  <SelectItem value="zh">{t('options.chinese')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('fields.timezone')}>
              <Input
                value={form.general.timezone}
                onChange={(event) => updateSection('general', { timezone: event.target.value })}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>{t('sections.security.title')}</CardTitle>
              <Badge variant="secondary">{t('sections.security.badge')}</Badge>
            </div>
            <CardDescription>{t('sections.security.description')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <ToggleField
              label={t('fields.emailVerification')}
              checked={form.security.requireEmailVerification}
              onCheckedChange={(checked) =>
                updateSection('security', { requireEmailVerification: checked })
              }
            />
            <Field label={t('fields.sessionMaxAge')}>
              <Input
                type="number"
                min={1}
                max={365}
                value={form.security.sessionMaxAgeDays}
                onChange={(event) =>
                  updateSection('security', {
                    sessionMaxAgeDays: Number(event.target.value),
                  })
                }
              />
            </Field>
            <Field label={t('fields.passwordMinLength')}>
              <Input
                type="number"
                min={8}
                max={128}
                value={form.security.passwordMinLength}
                onChange={(event) =>
                  updateSection('security', {
                    passwordMinLength: Number(event.target.value),
                  })
                }
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>{t('sections.email.title')}</CardTitle>
              <Badge variant="secondary">{t('sections.email.badge')}</Badge>
            </div>
            <CardDescription>{t('sections.email.description')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label={t('fields.provider')}>
              <Select
                value={form.email.provider}
                onValueChange={(value) =>
                  updateSection('email', { provider: value as 'log' | 'smtp' | 'resend' })
                }
              >
                <SelectTrigger aria-label={t('fields.provider')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="log">{t('options.log')}</SelectItem>
                  <SelectItem value="smtp">{t('options.smtp')}</SelectItem>
                  <SelectItem value="resend">{t('options.resend')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('fields.passwordResetDelivery')}>
              <Select
                value={form.email.passwordResetDelivery}
                onValueChange={(value) =>
                  updateSection('email', { passwordResetDelivery: value as 'log' | 'email' })
                }
              >
                <SelectTrigger aria-label={t('fields.passwordResetDelivery')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="log">{t('options.log')}</SelectItem>
                  <SelectItem value="email">{t('options.email')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('fields.fromEmail')}>
              <Input
                type="email"
                value={form.email.fromEmail}
                onChange={(event) => updateSection('email', { fromEmail: event.target.value })}
              />
            </Field>
            <Field label={t('fields.fromName')}>
              <Input
                value={form.email.fromName}
                onChange={(event) => updateSection('email', { fromName: event.target.value })}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>{t('sections.notifications.title')}</CardTitle>
              <Badge>{t('sections.notifications.badge')}</Badge>
            </div>
            <CardDescription>{t('sections.notifications.description')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <ToggleField
              label={t('fields.inApp')}
              checked={form.notifications.inAppEnabled}
              onCheckedChange={(checked) =>
                updateSection('notifications', { inAppEnabled: checked })
              }
            />
            <ToggleField
              label={t('fields.email')}
              checked={form.notifications.emailEnabled}
              onCheckedChange={(checked) =>
                updateSection('notifications', { emailEnabled: checked })
              }
            />
            <ToggleField
              label={t('fields.webhook')}
              checked={form.notifications.webhookEnabled}
              onCheckedChange={(checked) =>
                updateSection('notifications', { webhookEnabled: checked })
              }
            />
            <Field label={t('fields.digestFrequency')}>
              <Select
                value={form.notifications.digestFrequency}
                onValueChange={(value) =>
                  updateSection('notifications', {
                    digestFrequency: value as 'never' | 'daily' | 'weekly',
                  })
                }
              >
                <SelectTrigger aria-label={t('fields.digestFrequency')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">{t('options.never')}</SelectItem>
                  <SelectItem value="daily">{t('options.daily')}</SelectItem>
                  <SelectItem value="weekly">{t('options.weekly')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>
      </div>
    </DashboardPageShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = React.useId();

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id })
        : children}
    </div>
  );
}

function ToggleField({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = React.useId();

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border p-3">
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
