'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useTranslations } from 'next-intl';
import { Bell, Mail, Webhook, CheckCircle2, AlertCircle, Loader2, Send } from 'lucide-react';
import { apiFetch } from '@/lib/shared/auth-client';
import { DashboardPageHeader, DashboardPageShell } from '@/components/dashboard/page-shell';

interface NotificationPreferences {
  id: string;
  emailEnabled: boolean;
  emailAddress: string;
  webhookEnabled: boolean;
  webhookUrl: string | null;
  webhookSecret: string | null;
  inAppEnabled: boolean;
  notifyOnUsageWarning: boolean;
  notifyOnUsageCritical: boolean;
  notifyOnUsageExceeded: boolean;
  notifyOnTrialEvents: boolean;
  notifyOnSubscriptionEvents: boolean;
  notifyOnPaymentEvents: boolean;
  dailyDigestEnabled: boolean;
  weeklyReportEnabled: boolean;
}

export function NotificationPreferencesForm() {
  const t = useTranslations('dashboard.settings.notifications');
  const [preferences, setPreferences] = React.useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [testingSend, setTestingSend] = React.useState(false);
  const [saveMessage, setSaveMessage] = React.useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [testMessage, setTestMessage] = React.useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  React.useEffect(() => {
    void fetchPreferences();
  }, []);

  const fetchPreferences = async () => {
    try {
      setLoading(true);
      const response = await apiFetch('/api/notifications/preferences');
      const data = await response.json();

      if (data.success) {
        setPreferences(data.preferences);
      }
    } catch (error) {
      console.error('Error fetching preferences:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!preferences) return;

    try {
      setSaving(true);
      setSaveMessage(null);

      const response = await apiFetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      });

      const data = await response.json();

      if (data.success) {
        setPreferences(data.preferences);
        setSaveMessage({ type: 'success', text: t('success.saved') });
      } else {
        setSaveMessage({ type: 'error', text: data.error || t('errors.saveFailed') });
      }
    } catch (error) {
      console.error('Error saving preferences:', error);
      setSaveMessage({ type: 'error', text: t('errors.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const handleSendTestNotification = async () => {
    try {
      setTestingSend(true);
      setTestMessage(null);

      const response = await apiFetch('/api/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'usage_warning',
          data: {
            metric: 'testMetric',
            metricLabel: 'Test Metric',
            percentage: 85,
            currentValue: 850,
            limit: 1000,
            unit: 'units',
          },
        }),
      });

      const data = await response.json();

      if (data.success) {
        setTestMessage({ type: 'success', text: t('test.sent') });
      } else {
        setTestMessage({ type: 'error', text: data.error || t('test.failed') });
      }
    } catch (error) {
      console.error('Error sending test notification:', error);
      setTestMessage({ type: 'error', text: t('test.failed') });
    } finally {
      setTestingSend(false);
    }
  };

  const updatePreference = <K extends keyof NotificationPreferences>(
    key: K,
    value: NotificationPreferences[K]
  ) => {
    if (!preferences) return;
    setPreferences({ ...preferences, [key]: value });
  };

  if (loading) {
    return (
      <DashboardPageShell className="flex min-h-[240px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </DashboardPageShell>
    );
  }

  if (!preferences) {
    return (
      <DashboardPageShell>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{t('errors.loadFailed')}</AlertDescription>
        </Alert>
      </DashboardPageShell>
    );
  }

  return (
    <DashboardPageShell>
      {/* Header */}
      <DashboardPageHeader title={t('title')} description={t('description')} />

      {/* Save Message */}
      {saveMessage && (
        <Alert variant={saveMessage.type === 'error' ? 'destructive' : 'default'}>
          {saveMessage.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <AlertDescription>{saveMessage.text}</AlertDescription>
        </Alert>
      )}

      {/* Email Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            <CardTitle>{t('email.title')}</CardTitle>
          </div>
          <CardDescription>{t('email.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="email-enabled" className="text-base">
                {t('email.enable')}
              </Label>
              <p className="text-sm text-muted-foreground">{t('email.description')}</p>
            </div>
            <Switch
              id="email-enabled"
              checked={preferences.emailEnabled}
              onCheckedChange={(checked) => updatePreference('emailEnabled', checked)}
            />
          </div>

          {preferences.emailEnabled && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label htmlFor="email-address">{t('email.address')}</Label>
                <Input
                  id="email-address"
                  type="email"
                  placeholder={t('email.addressPlaceholder')}
                  value={preferences.emailAddress}
                  onChange={(e) => updatePreference('emailAddress', e.target.value)}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Webhook Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Webhook className="h-5 w-5" />
            <CardTitle>{t('webhook.title')}</CardTitle>
          </div>
          <CardDescription>{t('webhook.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="webhook-enabled" className="text-base">
                {t('webhook.enable')}
              </Label>
              <p className="text-sm text-muted-foreground">{t('webhook.description')}</p>
            </div>
            <Switch
              id="webhook-enabled"
              checked={preferences.webhookEnabled}
              onCheckedChange={(checked) => updatePreference('webhookEnabled', checked)}
            />
          </div>

          {preferences.webhookEnabled && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label htmlFor="webhook-url">{t('webhook.url')}</Label>
                <Input
                  id="webhook-url"
                  type="url"
                  placeholder={t('webhook.urlPlaceholder')}
                  value={preferences.webhookUrl || ''}
                  onChange={(e) => updatePreference('webhookUrl', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="webhook-secret">{t('webhook.secret')}</Label>
                <Input
                  id="webhook-secret"
                  type="password"
                  placeholder={t('webhook.secretPlaceholder')}
                  value={preferences.webhookSecret || ''}
                  onChange={(e) => updatePreference('webhookSecret', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t('webhook.secretHelp')}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* In-App Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            <CardTitle>{t('inApp.title')}</CardTitle>
          </div>
          <CardDescription>{t('inApp.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="in-app-enabled" className="text-base">
                {t('inApp.enable')}
              </Label>
              <p className="text-sm text-muted-foreground">{t('inApp.description')}</p>
            </div>
            <Switch
              id="in-app-enabled"
              checked={preferences.inAppEnabled}
              onCheckedChange={(checked) => updatePreference('inAppEnabled', checked)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Notification Types */}
      <Card>
        <CardHeader>
          <CardTitle>{t('types.title')}</CardTitle>
          <CardDescription>{t('types.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Usage Alerts */}
          <div>
            <h3 className="font-medium mb-3">{t('types.usage.title')}</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="usage-warning" className="text-base">
                    {t('types.usage.warning')}
                  </Label>
                  <p className="text-sm text-muted-foreground">{t('types.usage.warningDesc')}</p>
                </div>
                <Switch
                  id="usage-warning"
                  checked={preferences.notifyOnUsageWarning}
                  onCheckedChange={(checked) => updatePreference('notifyOnUsageWarning', checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="usage-critical" className="text-base">
                    {t('types.usage.critical')}
                  </Label>
                  <p className="text-sm text-muted-foreground">{t('types.usage.criticalDesc')}</p>
                </div>
                <Switch
                  id="usage-critical"
                  checked={preferences.notifyOnUsageCritical}
                  onCheckedChange={(checked) => updatePreference('notifyOnUsageCritical', checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="usage-exceeded" className="text-base">
                    {t('types.usage.exceeded')}
                  </Label>
                  <p className="text-sm text-muted-foreground">{t('types.usage.exceededDesc')}</p>
                </div>
                <Switch
                  id="usage-exceeded"
                  checked={preferences.notifyOnUsageExceeded}
                  onCheckedChange={(checked) => updatePreference('notifyOnUsageExceeded', checked)}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Trial Events */}
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="trial-events" className="text-base">
                {t('types.trial.title')}
              </Label>
              <p className="text-sm text-muted-foreground">{t('types.trial.description')}</p>
            </div>
            <Switch
              id="trial-events"
              checked={preferences.notifyOnTrialEvents}
              onCheckedChange={(checked) => updatePreference('notifyOnTrialEvents', checked)}
            />
          </div>

          <Separator />

          {/* Subscription Events */}
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="subscription-events" className="text-base">
                {t('types.subscription.title')}
              </Label>
              <p className="text-sm text-muted-foreground">{t('types.subscription.description')}</p>
            </div>
            <Switch
              id="subscription-events"
              checked={preferences.notifyOnSubscriptionEvents}
              onCheckedChange={(checked) => updatePreference('notifyOnSubscriptionEvents', checked)}
            />
          </div>

          <Separator />

          {/* Payment Events */}
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="payment-events" className="text-base">
                {t('types.payment.title')}
              </Label>
              <p className="text-sm text-muted-foreground">{t('types.payment.description')}</p>
            </div>
            <Switch
              id="payment-events"
              checked={preferences.notifyOnPaymentEvents}
              onCheckedChange={(checked) => updatePreference('notifyOnPaymentEvents', checked)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Frequency Settings */}
      <Card>
        <CardHeader>
          <CardTitle>{t('reports.title')}</CardTitle>
          <CardDescription>{t('reports.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="daily-digest" className="text-base">
                {t('reports.daily')}
              </Label>
              <p className="text-sm text-muted-foreground">{t('reports.dailyDesc')}</p>
            </div>
            <Switch
              id="daily-digest"
              checked={preferences.dailyDigestEnabled}
              onCheckedChange={(checked) => updatePreference('dailyDigestEnabled', checked)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="weekly-report" className="text-base">
                {t('reports.weekly')}
              </Label>
              <p className="text-sm text-muted-foreground">{t('reports.weeklyDesc')}</p>
            </div>
            <Switch
              id="weekly-report"
              checked={preferences.weeklyReportEnabled}
              onCheckedChange={(checked) => updatePreference('weeklyReportEnabled', checked)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Test Notification */}
      <Card>
        <CardHeader>
          <CardTitle>{t('test.title')}</CardTitle>
          <CardDescription>{t('test.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {testMessage && (
            <Alert variant={testMessage.type === 'error' ? 'destructive' : 'default'}>
              {testMessage.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <AlertDescription>{testMessage.text}</AlertDescription>
            </Alert>
          )}

          <Button onClick={handleSendTestNotification} disabled={testingSend} variant="outline">
            {testingSend ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('test.sending')}
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                {t('test.button')}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-end gap-4">
        <Button variant="outline" onClick={fetchPreferences} disabled={saving}>
          {t('actions.reset')}
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('actions.saving')}
            </>
          ) : (
            t('actions.save')
          )}
        </Button>
      </div>
    </DashboardPageShell>
  );
}
