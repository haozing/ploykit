'use client';

import * as React from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Gauge,
  Network,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  AdminConnectorSummary,
  AdminMeterUsage,
  PluginOperationsSummary,
  PluginTaskConnectorCall,
  PluginTaskSummary,
  PluginTaskUsage,
} from '@/lib/plugin-runtime/tasks/task-center.server';

interface OperationsResponse {
  success?: boolean;
  summary?: PluginOperationsSummary;
  tasks?: PluginTaskSummary[];
  connectorCalls?: PluginTaskConnectorCall[];
  usage?: PluginTaskUsage[];
  meters?: AdminMeterUsage[];
}

interface ConnectorsResponse {
  success?: boolean;
  connectors?: AdminConnectorSummary[];
}

const emptySummary: PluginOperationsSummary = {
  runs: { total: 0, active: 0, failed: 0, succeeded: 0, cancelRequested: 0 },
  connectors: { total: 0, active: 0, disabled: 0, recentFailures: 0 },
  metering: { records: 0, totalAmount: 0 },
};

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'succeeded' || status === 'active' || status === 'prepared') return 'default';
  if (status === 'failed' || status === 'cancelled' || status === 'disabled') {
    return 'destructive';
  }
  if (status === 'running' || status === 'waiting_external' || status === 'cancel_requested') {
    return 'secondary';
  }
  return 'outline';
}

function formatDate(value?: string): string {
  return value ? new Date(value).toLocaleString() : 'Never';
}

export default function AdminPluginOperationsPage() {
  const [summary, setSummary] = React.useState<PluginOperationsSummary>(emptySummary);
  const [tasks, setTasks] = React.useState<PluginTaskSummary[]>([]);
  const [connectors, setConnectors] = React.useState<AdminConnectorSummary[]>([]);
  const [connectorCalls, setConnectorCalls] = React.useState<PluginTaskConnectorCall[]>([]);
  const [usage, setUsage] = React.useState<PluginTaskUsage[]>([]);
  const [meters, setMeters] = React.useState<AdminMeterUsage[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [acting, setActing] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async (quiet = false) => {
    if (quiet) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const [operationsResponse, connectorsResponse] = await Promise.all([
        apiFetch('/api/admin/plugin-operations?limit=50&includeInternal=true'),
        apiFetch('/api/admin/plugin-operations/connectors?limit=100'),
      ]);

      if (!operationsResponse.ok || !connectorsResponse.ok) {
        throw new Error('Failed to load plugin operations');
      }

      const operationsData = (await operationsResponse.json()) as OperationsResponse;
      const connectorsData = (await connectorsResponse.json()) as ConnectorsResponse;

      setSummary(operationsData.summary ?? emptySummary);
      setTasks(operationsData.tasks ?? []);
      setConnectorCalls(operationsData.connectorCalls ?? []);
      setUsage(operationsData.usage ?? []);
      setMeters(operationsData.meters ?? []);
      setConnectors(connectorsData.connectors ?? []);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load plugin operations');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function cancelRun(task: PluginTaskSummary) {
    const reason = window.prompt(`Cancel ${task.title}? Optional reason:`);
    if (reason === null) return;

    setActing(task.id);
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch(`/api/admin/plugin-operations/runs/${task.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      if (!response.ok) throw new Error('Cancel request failed');
      setMessage(`Run ${task.id} cancel requested.`);
      await refresh(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Cancel request failed');
    } finally {
      setActing(null);
    }
  }

  async function setConnectorStatus(
    connector: AdminConnectorSummary,
    status: 'active' | 'disabled'
  ) {
    setActing(`${connector.pluginId}:${connector.name}`);
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch('/api/admin/plugin-operations/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setStatus',
          pluginId: connector.pluginId,
          name: connector.name,
          status,
        }),
      });
      if (!response.ok) throw new Error('Connector update failed');
      setMessage(`Connector ${connector.pluginId}:${connector.name} set to ${status}.`);
      await refresh(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Connector update failed');
    } finally {
      setActing(null);
    }
  }

  async function rotateSecret(connector: AdminConnectorSummary) {
    const secretName = connector.secretName ?? window.prompt('Secret name:');
    if (!secretName) return;
    const value = window.prompt(`New value for ${secretName}:`);
    if (!value) return;

    setActing(`${connector.pluginId}:${connector.name}`);
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch('/api/admin/plugin-operations/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rotateSecret',
          pluginId: connector.pluginId,
          name: connector.name,
          secretName,
          value,
        }),
      });
      if (!response.ok) throw new Error('Secret rotation failed');
      setMessage(`Secret ${secretName} rotated for ${connector.pluginId}:${connector.name}.`);
      await refresh(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Secret rotation failed');
    } finally {
      setActing(null);
    }
  }

  async function testConnector(connector: AdminConnectorSummary) {
    setActing(`${connector.pluginId}:${connector.name}`);
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch('/api/admin/plugin-operations/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test',
          pluginId: connector.pluginId,
          name: connector.name,
          path: '/',
          method: 'GET',
        }),
      });
      if (!response.ok) throw new Error('Connector test failed');
      const data = (await response.json()) as { test?: { url?: string; status?: string } };
      setMessage(`Connector test prepared: ${data.test?.url ?? connector.baseUrl}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Connector test failed');
    } finally {
      setActing(null);
    }
  }

  const isActiveTask = (task: PluginTaskSummary) =>
    ['queued', 'running', 'waiting_external'].includes(task.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Plugin Operations</h1>
          <p className="text-muted-foreground">
            Runtime tasks, connector governance, and metering records for installed plugins.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={loading || refreshing}
          onClick={() => void refresh(true)}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Operation failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {message && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Operation complete</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Active Runs"
          value={summary.runs.active}
        />
        <StatCard
          icon={<AlertCircle className="h-4 w-4" />}
          label="Failed Runs"
          value={summary.runs.failed}
        />
        <StatCard
          icon={<Network className="h-4 w-4" />}
          label="Connectors"
          value={summary.connectors.total}
        />
        <StatCard
          icon={<Gauge className="h-4 w-4" />}
          label="Meter Records"
          value={summary.metering.records}
        />
      </div>

      <Tabs defaultValue="runs" className="space-y-4">
        <TabsList>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="connectors">Connectors</TabsTrigger>
          <TabsTrigger value="metering">Metering</TabsTrigger>
          <TabsTrigger value="calls">Calls</TabsTrigger>
        </TabsList>

        <TabsContent value="runs">
          <Card>
            <CardHeader>
              <CardTitle>Runtime Runs</CardTitle>
              <CardDescription>Admin-visible queue and task center state.</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                loading={loading}
                empty="No plugin runs."
                headers={['Task', 'Plugin', 'Status', 'Progress', 'Updated', 'Action']}
                rows={tasks.map((task) => [
                  <TaskCell key="task" task={task} />,
                  task.pluginId,
                  <Badge key="status" variant={statusVariant(task.status)}>
                    {task.status}
                  </Badge>,
                  `${task.progress}%`,
                  formatDate(task.updatedAt),
                  <Button
                    key="action"
                    variant="outline"
                    size="sm"
                    disabled={!isActiveTask(task) || acting === task.id}
                    onClick={() => void cancelRun(task)}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Cancel
                  </Button>,
                ])}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="connectors">
          <Card>
            <CardHeader>
              <CardTitle>Connector Governance</CardTitle>
              <CardDescription>Disable, test, or rotate connector credentials.</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                loading={loading}
                empty="No connectors."
                headers={['Connector', 'Base URL', 'Status', 'Auth', 'Updated', 'Action']}
                rows={connectors.map((connector) => {
                  const key = `${connector.pluginId}:${connector.name}`;
                  return [
                    <IdentityCell key="connector" id={connector.id} title={connector.name} />,
                    connector.baseUrl,
                    <Badge key="status" variant={statusVariant(connector.status)}>
                      {connector.status}
                    </Badge>,
                    connector.auth?.type ?? 'none',
                    formatDate(connector.updatedAt),
                    <div key="action" className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={acting === key}
                        onClick={() => void testConnector(connector)}
                      >
                        <ShieldCheck className="h-4 w-4" />
                        Test
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={acting === key}
                        onClick={() =>
                          void setConnectorStatus(
                            connector,
                            connector.status === 'active' ? 'disabled' : 'active'
                          )
                        }
                      >
                        {connector.status === 'active' ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={acting === key}
                        onClick={() => void rotateSecret(connector)}
                      >
                        Rotate
                      </Button>
                    </div>,
                  ];
                })}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="metering">
          <Card>
            <CardHeader>
              <CardTitle>Metering Summary</CardTitle>
              <CardDescription>Aggregated usage rows from plugin metering.</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                loading={loading}
                empty="No metering records."
                headers={['Plugin', 'Meter', 'Metric', 'Total', 'Records']}
                rows={meters.map((meter) => [
                  meter.pluginId,
                  meter.meter,
                  meter.metric,
                  `${meter.total} ${meter.unit}`,
                  meter.records.toLocaleString(),
                ])}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calls">
          <Card>
            <CardHeader>
              <CardTitle>Recent Connector Calls</CardTitle>
              <CardDescription>
                Connector audit trail with redacted request and response metadata.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                loading={loading}
                empty="No connector calls."
                headers={['Connector', 'Status', 'Duration', 'Meter', 'Created']}
                rows={connectorCalls.map((call) => [
                  `${call.pluginId}:${call.connectorName}`,
                  call.status == null ? 'error' : String(call.status),
                  call.durationMs == null ? '-' : `${call.durationMs} ms`,
                  call.meter ?? '-',
                  formatDate(call.createdAt),
                ])}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="sr-only">{usage.length} recent usage rows loaded.</div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription>{label}</CardDescription>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      </CardContent>
    </Card>
  );
}

function TaskCell({ task }: { task: PluginTaskSummary }) {
  return (
    <div>
      <div className="max-w-[260px] truncate font-medium">{task.title}</div>
      <div className="max-w-[260px] truncate font-mono text-xs text-muted-foreground">
        {task.id}
      </div>
    </div>
  );
}

function IdentityCell({ id, title }: { id: string; title: string }) {
  return (
    <div>
      <div className="max-w-[260px] truncate font-medium">{title}</div>
      <div className="max-w-[260px] truncate font-mono text-xs text-muted-foreground">{id}</div>
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
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, index) => (
          <div key={index} className="h-12 animate-pulse rounded bg-muted" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <div className="py-12 text-center text-sm text-muted-foreground">{empty}</div>;
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
                className={cellIndex === row.length - 1 ? 'text-right' : 'max-w-[280px] truncate'}
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
