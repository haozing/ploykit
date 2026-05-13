'use client';

import * as React from 'react';
import { formatDistance } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/_core/utils';
import type { AuditLog } from '@/hooks/use-audit-logs';
import { useTranslations } from 'next-intl';

interface AuditLogsTableProps {
  logs: AuditLog[];
  loading?: boolean;
  onViewDetails?: (log: AuditLog) => void;
  className?: string;
}

export function AuditLogsTable({
  logs,
  loading = false,
  onViewDetails,
  className,
}: AuditLogsTableProps) {
  const t = useTranslations();

  if (loading) {
    return (
      <div className={cn('space-y-3', className)}>
        {[...Array(10)].map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-muted/50 animate-pulse" />
        ))}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className={cn('rounded-lg border border-dashed p-12 text-center', className)}>
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <svg
            className="h-6 w-6 text-muted-foreground"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>
        <h3 className="mt-4 text-lg font-semibold">{t('dashboard.auditLogs.table.empty.title')}</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('dashboard.auditLogs.table.empty.description')}
        </p>
      </div>
    );
  }

  return (
    <div className={cn('rounded-lg border', className)}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[180px]">
              {t('dashboard.auditLogs.table.columns.time')}
            </TableHead>
            <TableHead>{t('dashboard.auditLogs.table.columns.user')}</TableHead>
            <TableHead>{t('dashboard.auditLogs.table.columns.action')}</TableHead>
            <TableHead>{t('dashboard.auditLogs.table.columns.resource')}</TableHead>
            <TableHead className="w-[100px]">
              {t('dashboard.auditLogs.table.columns.status')}
            </TableHead>
            <TableHead className="w-[100px]">
              {t('dashboard.auditLogs.table.columns.ipAddress')}
            </TableHead>
            <TableHead className="w-[100px] text-right">
              {t('dashboard.auditLogs.table.columns.actions')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log) => (
            <TableRow key={log.id} className="group">
              <TableCell>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">
                    {formatDistance(log.createdAt, new Date(), { addSuffix: true })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {log.createdAt.toLocaleString()}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">
                    {log.userName || log.userEmail || log.userId}
                  </span>
                  {log.userEmail && log.userName && (
                    <span className="text-xs text-muted-foreground">{log.userEmail}</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <ActionBadge action={log.action} />
              </TableCell>
              <TableCell>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{log.resource}</span>
                  {log.resourceName && (
                    <span className="text-xs text-muted-foreground">{log.resourceName}</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <StatusBadge status={log.status} />
              </TableCell>
              <TableCell>
                <span className="text-xs text-muted-foreground font-mono">
                  {log.ipAddress || '-'}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onViewDetails?.(log)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {t('dashboard.auditLogs.table.viewDetails')}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Action badge with color coding
 */
function ActionBadge({ action }: { action: string }) {
  const getActionColor = (action: string): string => {
    if (action.includes('create')) return 'bg-success-100 text-success';
    if (action.includes('delete')) return 'bg-destructive-100 text-destructive';
    if (action.includes('update')) return 'bg-primary-100 text-primary';
    if (action.includes('assign') || action.includes('grant')) return 'bg-primary-100 text-primary';
    if (action.includes('revoke') || action.includes('remove'))
      return 'bg-warning-100 text-warning';
    return 'bg-muted text-muted-foreground';
  };

  return (
    <Badge variant="outline" className={cn('font-mono text-xs', getActionColor(action))}>
      {action}
    </Badge>
  );
}

/**
 * Status badge
 */
function StatusBadge({ status }: { status: 'success' | 'failure' }) {
  return (
    <Badge variant={status === 'success' ? 'default' : 'destructive'} className="text-xs">
      {status}
    </Badge>
  );
}

/**
 * Compact audit log row for mobile/small screens
 */
export function AuditLogCard({
  log,
  onViewDetails,
}: {
  log: AuditLog;
  onViewDetails?: (log: AuditLog) => void;
}) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <ActionBadge action={log.action} />
            <StatusBadge status={log.status} />
          </div>
          <p className="text-sm font-medium">{log.userName || log.userEmail || log.userId}</p>
          <p className="text-xs text-muted-foreground">
            {log.resource} • {log.resourceName || 'N/A'}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onViewDetails?.(log)}>
          Details
        </Button>
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>{formatDistance(log.createdAt, new Date(), { addSuffix: true })}</span>
        {log.ipAddress && <span className="font-mono">{log.ipAddress}</span>}
      </div>
    </div>
  );
}
