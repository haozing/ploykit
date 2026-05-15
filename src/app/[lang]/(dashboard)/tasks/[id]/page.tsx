import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, Database, FileArchive, Gauge, Network, TerminalSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { requireAuth } from '@/lib/shared/role-check';
import {
  getUserPluginTask,
  type PluginTaskDetail,
} from '@/lib/plugin-runtime/tasks/task-center.server';
import { CancelTaskButton } from './cancel-task-button';

export const dynamic = 'force-dynamic';

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'succeeded') return 'default';
  if (status === 'failed' || status === 'cancelled') return 'destructive';
  if (status === 'running' || status === 'waiting_external' || status === 'cancel_requested') {
    return 'secondary';
  }
  return 'outline';
}

function formatDate(value: string | undefined, locale: string, fallback: string): string {
  return value ? new Date(value).toLocaleString(locale) : fallback;
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function isCancelable(task: PluginTaskDetail): boolean {
  return ['queued', 'running', 'waiting_external'].includes(task.status);
}

export default async function PluginTaskDetailPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const [user, resolvedParams] = await Promise.all([requireAuth(), params]);
  const t = await getTranslations('dashboard.taskDetail');
  const task = await getUserPluginTask(user.id, resolvedParams.id);
  const locale = resolvedParams.lang === 'zh' ? 'zh-CN' : 'en-US';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3">
            <Link href={`/${resolvedParams.lang}/tasks`}>
              <ArrowLeft className="h-4 w-4" />
              {t('actions.backToTasks')}
            </Link>
          </Button>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">{task.title}</h1>
            <Badge variant={statusVariant(task.status)}>{task.status}</Badge>
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{task.id}</p>
        </div>
        <CancelTaskButton taskId={task.id} disabled={!isCancelable(task)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('overview.title')}</CardTitle>
          <CardDescription>
            {t('overview.description', {
              pluginName: task.pluginName,
              pluginId: task.pluginId,
              updatedAt: formatDate(task.updatedAt, locale, t('never')),
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Progress value={task.progress} className="h-2" />
            <span className="w-12 text-right text-sm text-muted-foreground">{task.progress}%</span>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <Detail
              label={t('overview.created')}
              value={formatDate(task.createdAt, locale, t('never'))}
            />
            <Detail
              label={t('overview.started')}
              value={formatDate(task.startedAt, locale, t('never'))}
            />
            <Detail
              label={t('overview.finished')}
              value={formatDate(task.finishedAt, locale, t('never'))}
            />
            <Detail
              label={t('overview.cancel')}
              value={task.cancelReason ?? t('overview.notRequested')}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <TerminalSquare className="h-4 w-4" />
              {t('logs.title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {task.logs.length === 0 ? (
              <Empty label={t('empty.noRecords')} />
            ) : (
              <div className="space-y-2">
                {task.logs.map((log) => (
                  <div key={log.id} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={statusVariant(log.level)}>{log.level}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(log.createdAt, locale, t('never'))}
                      </span>
                    </div>
                    <p className="mt-2 text-sm">{log.message}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileArchive className="h-4 w-4" />
              {t('files.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <SimpleTable
              columns={[
                t('files.columns.name'),
                t('files.columns.purpose'),
                t('files.columns.status'),
                t('files.columns.size'),
              ]}
              rows={task.files.map((file) => [
                file.fileName,
                file.purpose,
                file.status,
                t('files.bytes', { count: file.size.toLocaleString(locale) }),
              ])}
              emptyLabel={t('empty.noRecords')}
            />
            <SimpleTable
              columns={[
                t('results.columns.type'),
                t('results.columns.ref'),
                t('results.columns.created'),
              ]}
              rows={task.results.map((result) => [
                result.type,
                result.ref,
                formatDate(result.createdAt, locale, t('never')),
              ])}
              emptyLabel={t('empty.noRecords')}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Network className="h-4 w-4" />
              {t('connectorCalls.title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SimpleTable
              columns={[
                t('connectorCalls.columns.connector'),
                t('connectorCalls.columns.status'),
                t('connectorCalls.columns.duration'),
                t('connectorCalls.columns.credits'),
              ]}
              rows={task.connectorCalls.map((call) => [
                call.connectorName,
                call.status == null ? 'error' : String(call.status),
                call.durationMs == null
                  ? '-'
                  : t('connectorCalls.durationMs', {
                      count: call.durationMs.toLocaleString(locale),
                    }),
                call.creditsConsumed.toLocaleString(locale),
              ])}
              emptyLabel={t('empty.noRecords')}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Gauge className="h-4 w-4" />
              {t('usage.title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SimpleTable
              columns={[
                t('usage.columns.meter'),
                t('usage.columns.metric'),
                t('usage.columns.value'),
                t('usage.columns.recorded'),
              ]}
              rows={task.usage.map((record) => [
                record.meter ?? record.metric,
                record.metric,
                `${record.value} ${record.unit}`,
                formatDate(record.recordedAt, locale, t('never')),
              ])}
              emptyLabel={t('empty.noRecords')}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Database className="h-4 w-4" />
            {t('metadata.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-3">
          <JsonBlock value={task.inputs} />
          <JsonBlock value={task.costs} />
          <JsonBlock value={{ metadata: task.metadata, error: task.error }} />
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm">{value}</div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="py-8 text-center text-sm text-muted-foreground">{label}</div>;
}

function SimpleTable({
  columns,
  rows,
  emptyLabel,
}: {
  columns: string[];
  rows: string[][];
  emptyLabel: string;
}) {
  if (rows.length === 0) return <Empty label={emptyLabel} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column}>{column}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={index}>
            {row.map((cell, cellIndex) => (
              <TableCell key={cellIndex} className="max-w-[260px] truncate">
                {cell}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
