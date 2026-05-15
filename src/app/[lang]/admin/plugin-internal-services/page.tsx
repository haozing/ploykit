'use client';

import * as React from 'react';
import { AlertCircle, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';
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
  AdminInternalServiceBindingSummary,
  AdminInternalServiceRequirement,
  AdminResourceBindingSummary,
  AdminServiceCallLogSummary,
} from '@/lib/plugin-runtime/admin';

interface RequirementsResponse {
  requirements?: AdminInternalServiceRequirement[];
}

interface BindingsResponse {
  bindings?: AdminInternalServiceBindingSummary[];
}

interface LogsResponse {
  logs?: AdminServiceCallLogSummary[];
}

interface ResourceBindingsResponse {
  bindings?: AdminResourceBindingSummary[];
}

type BindingDraft = {
  pluginId: string;
  serviceName: string;
  scopeType: 'global' | 'workspace';
  scopeId: string;
  environment: string;
  baseUrl: string;
  authType: 'none' | 'bearer' | 'basic' | 'apiKey';
  authSecretRef: string;
  authSecretValue: string;
  authUsernameRef: string;
  authUsernameValue: string;
  authPasswordRef: string;
  authPasswordValue: string;
  authHeaderName: string;
  actorClaimsEnabled: boolean;
  actorClaimsAudience: string;
  actorClaimsSecretRef: string;
  actorClaimsSecretValue: string;
  timeoutMs: string;
  retryAttempts: string;
  maxResponseBytes: string;
  healthPath: string;
};

const emptyDraft: BindingDraft = {
  pluginId: '',
  serviceName: '',
  scopeType: 'global',
  scopeId: '',
  environment: '',
  baseUrl: '',
  authType: 'none',
  authSecretRef: '',
  authSecretValue: '',
  authUsernameRef: '',
  authUsernameValue: '',
  authPasswordRef: '',
  authPasswordValue: '',
  authHeaderName: '',
  actorClaimsEnabled: false,
  actorClaimsAudience: '',
  actorClaimsSecretRef: '',
  actorClaimsSecretValue: '',
  timeoutMs: '30000',
  retryAttempts: '0',
  maxResponseBytes: '10485760',
  healthPath: '/',
};

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'bound' || status === 'active' || status === 'ok') return 'default';
  if (status === 'missing' || status === 'disabled' || status === 'error') return 'destructive';
  return 'secondary';
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : 'Never';
}

export default function AdminPluginInternalServicesPage() {
  const [requirements, setRequirements] = React.useState<AdminInternalServiceRequirement[]>([]);
  const [bindings, setBindings] = React.useState<AdminInternalServiceBindingSummary[]>([]);
  const [logs, setLogs] = React.useState<AdminServiceCallLogSummary[]>([]);
  const [resourceBindings, setResourceBindings] = React.useState<AdminResourceBindingSummary[]>([]);
  const [draft, setDraft] = React.useState<BindingDraft>(emptyDraft);
  const [loading, setLoading] = React.useState(true);
  const [acting, setActing] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [retentionDays, setRetentionDays] = React.useState('90');

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [requirementsResponse, bindingsResponse, logsResponse, resourceBindingsResponse] =
        await Promise.all([
          apiFetch('/api/admin/plugin-internal-services/requirements'),
          apiFetch('/api/admin/plugin-internal-services?limit=200'),
          apiFetch('/api/admin/plugin-internal-services/logs?limit=100'),
          apiFetch('/api/admin/plugin-resource-bindings?limit=100'),
        ]);
      if (
        !requirementsResponse.ok ||
        !bindingsResponse.ok ||
        !logsResponse.ok ||
        !resourceBindingsResponse.ok
      ) {
        throw new Error('Failed to load internal service data');
      }
      setRequirements(
        ((await requirementsResponse.json()) as RequirementsResponse).requirements ?? []
      );
      setBindings(((await bindingsResponse.json()) as BindingsResponse).bindings ?? []);
      setLogs(((await logsResponse.json()) as LogsResponse).logs ?? []);
      setResourceBindings(
        ((await resourceBindingsResponse.json()) as ResourceBindingsResponse).bindings ?? []
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  function editBinding(binding: AdminInternalServiceBindingSummary) {
    setDraft({
      pluginId: binding.pluginId,
      serviceName: binding.serviceName,
      scopeType: binding.scopeType === 'workspace' ? 'workspace' : 'global',
      scopeId: binding.scopeId ?? '',
      environment: binding.environment ?? '',
      baseUrl: binding.baseUrl,
      authType: binding.authType as BindingDraft['authType'],
      authSecretRef: binding.authSecretRef ?? '',
      authSecretValue: '',
      authUsernameRef: binding.authUsernameRef ?? '',
      authUsernameValue: '',
      authPasswordRef: binding.authPasswordRef ?? '',
      authPasswordValue: '',
      authHeaderName: binding.authHeaderName ?? '',
      actorClaimsEnabled: binding.actorClaimsEnabled,
      actorClaimsAudience: binding.actorClaimsAudience ?? '',
      actorClaimsSecretRef: binding.actorClaimsSecretRef ?? '',
      actorClaimsSecretValue: '',
      timeoutMs: String(binding.timeoutMs),
      retryAttempts: String(binding.retryAttempts),
      maxResponseBytes: String(binding.maxResponseBytes),
      healthPath: binding.healthPath ?? '/',
    });
  }

  function bindRequirement(requirement: AdminInternalServiceRequirement) {
    setDraft({
      ...emptyDraft,
      pluginId: requirement.pluginId,
      serviceName: requirement.serviceName,
      actorClaimsEnabled: requirement.actorClaims,
      actorClaimsAudience: requirement.serviceName,
    });
  }

  async function saveBinding() {
    setActing('save');
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch('/api/admin/plugin-internal-services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert',
          ...draft,
          scopeId: draft.scopeType === 'workspace' ? draft.scopeId : null,
          environment: draft.environment || null,
          authSecretRef: draft.authSecretRef || null,
          authSecretValue: draft.authSecretValue || undefined,
          authUsernameRef: draft.authUsernameRef || null,
          authUsernameValue: draft.authUsernameValue || undefined,
          authPasswordRef: draft.authPasswordRef || null,
          authPasswordValue: draft.authPasswordValue || undefined,
          authHeaderName: draft.authHeaderName || null,
          actorClaimsSecretRef: draft.actorClaimsSecretRef || null,
          actorClaimsSecretValue: draft.actorClaimsSecretValue || undefined,
          actorClaimsAudience: draft.actorClaimsAudience || null,
          actorClaimsType: 'hmac',
          timeoutMs: Number(draft.timeoutMs),
          retryAttempts: Number(draft.retryAttempts),
          retryBackoffMs: 250,
          maxResponseBytes: Number(draft.maxResponseBytes),
          healthPath: draft.healthPath || null,
          healthMethod: 'GET',
          healthExpectedStatus: 200,
          status: 'active',
        }),
      });
      if (!response.ok) throw new Error('Save failed');
      setMessage('Internal service binding saved.');
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
    try {
      const response = await apiFetch('/api/admin/plugin-internal-services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(successMessage);
      setMessage(successMessage);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : successMessage);
    } finally {
      setActing(null);
    }
  }

  async function runRetention() {
    setActing('retention');
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch('/api/admin/plugin-internal-services/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retentionDays: Number(retentionDays) }),
      });
      if (!response.ok) throw new Error('Retention cleanup failed');
      const result = (await response.json()) as { deleted?: number };
      setMessage(`Removed ${result.deleted ?? 0} old service call logs.`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Retention cleanup failed');
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Internal Services</h1>
          <p className="text-muted-foreground">
            Host-managed service bindings, health checks, call logs, and resource bindings.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {message && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Done</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Declared Services" value={requirements.length} />
        <StatCard
          label="Missing"
          value={requirements.filter((item) => item.bindingStatus === 'missing').length}
        />
        <StatCard label="Bindings" value={bindings.length} />
        <StatCard label="Recent Calls" value={logs.length} />
      </div>

      <Tabs defaultValue="requirements" className="space-y-4">
        <TabsList>
          <TabsTrigger value="requirements">Requirements</TabsTrigger>
          <TabsTrigger value="bindings">Bindings</TabsTrigger>
          <TabsTrigger value="editor">Editor</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
        </TabsList>

        <TabsContent value="requirements">
          <Panel title="Declared Service Requirements" description="Services declared by plugins.">
            <DataTable
              loading={loading}
              empty="No service requirements."
              headers={['Plugin', 'Service', 'Methods', 'Paths', 'Status', 'Action']}
              rows={requirements.map((item) => [
                item.pluginId,
                item.serviceName,
                item.methods.join(', '),
                item.paths.join(', '),
                <Badge key="status" variant={statusVariant(item.bindingStatus)}>
                  {item.bindingStatus}
                </Badge>,
                <Button
                  key="action"
                  variant="outline"
                  size="sm"
                  onClick={() => bindRequirement(item)}
                >
                  Bind
                </Button>,
              ])}
            />
          </Panel>
        </TabsContent>

        <TabsContent value="bindings">
          <Panel
            title="Host Bindings"
            description="Base URL, auth, actor claims, and health status."
          >
            <DataTable
              loading={loading}
              empty="No internal service bindings."
              headers={['Binding', 'Base URL', 'Auth', 'Actor', 'Health', 'Action']}
              rows={bindings.map((binding) => [
                <Identity
                  key="id"
                  title={`${binding.pluginId}:${binding.serviceName}`}
                  detail={binding.id}
                />,
                binding.baseUrl,
                binding.authType,
                binding.actorClaimsEnabled ? binding.actorClaimsAudience || 'enabled' : 'off',
                <Badge
                  key="health"
                  variant={statusVariant(binding.lastCheckStatus ?? binding.status)}
                >
                  {binding.lastCheckStatus ?? binding.status}
                </Badge>,
                <div key="action" className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => editBinding(binding)}>
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={acting === binding.id}
                    onClick={() =>
                      void postAction(
                        { action: 'test', id: binding.id },
                        `Test queued for ${binding.serviceName}.`
                      )
                    }
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Test
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={acting === binding.id}
                    onClick={() =>
                      void postAction(
                        {
                          action: 'setStatus',
                          id: binding.id,
                          status: binding.status === 'active' ? 'disabled' : 'active',
                        },
                        `Binding ${binding.status === 'active' ? 'disabled' : 'enabled'}.`
                      )
                    }
                  >
                    {binding.status === 'active' ? 'Disable' : 'Enable'}
                  </Button>
                </div>,
              ])}
            />
          </Panel>
        </TabsContent>

        <TabsContent value="editor">
          <Panel
            title="Binding Editor"
            description="Secrets are stored as refs and never displayed."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Plugin ID"
                value={draft.pluginId}
                onChange={(pluginId) => setDraft({ ...draft, pluginId })}
              />
              <Field
                label="Service Name"
                value={draft.serviceName}
                onChange={(serviceName) => setDraft({ ...draft, serviceName })}
              />
              <Field
                label="Base URL"
                value={draft.baseUrl}
                onChange={(baseUrl) => setDraft({ ...draft, baseUrl })}
              />
              <Field
                label="Environment"
                value={draft.environment}
                onChange={(environment) => setDraft({ ...draft, environment })}
              />
              <div className="space-y-2">
                <Label>Scope</Label>
                <Select
                  value={draft.scopeType}
                  onValueChange={(scopeType) =>
                    setDraft({ ...draft, scopeType: scopeType as BindingDraft['scopeType'] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">global</SelectItem>
                    <SelectItem value="workspace">workspace</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Field
                label="Workspace ID"
                value={draft.scopeId}
                onChange={(scopeId) => setDraft({ ...draft, scopeId })}
              />
              <div className="space-y-2">
                <Label>Auth Type</Label>
                <Select
                  value={draft.authType}
                  onValueChange={(authType) =>
                    setDraft({ ...draft, authType: authType as BindingDraft['authType'] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">none</SelectItem>
                    <SelectItem value="bearer">bearer</SelectItem>
                    <SelectItem value="basic">basic</SelectItem>
                    <SelectItem value="apiKey">apiKey</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Field
                label="Auth Secret Ref"
                value={draft.authSecretRef}
                onChange={(authSecretRef) => setDraft({ ...draft, authSecretRef })}
              />
              <Field
                label="New Auth Secret"
                type="password"
                value={draft.authSecretValue}
                onChange={(authSecretValue) => setDraft({ ...draft, authSecretValue })}
              />
              {draft.authType === 'basic' && (
                <>
                  <Field
                    label="Basic Username Ref"
                    value={draft.authUsernameRef}
                    onChange={(authUsernameRef) => setDraft({ ...draft, authUsernameRef })}
                  />
                  <Field
                    label="New Basic Username"
                    type="password"
                    value={draft.authUsernameValue}
                    onChange={(authUsernameValue) => setDraft({ ...draft, authUsernameValue })}
                  />
                  <Field
                    label="Basic Password Ref"
                    value={draft.authPasswordRef}
                    onChange={(authPasswordRef) => setDraft({ ...draft, authPasswordRef })}
                  />
                  <Field
                    label="New Basic Password"
                    type="password"
                    value={draft.authPasswordValue}
                    onChange={(authPasswordValue) => setDraft({ ...draft, authPasswordValue })}
                  />
                </>
              )}
              <Field
                label="Auth Header"
                value={draft.authHeaderName}
                onChange={(authHeaderName) => setDraft({ ...draft, authHeaderName })}
              />
              <div className="flex h-10 items-center justify-between rounded-md border px-3">
                <Label>Actor Claims</Label>
                <Switch
                  checked={draft.actorClaimsEnabled}
                  onCheckedChange={(actorClaimsEnabled) =>
                    setDraft({ ...draft, actorClaimsEnabled })
                  }
                />
              </div>
              <Field
                label="Actor Audience"
                value={draft.actorClaimsAudience}
                onChange={(actorClaimsAudience) =>
                  setDraft({
                    ...draft,
                    actorClaimsAudience,
                    actorClaimsEnabled: !!actorClaimsAudience || draft.actorClaimsEnabled,
                  })
                }
              />
              <Field
                label="Actor Secret Ref"
                value={draft.actorClaimsSecretRef}
                onChange={(actorClaimsSecretRef) => setDraft({ ...draft, actorClaimsSecretRef })}
              />
              <Field
                label="New Actor Secret"
                type="password"
                value={draft.actorClaimsSecretValue}
                onChange={(actorClaimsSecretValue) =>
                  setDraft({
                    ...draft,
                    actorClaimsSecretValue,
                    actorClaimsEnabled: !!actorClaimsSecretValue || draft.actorClaimsEnabled,
                  })
                }
              />
              <Field
                label="Timeout ms"
                value={draft.timeoutMs}
                onChange={(timeoutMs) => setDraft({ ...draft, timeoutMs })}
              />
              <Field
                label="Retry Attempts"
                value={draft.retryAttempts}
                onChange={(retryAttempts) => setDraft({ ...draft, retryAttempts })}
              />
              <Field
                label="Max Response Bytes"
                value={draft.maxResponseBytes}
                onChange={(maxResponseBytes) => setDraft({ ...draft, maxResponseBytes })}
              />
              <Field
                label="Health Path"
                value={draft.healthPath}
                onChange={(healthPath) => setDraft({ ...draft, healthPath })}
              />
            </div>
            <div className="mt-4 flex justify-end">
              <Button disabled={acting === 'save'} onClick={() => void saveBinding()}>
                Save Binding
              </Button>
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="logs">
          <Panel
            title="Service Call Logs"
            description="Redacted host-side service invocation records."
          >
            <DataTable
              loading={loading}
              empty="No service calls."
              headers={['Service', 'Method', 'Path Template', 'Status', 'Duration', 'Created']}
              rows={logs.map((log) => [
                `${log.pluginId}:${log.serviceName}`,
                log.method,
                log.pathTemplate ?? log.path,
                log.status ?? log.errorCode ?? 'error',
                log.durationMs == null ? '-' : `${log.durationMs} ms`,
                formatDate(log.createdAt),
              ])}
            />
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-end">
              <div className="w-full sm:w-40">
                <Field
                  label="Retention Days"
                  type="number"
                  value={retentionDays}
                  onChange={setRetentionDays}
                />
              </div>
              <Button
                variant="outline"
                disabled={acting === 'retention'}
                onClick={() => void runRetention()}
              >
                Apply Retention
              </Button>
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="resources">
          <Panel title="Resource Bindings" description="Plugin-owned resource links by scope.">
            <DataTable
              loading={loading}
              empty="No resource bindings."
              headers={['Plugin', 'Scope', 'Resource', 'Cardinality', 'Status', 'Updated']}
              rows={resourceBindings.map((binding) => [
                binding.pluginId,
                `${binding.scopeType}:${binding.scopeId}`,
                `${binding.resourceType}:${binding.resourceId}`,
                binding.cardinality,
                <Badge key="status" variant={statusVariant(binding.status)}>
                  {binding.status}
                </Badge>,
                formatDate(binding.updatedAt),
              ])}
            />
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

function Identity({ title, detail }: { title: string; detail: string }) {
  return (
    <div>
      <div className="max-w-[260px] truncate font-medium">{title}</div>
      <div className="max-w-[260px] truncate font-mono text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function DataTable({
  loading,
  empty,
  headers,
  rows,
}: {
  loading: boolean;
  empty: string;
  headers: string[];
  rows: React.ReactNode[][];
}) {
  if (loading) {
    return <div className="py-10 text-center text-sm text-muted-foreground">Loading...</div>;
  }
  if (rows.length === 0) {
    return <div className="py-10 text-center text-sm text-muted-foreground">{empty}</div>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {headers.map((header, index) => (
            <TableHead key={header} className={index === headers.length - 1 ? 'text-right' : ''}>
              {header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, rowIndex) => (
          <TableRow key={rowIndex}>
            {row.map((cell, cellIndex) => (
              <TableCell
                key={cellIndex}
                className={cellIndex === row.length - 1 ? 'text-right' : ''}
              >
                {cell}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
