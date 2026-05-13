'use client';

import * as React from 'react';
import useSWR from 'swr';
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
      setMessage('System settings saved.');
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
      <div className="space-y-6 p-6">
        <div className="space-y-2">
          <div className="h-8 w-56 animate-pulse rounded bg-muted" />
          <div className="h-4 w-96 animate-pulse rounded bg-muted" />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-56 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">System Settings</h1>
          <p className="text-sm text-muted-foreground">
            Platform defaults for identity, security, email, and notifications.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="mr-2 h-4 w-4" />
          Save
        </Button>
      </div>

      {error ? (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle>Settings data unavailable</CardTitle>
            <CardDescription>
              The admin settings API did not return a valid payload.
            </CardDescription>
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
              <CardTitle>General</CardTitle>
              <Badge variant="outline">Config Source</Badge>
            </div>
            <CardDescription>
              Platform identity and locale defaults. Runtime consumers should read these values
              explicitly.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Site Name">
              <Input
                value={form.general.siteName}
                onChange={(event) => updateSection('general', { siteName: event.target.value })}
              />
            </Field>
            <Field label="Support Email">
              <Input
                type="email"
                value={form.general.supportEmail}
                onChange={(event) => updateSection('general', { supportEmail: event.target.value })}
              />
            </Field>
            <Field label="Default Locale">
              <Select
                value={form.general.defaultLocale}
                onValueChange={(value) =>
                  updateSection('general', { defaultLocale: value as 'en' | 'zh' })
                }
              >
                <SelectTrigger aria-label="Default Locale">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="zh">Chinese</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Timezone">
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
              <CardTitle>Security</CardTitle>
              <Badge variant="secondary">Static Auth Runtime</Badge>
            </div>
            <CardDescription>
              Baseline policy values stored for platform configuration. Better Auth session and
              password enforcement still use server startup configuration.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <ToggleField
              label="Email Verification"
              checked={form.security.requireEmailVerification}
              onCheckedChange={(checked) =>
                updateSection('security', { requireEmailVerification: checked })
              }
            />
            <Field label="Session Max Age">
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
            <Field label="Password Min Length">
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
              <CardTitle>Email</CardTitle>
              <Badge variant="secondary">Provider Pending</Badge>
            </div>
            <CardDescription>
              Transactional email defaults. Password reset delivery currently follows
              AUTH_PASSWORD_RESET_DELIVERY until a real email provider is wired.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Provider">
              <Select
                value={form.email.provider}
                onValueChange={(value) =>
                  updateSection('email', { provider: value as 'log' | 'smtp' | 'resend' })
                }
              >
                <SelectTrigger aria-label="Provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="log">Log</SelectItem>
                  <SelectItem value="smtp">SMTP</SelectItem>
                  <SelectItem value="resend">Resend</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Password Reset Delivery">
              <Select
                value={form.email.passwordResetDelivery}
                onValueChange={(value) =>
                  updateSection('email', { passwordResetDelivery: value as 'log' | 'email' })
                }
              >
                <SelectTrigger aria-label="Password Reset Delivery">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="log">Log</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="From Email">
              <Input
                type="email"
                value={form.email.fromEmail}
                onChange={(event) => updateSection('email', { fromEmail: event.target.value })}
              />
            </Field>
            <Field label="From Name">
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
              <CardTitle>Notifications</CardTitle>
              <Badge>Runtime Active</Badge>
            </div>
            <CardDescription>
              Platform delivery defaults read by notification preferences and notification creation.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <ToggleField
              label="In-App"
              checked={form.notifications.inAppEnabled}
              onCheckedChange={(checked) =>
                updateSection('notifications', { inAppEnabled: checked })
              }
            />
            <ToggleField
              label="Email"
              checked={form.notifications.emailEnabled}
              onCheckedChange={(checked) =>
                updateSection('notifications', { emailEnabled: checked })
              }
            />
            <ToggleField
              label="Webhook"
              checked={form.notifications.webhookEnabled}
              onCheckedChange={(checked) =>
                updateSection('notifications', { webhookEnabled: checked })
              }
            />
            <Field label="Digest Frequency">
              <Select
                value={form.notifications.digestFrequency}
                onValueChange={(value) =>
                  updateSection('notifications', {
                    digestFrequency: value as 'never' | 'daily' | 'weekly',
                  })
                }
              >
                <SelectTrigger aria-label="Digest Frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">Never</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>
      </div>
    </div>
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
