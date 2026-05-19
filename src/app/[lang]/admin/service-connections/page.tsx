'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiFetch } from '@/lib/shared/auth-client';
import { DashboardPageHeader, DashboardPageShell } from '@/components/dashboard/page-shell';
import type {
  AdminSecretSourceSummary,
  AdminServiceConnectionLogSummary,
  AdminServiceConnectionRequirement,
  AdminServiceConnectionSummary,
} from '@/lib/plugin-runtime/admin';

interface RequirementsResponse {
  requirements?: AdminServiceConnectionRequirement[];
}

interface ConnectionsResponse {
  connections?: AdminServiceConnectionSummary[];
}

interface LogsResponse {
  logs?: AdminServiceConnectionLogSummary[];
}

type SecretDraft = {
  type: 'none' | 'env' | 'encrypted';
  name: string;
  ref: string;
  value: string;
};

type ConnectionDraft = {
  id: string;
  productId: string;
  pluginId: string;
  ownerType: 'plugin' | 'suite' | 'product';
  ownerId: string;
  serviceName: string;
  scopeType: 'global' | 'workspace';
  scopeId: string;
  environment: string;
  baseUrl: string;
  authType: 'none' | 'bearer' | 'basic' | 'apiKey';
  authSecretSource: SecretDraft;
  authUsernameSource: SecretDraft;
  authPasswordSource: SecretDraft;
  authHeaderName: string;
  actorClaimsEnabled: boolean;
  actorClaimsAudience: string;
  actorClaimsSecretSource: SecretDraft;
  actorClaimsKeyId: string;
  actorClaimsTtlSeconds: string;
  timeoutMs: string;
  retryAttempts: string;
  retryBackoffMs: string;
  maxResponseBytes: string;
  healthPath: string;
  healthMethod: string;
  healthExpectedStatus: string;
  status: 'active' | 'disabled';
};

const emptySecret: SecretDraft = { type: 'none', name: '', ref: '', value: '' };

const emptyDraft: ConnectionDraft = {
  id: '',
  productId: '',
  pluginId: '',
  ownerType: 'plugin',
  ownerId: '',
  serviceName: '',
  scopeType: 'global',
  scopeId: '',
  environment: '',
  baseUrl: '',
  authType: 'none',
  authSecretSource: emptySecret,
  authUsernameSource: emptySecret,
  authPasswordSource: emptySecret,
  authHeaderName: '',
  actorClaimsEnabled: false,
  actorClaimsAudience: '',
  actorClaimsSecretSource: emptySecret,
  actorClaimsKeyId: '',
  actorClaimsTtlSeconds: '60',
  timeoutMs: '30000',
  retryAttempts: '0',
  retryBackoffMs: '250',
  maxResponseBytes: '10485760',
  healthPath: '/healthz',
  healthMethod: 'GET',
  healthExpectedStatus: '200',
  status: 'active',
};

function cloneSecret(secret: SecretDraft = emptySecret): SecretDraft {
  return { ...secret };
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'bound' || status === 'active' || status === 'ok') return 'default';
  if (status === 'missing' || status === 'disabled' || status === 'error') return 'destructive';
  return 'secondary';
}

function formatDate(value: string | undefined, locale: string, emptyLabel: string) {
  return value ? new Date(value).toLocaleString(locale) : emptyLabel;
}

function secretDraftFromSummary(source: AdminSecretSourceSummary): SecretDraft {
  if (source.type === 'env') {
    return { type: 'env', name: source.name, ref: '', value: '' };
  }
  if (source.type === 'encrypted') {
    return { type: 'encrypted', name: '', ref: `dbsec:${source.name}`, value: '' };
  }
  return cloneSecret();
}

function secretPayload(source: SecretDraft) {
  if (source.type === 'none') return { type: 'none' as const };
  if (source.type === 'env') return { type: 'env' as const, name: source.name };
  return {
    type: 'encrypted' as const,
    ref: source.ref || undefined,
    value: source.value || undefined,
  };
}

function makeQuery(filters: Record<string, string>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value && value !== 'all') params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export default function AdminServiceConnectionsPage() {
  const t = useTranslations('dashboard.serviceConnections');
  const locale = useLocale().startsWith('zh') ? 'zh-CN' : 'en-US';
  const loadFailedLabel = t('errors.loadFailed');
  const [requirements, setRequirements] = React.useState<AdminServiceConnectionRequirement[]>([]);
  const [connections, setConnections] = React.useState<AdminServiceConnectionSummary[]>([]);
  const [logs, setLogs] = React.useState<AdminServiceConnectionLogSummary[]>([]);
  const [draft, setDraft] = React.useState<ConnectionDraft>(emptyDraft);
  const [activeTab, setActiveTab] = React.useState('requirements');
  const [filters, setFilters] = React.useState({
    pluginId: '',
    serviceName: '',
    status: 'all',
    workspaceId: '',
    environment: '',
  });
  const [rotation, setRotation] = React.useState<{
    id: string;
    field: 'auth' | 'authUsername' | 'authPassword' | 'actorClaims';
    value: string;
  }>({ id: '', field: 'auth', value: '' });
  const [testResult, setTestResult] = React.useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [acting, setActing] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [retentionDays, setRetentionDays] = React.useState('90');

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const listQuery = makeQuery(filters);
      const requirementsQuery = makeQuery({
        pluginId: filters.pluginId,
        serviceName: filters.serviceName,
        workspaceId: filters.workspaceId,
        environment: filters.environment,
      });
      const logsQuery = makeQuery({
        pluginId: filters.pluginId,
        serviceName: filters.serviceName,
        workspaceId: filters.workspaceId,
      });
      const [requirementsResponse, connectionsResponse, logsResponse] = await Promise.all([
        apiFetch(`/api/admin/service-connections/requirements${requirementsQuery}`),
        apiFetch(`/api/admin/service-connections${listQuery}`),
        apiFetch(`/api/admin/service-connections/logs${logsQuery}`),
      ]);
      if (!requirementsResponse.ok || !connectionsResponse.ok || !logsResponse.ok) {
        throw new Error(loadFailedLabel);
      }
      setRequirements(
        ((await requirementsResponse.json()) as RequirementsResponse).requirements ?? []
      );
      setConnections(((await connectionsResponse.json()) as ConnectionsResponse).connections ?? []);
      setLogs(((await logsResponse.json()) as LogsResponse).logs ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : loadFailedLabel);
    } finally {
      setLoading(false);
    }
  }, [filters, loadFailedLabel]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  function editConnection(connection: AdminServiceConnectionSummary) {
    setDraft({
      id: connection.id,
      productId: connection.productId,
      pluginId: connection.pluginId,
      ownerType:
        connection.ownerType === 'suite' || connection.ownerType === 'product'
          ? connection.ownerType
          : 'plugin',
      ownerId: connection.ownerId,
      serviceName: connection.serviceName,
      scopeType: connection.scopeType === 'workspace' ? 'workspace' : 'global',
      scopeId: connection.scopeId ?? '',
      environment: connection.environment ?? '',
      baseUrl: connection.baseUrl,
      authType: connection.authType as ConnectionDraft['authType'],
      authSecretSource: secretDraftFromSummary(connection.authSecretSource),
      authUsernameSource: secretDraftFromSummary(connection.authUsernameSource),
      authPasswordSource: secretDraftFromSummary(connection.authPasswordSource),
      authHeaderName: connection.authHeaderName ?? '',
      actorClaimsEnabled: connection.actorClaimsEnabled,
      actorClaimsAudience: connection.actorClaimsAudience ?? '',
      actorClaimsSecretSource: secretDraftFromSummary(connection.actorClaimsSecretSource),
      actorClaimsKeyId: connection.actorClaimsKeyId ?? '',
      actorClaimsTtlSeconds: String(connection.actorClaimsTtlSeconds),
      timeoutMs: String(connection.timeoutMs),
      retryAttempts: String(connection.retryAttempts),
      retryBackoffMs: String(connection.retryBackoffMs),
      maxResponseBytes: String(connection.maxResponseBytes),
      healthPath: connection.healthPath ?? '/healthz',
      healthMethod: connection.healthMethod,
      healthExpectedStatus: String(connection.healthExpectedStatus),
      status: connection.status,
    });
    setActiveTab('editor');
  }

  function configureRequirement(requirement: AdminServiceConnectionRequirement) {
    setDraft({
      ...emptyDraft,
      authSecretSource: cloneSecret(),
      authUsernameSource: cloneSecret(),
      authPasswordSource: cloneSecret(),
      actorClaimsSecretSource: cloneSecret(),
      productId: requirement.productId,
      pluginId: requirement.pluginId,
      ownerType: requirement.ownerType,
      ownerId: requirement.ownerId,
      serviceName: requirement.serviceName,
      actorClaimsEnabled: requirement.actorClaims,
      actorClaimsAudience: requirement.serviceName,
    });
    setActiveTab('editor');
  }

  async function saveConnection() {
    setActing('save');
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch('/api/admin/service-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert',
          ...draft,
          id: draft.id || undefined,
          productId: draft.productId || undefined,
          ownerId: draft.ownerId || undefined,
          scopeId: draft.scopeType === 'workspace' ? draft.scopeId : null,
          environment: draft.environment || null,
          authSecretSource: secretPayload(draft.authSecretSource),
          authUsernameSource: secretPayload(draft.authUsernameSource),
          authPasswordSource: secretPayload(draft.authPasswordSource),
          authHeaderName: draft.authHeaderName || null,
          actorClaimsSecretSource: secretPayload(draft.actorClaimsSecretSource),
          actorClaimsAudience: draft.actorClaimsAudience || null,
          actorClaimsType: 'hmac',
          actorClaimsKeyId: draft.actorClaimsKeyId || null,
          actorClaimsTtlSeconds: Number(draft.actorClaimsTtlSeconds),
          timeoutMs: Number(draft.timeoutMs),
          retryAttempts: Number(draft.retryAttempts),
          retryBackoffMs: Number(draft.retryBackoffMs),
          maxResponseBytes: Number(draft.maxResponseBytes),
          healthPath: draft.healthPath || null,
          healthMethod: draft.healthMethod,
          healthExpectedStatus: Number(draft.healthExpectedStatus),
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      setMessage(t('messages.saved'));
      setDraft(emptyDraft);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('errors.saveFailed'));
    } finally {
      setActing(null);
    }
  }

  async function postAction(body: Record<string, unknown>, successMessage: string) {
    setActing(String(body.id ?? body.action));
    setError(null);
    setMessage(null);
    setTestResult(null);
    try {
      const response = await apiFetch('/api/admin/service-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as {
        test?: Record<string, unknown>;
      } | null;
      if (!response.ok) throw new Error(JSON.stringify(payload));
      if (payload?.test) setTestResult(payload.test);
      setMessage(successMessage);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : successMessage);
    } finally {
      setActing(null);
    }
  }

  async function applyRetention() {
    setActing('retention');
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch('/api/admin/service-connections/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retentionDays: Number(retentionDays) }),
      });
      if (!response.ok) throw new Error(await response.text());
      setMessage(t('messages.retentionFinished'));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('errors.retentionFailed'));
    } finally {
      setActing(null);
    }
  }

  async function rotateSecret() {
    if (!rotation.id || !rotation.value) return;
    await postAction(
      {
        action: 'rotateSecret',
        id: rotation.id,
        field: rotation.field,
        value: rotation.value,
      },
      t('messages.secretRotated')
    );
    setRotation({ id: '', field: 'auth', value: '' });
  }

  const formatStatusLabel = (status: string) => {
    const key = `statuses.${status}`;
    return t.has(key) ? t(key) : status;
  };

  const formatSecretSource = (source: AdminSecretSourceSummary) => {
    if (source.type === 'none') return t('secretSources.none');
    if (source.type === 'env') return t('secretSources.env', { name: source.name });
    if (source.type === 'encrypted') return t('secretSources.encrypted', { name: source.name });
    if (source.type === 'invalid') return t('secretSources.invalid', { ref: source.ref });
    return t('secretSources.none');
  };

  const formatOwner = (ownerType: string, ownerId: string) => {
    const key = `ownerTypes.${ownerType}`;
    const label = t.has(key) ? t(key) : ownerType;
    return `${label}:${ownerId}`;
  };

  const formatScope = (scopeType: string) => {
    const key = `scopes.${scopeType}`;
    return t.has(key) ? t(key) : scopeType;
  };

  const formatEnvironment = (environment: string | null | undefined) => {
    return environment || t('empty.defaultEnvironment');
  };

  return (
    <DashboardPageShell>
      <DashboardPageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('actions.refresh')}
          </Button>
        }
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('alerts.failed')}</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      )}
      {message && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>{t('alerts.done')}</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label={t('stats.declaredServices')} value={requirements.length} />
        <StatCard
          label={t('stats.missing')}
          value={
            requirements.filter((item) => item.required && item.connectionStatus === 'missing')
              .length
          }
        />
        <StatCard label={t('stats.bindings')} value={connections.length} />
        <StatCard label={t('stats.recentCalls')} value={logs.length} />
      </div>

      <Panel title={t('filters.title')} description={t('filters.description')}>
        <div className="grid gap-3 md:grid-cols-5">
          <Field
            label={t('filters.fields.plugin')}
            value={filters.pluginId}
            onChange={(pluginId) => setFilters({ ...filters, pluginId })}
          />
          <Field
            label={t('filters.fields.service')}
            value={filters.serviceName}
            onChange={(serviceName) => setFilters({ ...filters, serviceName })}
          />
          <Field
            label={t('filters.fields.workspace')}
            value={filters.workspaceId}
            onChange={(workspaceId) => setFilters({ ...filters, workspaceId })}
          />
          <Field
            label={t('filters.fields.environment')}
            value={filters.environment}
            onChange={(environment) => setFilters({ ...filters, environment })}
          />
          <Select
            value={filters.status}
            onValueChange={(status) => setFilters({ ...filters, status })}
          >
            <SelectTrigger className="mt-6">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filters.status.all')}</SelectItem>
              <SelectItem value="active">{t('statuses.active')}</SelectItem>
              <SelectItem value="disabled">{t('statuses.disabled')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Panel>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="requirements">{t('tabs.requirements')}</TabsTrigger>
          <TabsTrigger value="connections">{t('tabs.bindings')}</TabsTrigger>
          <TabsTrigger value="editor">{t('tabs.editor')}</TabsTrigger>
          <TabsTrigger value="logs">{t('tabs.logs')}</TabsTrigger>
        </TabsList>

        <TabsContent value="requirements">
          <Panel title={t('requirements.title')} description={t('requirements.description')}>
            <DataTable
              loading={loading}
              empty={t('requirements.empty')}
              headers={[
                t('requirements.headers.plugin'),
                t('requirements.headers.service'),
                t('requirements.headers.required'),
                t('requirements.headers.methods'),
                t('requirements.headers.paths'),
                t('requirements.headers.actorClaims'),
                t('requirements.headers.status'),
                t('requirements.headers.action'),
              ]}
              rows={requirements.map((item) => [
                item.pluginId,
                item.serviceName,
                item.required ? t('requirement.required') : t('requirement.optional'),
                item.methods.join(', '),
                item.paths.join(', '),
                item.actorClaims ? t('requirement.required') : t('requirement.off'),
                <Badge key="status" variant={statusVariant(item.connectionStatus)}>
                  {formatStatusLabel(item.connectionStatus)}
                </Badge>,
                <Button
                  key="action"
                  variant="outline"
                  size="sm"
                  onClick={() => configureRequirement(item)}
                >
                  {t('actions.configure')}
                </Button>,
              ])}
            />
          </Panel>
        </TabsContent>

        <TabsContent value="connections">
          <Panel title={t('bindings.title')} description={t('bindings.description')}>
            <DataTable
              loading={loading}
              empty={t('bindings.empty')}
              headers={[
                t('bindings.headers.binding'),
                t('bindings.headers.baseUrl'),
                t('bindings.headers.auth'),
                t('bindings.headers.actor'),
                t('bindings.headers.health'),
                t('bindings.headers.action'),
              ]}
              rows={connections.map((connection) => [
                <Identity
                  key="id"
                  title={`${connection.pluginId}:${connection.serviceName}`}
                  detail={formatOwner(connection.ownerType, connection.ownerId)}
                />,
                <div key="endpoint" className="max-w-[320px] truncate">
                  {connection.baseUrl}
                  <div className="text-xs text-muted-foreground">
                    {formatEnvironment(connection.environment)} /{' '}
                    {formatScope(connection.scopeType)}
                  </div>
                </div>,
                <div key="auth" className="space-y-1 text-xs">
                  <div>{connection.authType}</div>
                  <div className="text-muted-foreground">
                    {formatSecretSource(connection.authSecretSource)}
                  </div>
                </div>,
                connection.actorClaimsEnabled
                  ? formatSecretSource(connection.actorClaimsSecretSource)
                  : t('requirement.off'),
                <div key="health" className="space-y-1">
                  <Badge variant={statusVariant(connection.lastCheckStatus ?? connection.status)}>
                    {formatStatusLabel(connection.lastCheckStatus ?? connection.status)}
                  </Badge>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(connection.lastCheckedAt, locale, t('empty.never'))}
                  </div>
                </div>,
                <div key="action" className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => editConnection(connection)}>
                    {t('actions.edit')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={acting === connection.id}
                    onClick={() =>
                      void postAction(
                        { action: 'test', id: connection.id },
                        t('messages.testFinished', { serviceName: connection.serviceName })
                      )
                    }
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {t('actions.test')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRotation({ id: connection.id, field: 'auth', value: '' })}
                  >
                    <KeyRound className="h-4 w-4" />
                    {t('actions.rotate')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={acting === connection.id}
                    onClick={() =>
                      void postAction(
                        {
                          action: 'setStatus',
                          id: connection.id,
                          status: connection.status === 'active' ? 'disabled' : 'active',
                        },
                        connection.status === 'active'
                          ? t('messages.connectionDisabled')
                          : t('messages.connectionEnabled')
                      )
                    }
                  >
                    {connection.status === 'active' ? t('actions.disable') : t('actions.enable')}
                  </Button>
                </div>,
              ])}
            />
            {testResult && <ResultPanel title={t('bindings.lastTestResult')} value={testResult} />}
            {rotation.id && (
              <div className="mt-4 grid gap-3 rounded-md border p-4 md:grid-cols-[180px_1fr_auto]">
                <Select
                  value={rotation.field}
                  onValueChange={(field) =>
                    setRotation({ ...rotation, field: field as typeof rotation.field })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auth">{t('rotation.fields.auth')}</SelectItem>
                    <SelectItem value="authUsername">
                      {t('rotation.fields.authUsername')}
                    </SelectItem>
                    <SelectItem value="authPassword">
                      {t('rotation.fields.authPassword')}
                    </SelectItem>
                    <SelectItem value="actorClaims">{t('rotation.fields.actorClaims')}</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="password"
                  value={rotation.value}
                  onChange={(event) => setRotation({ ...rotation, value: event.target.value })}
                  placeholder={t('rotation.newSecretPlaceholder')}
                />
                <Button disabled={!rotation.value} onClick={() => void rotateSecret()}>
                  {t('actions.rotate')}
                </Button>
              </div>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="editor">
          <Panel title={t('editor.title')} description={t('editor.description')}>
            <EditorSection title={t('editor.sections.identity')}>
              <Field
                label={t('editor.fields.pluginId')}
                value={draft.pluginId}
                onChange={(pluginId) => setDraft({ ...draft, pluginId })}
              />
              <Field
                label={t('editor.fields.serviceName')}
                value={draft.serviceName}
                onChange={(serviceName) => setDraft({ ...draft, serviceName })}
              />
              <SelectField
                label={t('editor.fields.owner')}
                value={draft.ownerType}
                values={['plugin', 'suite', 'product']}
                optionLabels={{
                  plugin: t('ownerTypes.plugin'),
                  suite: t('ownerTypes.suite'),
                  product: t('ownerTypes.product'),
                }}
                onChange={(ownerType) =>
                  setDraft({ ...draft, ownerType: ownerType as ConnectionDraft['ownerType'] })
                }
              />
              <Field
                label={t('editor.fields.ownerId')}
                value={draft.ownerId}
                onChange={(ownerId) => setDraft({ ...draft, ownerId })}
              />
              <SelectField
                label={t('editor.fields.scope')}
                value={draft.scopeType}
                values={['global', 'workspace']}
                optionLabels={{
                  global: t('scopes.global'),
                  workspace: t('scopes.workspace'),
                }}
                onChange={(scopeType) =>
                  setDraft({ ...draft, scopeType: scopeType as ConnectionDraft['scopeType'] })
                }
              />
              <Field
                label={t('editor.fields.workspaceId')}
                value={draft.scopeId}
                onChange={(scopeId) => setDraft({ ...draft, scopeId })}
              />
              <Field
                label={t('editor.fields.environment')}
                value={draft.environment}
                onChange={(environment) => setDraft({ ...draft, environment })}
              />
              <SelectField
                label={t('editor.fields.status')}
                value={draft.status}
                values={['active', 'disabled']}
                optionLabels={{
                  active: t('statuses.active'),
                  disabled: t('statuses.disabled'),
                }}
                onChange={(status) =>
                  setDraft({ ...draft, status: status as ConnectionDraft['status'] })
                }
              />
            </EditorSection>

            <EditorSection title={t('editor.sections.endpoint')}>
              <Field
                label={t('editor.fields.baseUrl')}
                value={draft.baseUrl}
                onChange={(baseUrl) => setDraft({ ...draft, baseUrl })}
              />
              <Field
                label={t('editor.fields.timeoutMs')}
                type="number"
                value={draft.timeoutMs}
                onChange={(timeoutMs) => setDraft({ ...draft, timeoutMs })}
              />
              <Field
                label={t('editor.fields.retryAttempts')}
                type="number"
                value={draft.retryAttempts}
                onChange={(retryAttempts) => setDraft({ ...draft, retryAttempts })}
              />
              <Field
                label={t('editor.fields.retryBackoffMs')}
                type="number"
                value={draft.retryBackoffMs}
                onChange={(retryBackoffMs) => setDraft({ ...draft, retryBackoffMs })}
              />
              <Field
                label={t('editor.fields.maxResponseBytes')}
                type="number"
                value={draft.maxResponseBytes}
                onChange={(maxResponseBytes) => setDraft({ ...draft, maxResponseBytes })}
              />
            </EditorSection>

            <EditorSection title={t('editor.sections.authentication')}>
              <SelectField
                label={t('editor.fields.authType')}
                value={draft.authType}
                values={['none', 'bearer', 'basic', 'apiKey']}
                optionLabels={{
                  none: t('authTypes.none'),
                  bearer: t('authTypes.bearer'),
                  basic: t('authTypes.basic'),
                  apiKey: t('authTypes.apiKey'),
                }}
                onChange={(authType) =>
                  setDraft({ ...draft, authType: authType as ConnectionDraft['authType'] })
                }
              />
              <SecretSourceField
                label={t('editor.fields.authSecret')}
                value={draft.authSecretSource}
                onChange={(authSecretSource) => setDraft({ ...draft, authSecretSource })}
              />
              {draft.authType === 'basic' && (
                <>
                  <SecretSourceField
                    label={t('editor.fields.basicUsername')}
                    value={draft.authUsernameSource}
                    onChange={(authUsernameSource) => setDraft({ ...draft, authUsernameSource })}
                  />
                  <SecretSourceField
                    label={t('editor.fields.basicPassword')}
                    value={draft.authPasswordSource}
                    onChange={(authPasswordSource) => setDraft({ ...draft, authPasswordSource })}
                  />
                </>
              )}
              <Field
                label={t('editor.fields.authHeader')}
                value={draft.authHeaderName}
                onChange={(authHeaderName) => setDraft({ ...draft, authHeaderName })}
              />
            </EditorSection>

            <EditorSection title={t('editor.sections.actorClaims')}>
              <div className="flex h-10 items-center justify-between rounded-md border px-3">
                <Label>{t('editor.fields.enabled')}</Label>
                <Switch
                  checked={draft.actorClaimsEnabled}
                  onCheckedChange={(actorClaimsEnabled) =>
                    setDraft({ ...draft, actorClaimsEnabled })
                  }
                />
              </div>
              <Field
                label={t('editor.fields.actorAudience')}
                value={draft.actorClaimsAudience}
                onChange={(actorClaimsAudience) =>
                  setDraft({
                    ...draft,
                    actorClaimsAudience,
                    actorClaimsEnabled: !!actorClaimsAudience || draft.actorClaimsEnabled,
                  })
                }
              />
              <SecretSourceField
                label={t('editor.fields.signingSecret')}
                value={draft.actorClaimsSecretSource}
                onChange={(actorClaimsSecretSource) =>
                  setDraft({ ...draft, actorClaimsSecretSource })
                }
              />
              <Field
                label={t('editor.fields.keyId')}
                value={draft.actorClaimsKeyId}
                onChange={(actorClaimsKeyId) => setDraft({ ...draft, actorClaimsKeyId })}
              />
              <Field
                label={t('editor.fields.ttlSeconds')}
                type="number"
                value={draft.actorClaimsTtlSeconds}
                onChange={(actorClaimsTtlSeconds) => setDraft({ ...draft, actorClaimsTtlSeconds })}
              />
            </EditorSection>

            <EditorSection title={t('editor.sections.healthCheck')}>
              <Field
                label={t('editor.fields.healthPath')}
                value={draft.healthPath}
                onChange={(healthPath) => setDraft({ ...draft, healthPath })}
              />
              <SelectField
                label={t('editor.fields.healthMethod')}
                value={draft.healthMethod}
                values={['GET', 'POST', 'HEAD']}
                onChange={(healthMethod) => setDraft({ ...draft, healthMethod })}
              />
              <Field
                label={t('editor.fields.expectedStatus')}
                type="number"
                value={draft.healthExpectedStatus}
                onChange={(healthExpectedStatus) => setDraft({ ...draft, healthExpectedStatus })}
              />
            </EditorSection>

            <div className="mt-4 flex justify-end">
              <Button disabled={acting === 'save'} onClick={() => void saveConnection()}>
                {t('editor.saveBinding')}
              </Button>
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="logs">
          <Panel title={t('logs.title')} description={t('logs.description')}>
            <DataTable
              loading={loading}
              empty={t('logs.empty')}
              headers={[
                t('logs.headers.service'),
                t('logs.headers.method'),
                t('logs.headers.pathTemplate'),
                t('logs.headers.status'),
                t('logs.headers.duration'),
                t('logs.headers.request'),
                t('logs.headers.created'),
              ]}
              rows={logs.map((log) => [
                `${log.pluginId}:${log.serviceName}`,
                log.method,
                log.pathTemplate ?? log.path,
                formatStatusLabel(String(log.status ?? log.errorCode ?? 'error')),
                log.durationMs == null ? '-' : `${log.durationMs} ms`,
                log.requestId ?? '-',
                formatDate(log.createdAt, locale, t('empty.never')),
              ])}
            />
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-end">
              <div className="w-full sm:w-40">
                <Field
                  label={t('logs.retentionDays')}
                  type="number"
                  value={retentionDays}
                  onChange={setRetentionDays}
                />
              </div>
              <Button
                variant="outline"
                disabled={acting === 'retention'}
                onClick={() => void applyRetention()}
              >
                {t('logs.applyRetention')}
              </Button>
            </div>
          </Panel>
        </TabsContent>
      </Tabs>
    </DashboardPageShell>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      </CardContent>
    </Card>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function EditorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b py-4 last:border-0">
      <h3 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">{title}</h3>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function SelectField({
  label,
  value,
  values,
  optionLabels,
  onChange,
}: {
  label: string;
  value: string;
  values: string[];
  optionLabels?: Record<string, string>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {values.map((item) => (
            <SelectItem key={item} value={item}>
              {optionLabels?.[item] ?? item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SecretSourceField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: SecretDraft;
  onChange: (value: SecretDraft) => void;
}) {
  const t = useTranslations('dashboard.serviceConnections');

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select
        value={value.type}
        onValueChange={(type) =>
          onChange({ ...cloneSecret(value), type: type as SecretDraft['type'] })
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t('secretSourceOptions.none')}</SelectItem>
          <SelectItem value="env">{t('secretSourceOptions.env')}</SelectItem>
          <SelectItem value="encrypted">{t('secretSourceOptions.encrypted')}</SelectItem>
        </SelectContent>
      </Select>
      {value.type === 'env' && (
        <Input
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
          placeholder={t('secretSourceOptions.envPlaceholder')}
        />
      )}
      {value.type === 'encrypted' && (
        <Input
          type="password"
          value={value.value}
          onChange={(event) => onChange({ ...value, value: event.target.value })}
          placeholder={
            value.ref
              ? t('secretSourceOptions.keepExistingPlaceholder')
              : t('secretSourceOptions.secretPlaceholder')
          }
        />
      )}
    </div>
  );
}

function Identity({ title, detail }: { title: string; detail: string }) {
  return (
    <div>
      <div className="max-w-[260px] truncate font-medium">{title}</div>
      <div className="max-w-[260px] truncate font-mono text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function ResultPanel({ title, value }: { title: string; value: Record<string, unknown> }) {
  return (
    <pre className="mt-4 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
      {title}
      {'\n'}
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function DataTable({
  headers,
  rows,
  empty,
  loading,
}: {
  headers: string[];
  rows: React.ReactNode[][];
  empty: string;
  loading: boolean;
}) {
  const t = useTranslations('dashboard.serviceConnections');

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((header) => (
              <TableHead key={header}>{header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={headers.length}>{t('loading')}</TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={headers.length}>{empty}</TableCell>
            </TableRow>
          ) : (
            rows.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <TableCell key={cellIndex}>{cell}</TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
