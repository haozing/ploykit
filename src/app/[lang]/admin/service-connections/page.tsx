'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
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

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : 'Never';
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

function sourceLabel(source: AdminSecretSourceSummary) {
  return source.label;
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
        throw new Error('Failed to load service connection data');
      }
      setRequirements(
        ((await requirementsResponse.json()) as RequirementsResponse).requirements ?? []
      );
      setConnections(((await connectionsResponse.json()) as ConnectionsResponse).connections ?? []);
      setLogs(((await logsResponse.json()) as LogsResponse).logs ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [filters]);

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
      setMessage('Service connection saved.');
      setDraft(emptyDraft);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Save failed');
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
      setMessage('Retention cleanup finished.');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Retention cleanup failed');
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
      'Secret rotated.'
    );
    setRotation({ id: '', field: 'auth', value: '' });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t('actions.refresh')}
        </Button>
      </div>

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

      <Panel title="Filters" description="Narrow requirements, connections, and logs.">
        <div className="grid gap-3 md:grid-cols-5">
          <Field
            label="Plugin"
            value={filters.pluginId}
            onChange={(pluginId) => setFilters({ ...filters, pluginId })}
          />
          <Field
            label="Service"
            value={filters.serviceName}
            onChange={(serviceName) => setFilters({ ...filters, serviceName })}
          />
          <Field
            label="Workspace"
            value={filters.workspaceId}
            onChange={(workspaceId) => setFilters({ ...filters, workspaceId })}
          />
          <Field
            label="Environment"
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
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
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
                'Plugin',
                'Service',
                'Required',
                'Methods',
                'Paths',
                'Actor claims',
                'Status',
                '',
              ]}
              rows={requirements.map((item) => [
                item.pluginId,
                item.serviceName,
                item.required ? 'required' : 'optional',
                item.methods.join(', '),
                item.paths.join(', '),
                item.actorClaims ? 'required' : 'off',
                <Badge key="status" variant={statusVariant(item.connectionStatus)}>
                  {item.connectionStatus}
                </Badge>,
                <Button
                  key="action"
                  variant="outline"
                  size="sm"
                  onClick={() => configureRequirement(item)}
                >
                  Configure
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
              headers={['Connection', 'Endpoint', 'Auth', 'Actor', 'Health', 'Actions']}
              rows={connections.map((connection) => [
                <Identity
                  key="id"
                  title={`${connection.pluginId}:${connection.serviceName}`}
                  detail={`${connection.ownerType}:${connection.ownerId}`}
                />,
                <div key="endpoint" className="max-w-[320px] truncate">
                  {connection.baseUrl}
                  <div className="text-xs text-muted-foreground">
                    {connection.environment ?? 'default'} / {connection.scopeType}
                  </div>
                </div>,
                <div key="auth" className="space-y-1 text-xs">
                  <div>{connection.authType}</div>
                  <div className="text-muted-foreground">
                    {sourceLabel(connection.authSecretSource)}
                  </div>
                </div>,
                connection.actorClaimsEnabled
                  ? sourceLabel(connection.actorClaimsSecretSource)
                  : 'off',
                <div key="health" className="space-y-1">
                  <Badge variant={statusVariant(connection.lastCheckStatus ?? connection.status)}>
                    {connection.lastCheckStatus ?? connection.status}
                  </Badge>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(connection.lastCheckedAt)}
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
                        `Test finished for ${connection.serviceName}.`
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
                    Rotate
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
                        `Connection ${connection.status === 'active' ? 'disabled' : 'enabled'}.`
                      )
                    }
                  >
                    {connection.status === 'active' ? t('actions.disable') : t('actions.enable')}
                  </Button>
                </div>,
              ])}
            />
            {testResult && <ResultPanel title="Last test result" value={testResult} />}
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
                    <SelectItem value="auth">Auth token</SelectItem>
                    <SelectItem value="authUsername">Basic username</SelectItem>
                    <SelectItem value="authPassword">Basic password</SelectItem>
                    <SelectItem value="actorClaims">Actor claims</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="password"
                  value={rotation.value}
                  onChange={(event) => setRotation({ ...rotation, value: event.target.value })}
                  placeholder="New secret value"
                />
                <Button disabled={!rotation.value} onClick={() => void rotateSecret()}>
                  Rotate
                </Button>
              </div>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="editor">
          <Panel title={t('editor.title')} description={t('editor.description')}>
            <EditorSection title="Identity">
              <Field
                label="Plugin"
                value={draft.pluginId}
                onChange={(pluginId) => setDraft({ ...draft, pluginId })}
              />
              <Field
                label="Service"
                value={draft.serviceName}
                onChange={(serviceName) => setDraft({ ...draft, serviceName })}
              />
              <SelectField
                label="Owner"
                value={draft.ownerType}
                values={['plugin', 'suite', 'product']}
                onChange={(ownerType) =>
                  setDraft({ ...draft, ownerType: ownerType as ConnectionDraft['ownerType'] })
                }
              />
              <Field
                label="Owner id"
                value={draft.ownerId}
                onChange={(ownerId) => setDraft({ ...draft, ownerId })}
              />
              <SelectField
                label="Scope"
                value={draft.scopeType}
                values={['global', 'workspace']}
                onChange={(scopeType) =>
                  setDraft({ ...draft, scopeType: scopeType as ConnectionDraft['scopeType'] })
                }
              />
              <Field
                label="Workspace id"
                value={draft.scopeId}
                onChange={(scopeId) => setDraft({ ...draft, scopeId })}
              />
              <Field
                label="Environment"
                value={draft.environment}
                onChange={(environment) => setDraft({ ...draft, environment })}
              />
              <SelectField
                label="Status"
                value={draft.status}
                values={['active', 'disabled']}
                onChange={(status) =>
                  setDraft({ ...draft, status: status as ConnectionDraft['status'] })
                }
              />
            </EditorSection>

            <EditorSection title="Endpoint">
              <Field
                label="Base URL"
                value={draft.baseUrl}
                onChange={(baseUrl) => setDraft({ ...draft, baseUrl })}
              />
              <Field
                label="Timeout ms"
                type="number"
                value={draft.timeoutMs}
                onChange={(timeoutMs) => setDraft({ ...draft, timeoutMs })}
              />
              <Field
                label="Retry attempts"
                type="number"
                value={draft.retryAttempts}
                onChange={(retryAttempts) => setDraft({ ...draft, retryAttempts })}
              />
              <Field
                label="Retry backoff ms"
                type="number"
                value={draft.retryBackoffMs}
                onChange={(retryBackoffMs) => setDraft({ ...draft, retryBackoffMs })}
              />
              <Field
                label="Max response bytes"
                type="number"
                value={draft.maxResponseBytes}
                onChange={(maxResponseBytes) => setDraft({ ...draft, maxResponseBytes })}
              />
            </EditorSection>

            <EditorSection title="Authentication">
              <SelectField
                label="Auth type"
                value={draft.authType}
                values={['none', 'bearer', 'basic', 'apiKey']}
                onChange={(authType) =>
                  setDraft({ ...draft, authType: authType as ConnectionDraft['authType'] })
                }
              />
              <SecretSourceField
                label="Auth secret"
                value={draft.authSecretSource}
                onChange={(authSecretSource) => setDraft({ ...draft, authSecretSource })}
              />
              {draft.authType === 'basic' && (
                <>
                  <SecretSourceField
                    label="Basic username"
                    value={draft.authUsernameSource}
                    onChange={(authUsernameSource) => setDraft({ ...draft, authUsernameSource })}
                  />
                  <SecretSourceField
                    label="Basic password"
                    value={draft.authPasswordSource}
                    onChange={(authPasswordSource) => setDraft({ ...draft, authPasswordSource })}
                  />
                </>
              )}
              <Field
                label="API key header"
                value={draft.authHeaderName}
                onChange={(authHeaderName) => setDraft({ ...draft, authHeaderName })}
              />
            </EditorSection>

            <EditorSection title="Actor Claims">
              <div className="flex h-10 items-center justify-between rounded-md border px-3">
                <Label>Enabled</Label>
                <Switch
                  checked={draft.actorClaimsEnabled}
                  onCheckedChange={(actorClaimsEnabled) =>
                    setDraft({ ...draft, actorClaimsEnabled })
                  }
                />
              </div>
              <Field
                label="Audience"
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
                label="Signing secret"
                value={draft.actorClaimsSecretSource}
                onChange={(actorClaimsSecretSource) =>
                  setDraft({ ...draft, actorClaimsSecretSource })
                }
              />
              <Field
                label="Key id"
                value={draft.actorClaimsKeyId}
                onChange={(actorClaimsKeyId) => setDraft({ ...draft, actorClaimsKeyId })}
              />
              <Field
                label="TTL seconds"
                type="number"
                value={draft.actorClaimsTtlSeconds}
                onChange={(actorClaimsTtlSeconds) => setDraft({ ...draft, actorClaimsTtlSeconds })}
              />
            </EditorSection>

            <EditorSection title="Health Check">
              <Field
                label="Path"
                value={draft.healthPath}
                onChange={(healthPath) => setDraft({ ...draft, healthPath })}
              />
              <SelectField
                label="Method"
                value={draft.healthMethod}
                values={['GET', 'POST', 'HEAD']}
                onChange={(healthMethod) => setDraft({ ...draft, healthMethod })}
              />
              <Field
                label="Expected status"
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
                'Service',
                'Method',
                'Path template',
                'Status',
                'Duration',
                'Request',
                'Created',
              ]}
              rows={logs.map((log) => [
                `${log.pluginId}:${log.serviceName}`,
                log.method,
                log.pathTemplate ?? log.path,
                log.status ?? log.errorCode ?? 'error',
                log.durationMs == null ? '-' : `${log.durationMs} ms`,
                log.requestId ?? '-',
                formatDate(log.createdAt),
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
    </div>
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
  onChange,
}: {
  label: string;
  value: string;
  values: string[];
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
              {item}
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
          <SelectItem value="none">None</SelectItem>
          <SelectItem value="env">Environment variable</SelectItem>
          <SelectItem value="encrypted">Encrypted database secret</SelectItem>
        </SelectContent>
      </Select>
      {value.type === 'env' && (
        <Input
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
          placeholder="ENV_VAR_NAME"
        />
      )}
      {value.type === 'encrypted' && (
        <Input
          type="password"
          value={value.value}
          onChange={(event) => onChange({ ...value, value: event.target.value })}
          placeholder={value.ref ? 'Leave blank to keep existing secret' : 'Secret value'}
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
              <TableCell colSpan={headers.length}>Loading...</TableCell>
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
