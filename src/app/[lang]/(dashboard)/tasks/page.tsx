import Link from 'next/link';
import { Activity, Clock3, ExternalLink, FileText, RefreshCw } from 'lucide-react';
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
  listUserPluginTasks,
  type PluginTaskSummary,
} from '@/lib/plugin-runtime/tasks/task-center.server';

export const dynamic = 'force-dynamic';

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'succeeded') return 'default';
  if (status === 'failed' || status === 'cancelled') return 'destructive';
  if (status === 'running' || status === 'waiting_external' || status === 'cancel_requested') {
    return 'secondary';
  }
  return 'outline';
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function activeCount(tasks: PluginTaskSummary[]): number {
  return tasks.filter((task) =>
    ['queued', 'running', 'waiting_external', 'cancel_requested'].includes(task.status)
  ).length;
}

export default async function PluginTasksPage({ params }: { params: Promise<{ lang: string }> }) {
  const [user, resolvedParams] = await Promise.all([requireAuth(), params]);
  const tasks = await listUserPluginTasks(user.id, {
    limit: 50,
    offset: 0,
    includeInternal: false,
  });
  const lang = resolvedParams.lang;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Task Center</h1>
          <p className="text-muted-foreground">
            User-visible plugin runs, generated files, connector calls, and metering records.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/${lang}/tasks`}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardDescription>Total Tasks</CardDescription>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tasks.length.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardDescription>Active</CardDescription>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeCount(tasks).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardDescription>Last Updated</CardDescription>
            <Clock3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-medium">
              {tasks[0] ? formatDate(tasks[0].updatedAt) : 'No task yet'}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Plugin Tasks</CardTitle>
          <CardDescription>
            Only runs declared as user-visible by plugins appear here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No user-visible plugin tasks yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Plugin</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="min-w-[180px]">Progress</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell>
                      <div className="font-medium">{task.title}</div>
                      <div className="max-w-[260px] truncate font-mono text-xs text-muted-foreground">
                        {task.id}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>{task.pluginName}</div>
                      <div className="font-mono text-xs text-muted-foreground">{task.pluginId}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(task.status)}>{task.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Progress value={task.progress} className="h-2" />
                        <span className="w-10 text-right text-xs text-muted-foreground">
                          {task.progress}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(task.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/${lang}/tasks/${task.id}`}>
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
