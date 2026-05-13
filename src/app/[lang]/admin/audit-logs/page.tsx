'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Download, FileJson } from 'lucide-react';
import {
  useAuditLogs,
  useAuditLogStats,
  exportAuditLogs,
  type AuditLog,
  type AuditLogFilters,
} from '@/hooks/use-audit-logs';
import { AuditLogsTable } from '@/components/audit-logs/audit-logs-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslations } from 'next-intl';

/**
 * Audit Logs Page
 *
 * View and filter audit logs with:
 * - Search and filters
 * - Statistics dashboard
 * - Export functionality
 * - Detail view
 */
export default function AuditLogsPage() {
  const t = useTranslations();
  const [filters, setFilters] = useState<AuditLogFilters>({ page: 1, limit: 50 });
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const { logs, pagination, loading, setFilters: updateFilters } = useAuditLogs(filters);
  const { stats, loading: statsLoading } = useAuditLogStats({});

  const handleFilterChange = (key: keyof AuditLogFilters, value: string | number | undefined) => {
    const newFilters = { ...filters, [key]: value, page: 1 };
    setFilters(newFilters);
    updateFilters(newFilters);
  };

  const handlePageChange = (page: number) => {
    const newFilters = { ...filters, page };
    setFilters(newFilters);
    updateFilters(newFilters);
  };

  const handleExport = (format: 'csv' | 'json') => {
    exportAuditLogs(format, filters);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t('dashboard.auditLogs.page.title')}
          </h1>
          <p className="text-muted-foreground">{t('dashboard.auditLogs.page.description')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => handleExport('csv')}>
            <Download className="mr-2 h-4 w-4" />
            {t('dashboard.auditLogs.page.exportCsv')}
          </Button>
          <Button variant="outline" onClick={() => handleExport('json')}>
            <FileJson className="mr-2 h-4 w-4" />
            {t('dashboard.auditLogs.page.exportJson')}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="logs" className="space-y-4">
        <TabsList>
          <TabsTrigger value="logs">{t('dashboard.auditLogs.page.tabs.logs')}</TabsTrigger>
          <TabsTrigger value="stats">{t('dashboard.auditLogs.page.tabs.statistics')}</TabsTrigger>
        </TabsList>

        {/* Logs Tab */}
        <TabsContent value="logs" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardHeader>
              <CardTitle>{t('dashboard.auditLogs.page.filters.title')}</CardTitle>
              <CardDescription>{t('dashboard.auditLogs.page.filters.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {/* Search */}
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    {t('dashboard.auditLogs.page.filters.search.label')}
                  </label>
                  <Input
                    placeholder={t('dashboard.auditLogs.page.filters.search.placeholder')}
                    value={filters.search || ''}
                    onChange={(e) => handleFilterChange('search', e.target.value)}
                  />
                </div>

                {/* Action */}
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    {t('dashboard.auditLogs.page.filters.action.label')}
                  </label>
                  <Select
                    value={filters.action || 'all'}
                    onValueChange={(v) => handleFilterChange('action', v === 'all' ? undefined : v)}
                  >
                    <SelectTrigger aria-label={t('dashboard.auditLogs.page.filters.action.label')}>
                      <SelectValue
                        placeholder={t('dashboard.auditLogs.page.filters.action.allActions')}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {t('dashboard.auditLogs.page.filters.action.allActions')}
                      </SelectItem>
                      <SelectItem value="user.create">
                        {t('dashboard.auditLogs.page.actions.userCreate')}
                      </SelectItem>
                      <SelectItem value="user.update">
                        {t('dashboard.auditLogs.page.actions.userUpdate')}
                      </SelectItem>
                      <SelectItem value="user.delete">
                        {t('dashboard.auditLogs.page.actions.userDelete')}
                      </SelectItem>
                      <SelectItem value="role.assign">
                        {t('dashboard.auditLogs.page.actions.roleAssign')}
                      </SelectItem>
                      <SelectItem value="role.revoke">
                        {t('dashboard.auditLogs.page.actions.roleRevoke')}
                      </SelectItem>
                      <SelectItem value="plugin.install">
                        {t('dashboard.auditLogs.page.actions.pluginInstall')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Resource */}
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    {t('dashboard.auditLogs.page.filters.resource.label')}
                  </label>
                  <Select
                    value={filters.resource || 'all'}
                    onValueChange={(v) =>
                      handleFilterChange('resource', v === 'all' ? undefined : v)
                    }
                  >
                    <SelectTrigger
                      aria-label={t('dashboard.auditLogs.page.filters.resource.label')}
                    >
                      <SelectValue
                        placeholder={t('dashboard.auditLogs.page.filters.resource.allResources')}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {t('dashboard.auditLogs.page.filters.resource.allResources')}
                      </SelectItem>
                      <SelectItem value="user">
                        {t('dashboard.auditLogs.page.resources.user')}
                      </SelectItem>
                      <SelectItem value="role">
                        {t('dashboard.auditLogs.page.resources.role')}
                      </SelectItem>
                      <SelectItem value="plugin">
                        {t('dashboard.auditLogs.page.resources.plugin')}
                      </SelectItem>
                      <SelectItem value="entitlement">
                        {t('dashboard.auditLogs.page.resources.entitlement')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Status */}
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    {t('dashboard.auditLogs.page.filters.status.label')}
                  </label>
                  <Select
                    value={filters.status || 'all'}
                    onValueChange={(v) =>
                      handleFilterChange(
                        'status',
                        v === 'all' ? undefined : (v as 'success' | 'failure')
                      )
                    }
                  >
                    <SelectTrigger aria-label={t('dashboard.auditLogs.page.filters.status.label')}>
                      <SelectValue
                        placeholder={t('dashboard.auditLogs.page.filters.status.allStatuses')}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {t('dashboard.auditLogs.page.filters.status.allStatuses')}
                      </SelectItem>
                      <SelectItem value="success">
                        {t('dashboard.auditLogs.page.filters.status.success')}
                      </SelectItem>
                      <SelectItem value="failure">
                        {t('dashboard.auditLogs.page.filters.status.failure')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Audit Logs Table */}
          <AuditLogsTable logs={logs} loading={loading} onViewDetails={setSelectedLog} />

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {t('dashboard.auditLogs.page.pagination.showing', {
                  from: (pagination.page - 1) * pagination.limit + 1,
                  to: Math.min(pagination.page * pagination.limit, pagination.total),
                  total: pagination.total,
                })}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page === 1}
                  onClick={() => handlePageChange(pagination.page - 1)}
                >
                  {t('dashboard.auditLogs.page.pagination.previous')}
                </Button>
                <span className="text-sm">
                  {t('dashboard.auditLogs.page.pagination.page', {
                    current: pagination.page,
                    total: pagination.totalPages,
                  })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page === pagination.totalPages}
                  onClick={() => handlePageChange(pagination.page + 1)}
                >
                  {t('dashboard.auditLogs.page.pagination.next')}
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Statistics Tab */}
        <TabsContent value="stats" className="space-y-4">
          {statsLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-32 rounded-lg bg-muted/50 animate-pulse" />
              ))}
            </div>
          ) : stats ? (
            <>
              {/* Stats Cards */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      {t('dashboard.auditLogs.page.stats.totalLogs')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{stats.total.toLocaleString()}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      {t('dashboard.auditLogs.page.stats.success')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-success">
                      {stats.success.toLocaleString()}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {((stats.success / stats.total) * 100).toFixed(1)}%
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      {t('dashboard.auditLogs.page.stats.failures')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-destructive">
                      {stats.failure.toLocaleString()}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {((stats.failure / stats.total) * 100).toFixed(1)}%
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      {t('dashboard.auditLogs.page.stats.successRate')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {((stats.success / stats.total) * 100).toFixed(1)}%
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Top Actions and Resources */}
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('dashboard.auditLogs.page.stats.topActions')}</CardTitle>
                    <CardDescription>
                      {t('dashboard.auditLogs.page.stats.topActionsDescription')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {stats.byAction.map((item, index) => (
                        <div key={index} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-mono text-xs">
                              {item.action}
                            </Badge>
                          </div>
                          <span className="text-sm font-medium">{item.count.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>{t('dashboard.auditLogs.page.stats.topResources')}</CardTitle>
                    <CardDescription>
                      {t('dashboard.auditLogs.page.stats.topResourcesDescription')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {stats.byResource.map((item, index) => (
                        <div key={index} className="flex items-center justify-between">
                          <Badge variant="secondary">{item.resource}</Badge>
                          <span className="text-sm font-medium">{item.count.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          ) : null}
        </TabsContent>
      </Tabs>

      {/* Detail Dialog */}
      {selectedLog && (
        <AuditLogDetailDialog
          log={selectedLog}
          open={!!selectedLog}
          onOpenChange={(open) => !open && setSelectedLog(null)}
        />
      )}
    </div>
  );
}

/**
 * Audit log detail dialog
 */
function AuditLogDetailDialog({
  log,
  open,
  onOpenChange,
}: {
  log: AuditLog;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('dashboard.auditLogs.page.detail.title')}</DialogTitle>
          <DialogDescription>{log.createdAt.toLocaleString()}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* User Info */}
          <div>
            <h4 className="text-sm font-semibold mb-2">
              {t('dashboard.auditLogs.page.detail.userInfo')}
            </h4>
            <div className="grid gap-2 rounded-lg border p-3">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">
                  {t('dashboard.auditLogs.page.detail.userId')}:
                </span>
                <span className="text-sm font-mono">{log.userId}</span>
              </div>
              {log.userName && (
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t('dashboard.auditLogs.page.detail.name')}:
                  </span>
                  <span className="text-sm">{log.userName}</span>
                </div>
              )}
              {log.userEmail && (
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t('dashboard.auditLogs.page.detail.email')}:
                  </span>
                  <span className="text-sm">{log.userEmail}</span>
                </div>
              )}
            </div>
          </div>

          {/* Action & Resource */}
          <div>
            <h4 className="text-sm font-semibold mb-2">
              {t('dashboard.auditLogs.page.detail.actionResource')}
            </h4>
            <div className="grid gap-2 rounded-lg border p-3">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">
                  {t('dashboard.auditLogs.page.detail.action')}:
                </span>
                <Badge variant="outline" className="font-mono">
                  {log.action}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">
                  {t('dashboard.auditLogs.page.detail.resource')}:
                </span>
                <span className="text-sm">{log.resource}</span>
              </div>
              {log.resourceId && (
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t('dashboard.auditLogs.page.detail.resourceId')}:
                  </span>
                  <span className="text-sm font-mono">{log.resourceId}</span>
                </div>
              )}
              {log.resourceName && (
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t('dashboard.auditLogs.page.detail.resourceName')}:
                  </span>
                  <span className="text-sm">{log.resourceName}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">
                  {t('dashboard.auditLogs.page.detail.status')}:
                </span>
                <Badge variant={log.status === 'success' ? 'default' : 'destructive'}>
                  {log.status}
                </Badge>
              </div>
            </div>
          </div>

          {/* Request Info */}
          <div>
            <h4 className="text-sm font-semibold mb-2">
              {t('dashboard.auditLogs.page.detail.requestInfo')}
            </h4>
            <div className="grid gap-2 rounded-lg border p-3">
              {log.ipAddress && (
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t('dashboard.auditLogs.page.detail.ipAddress')}:
                  </span>
                  <span className="text-sm font-mono">{log.ipAddress}</span>
                </div>
              )}
              {log.userAgent && (
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">
                    {t('dashboard.auditLogs.page.detail.userAgent')}:
                  </span>
                  <span className="text-xs font-mono text-muted-foreground break-all">
                    {log.userAgent}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Error Info (if failed) */}
          {log.status === 'failure' && log.errorMessage && (
            <div>
              <h4 className="text-sm font-semibold mb-2 text-destructive">
                {t('dashboard.auditLogs.page.detail.errorDetails')}
              </h4>
              <div className="rounded-lg border border-destructive bg-destructive-50 p-3">
                <p className="text-sm text-destructive-foreground">{log.errorMessage}</p>
                {log.errorStack && (
                  <pre className="mt-2 text-xs text-destructive-foreground font-mono overflow-x-auto whitespace-pre-wrap">
                    {log.errorStack}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* Metadata */}
          {log.metadata && Object.keys(log.metadata).length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2">
                {t('dashboard.auditLogs.page.detail.metadata')}
              </h4>
              <AuditMetadataView metadata={log.metadata} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AuditMetadataView({ metadata }: { metadata: Record<string, unknown> }) {
  const entries = Object.entries(metadata);
  const sensitiveCount = entries.filter(([key]) => isSensitiveMetadataKey(key)).length;

  return (
    <div className="space-y-3">
      {sensitiveCount > 0 ? (
        <div className="rounded-md border border-warning/40 bg-warning-50 px-3 py-2 text-xs text-warning-foreground">
          {sensitiveCount} sensitive metadata field{sensitiveCount === 1 ? '' : 's'} masked.
        </div>
      ) : null}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[220px]">Key</TableHead>
              <TableHead>Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map(([key, value]) => {
              const sensitive = isSensitiveMetadataKey(key);

              return (
                <TableRow key={key}>
                  <TableCell className="font-mono text-xs align-top">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{key}</span>
                      {sensitive ? (
                        <Badge variant="outline" className="text-[10px]">
                          masked
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
                      {sensitive ? '********' : formatMetadataValue(value)}
                    </pre>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function isSensitiveMetadataKey(key: string): boolean {
  return /(password|secret|token|api[-_]?key|authorization|credential|session|cookie)/i.test(key);
}

function formatMetadataValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value === null) {
    return 'null';
  }

  if (value === undefined) {
    return 'undefined';
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  return JSON.stringify(value, null, 2) ?? String(value);
}
