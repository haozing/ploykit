'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/shared/auth-client';
import type { Pagination } from './types/common';

/**
 * Audit Logs Hook
 *
 * React hook for querying and managing audit logs
 *
 * Usage:
 * ```tsx
 * const { logs, pagination, loading, refetch } = useAuditLogs({
 *   userId,
 *   page: 1,
 *   limit: 50
 * });
 * ```
 */

export interface AuditLogFilters {
  userId?: string;
  action?: string;
  resource?: string;
  status?: 'success' | 'failure';
  search?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}

export interface AuditLog {
  id: string;
  userId: string;
  userEmail?: string;
  userName?: string;
  action: string;
  resource: string;
  resourceId?: string;
  resourceName?: string;
  ipAddress?: string;
  userAgent?: string;
  status: 'success' | 'failure';
  errorMessage?: string;
  errorStack?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface AuditLogStats {
  total: number;
  success: number;
  failure: number;
  byAction: Array<{ action: string; count: number }>;
  byResource: Array<{ resource: string; count: number }>;
}

interface UseAuditLogsResult {
  logs: AuditLog[];
  pagination: Pagination | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  setFilters: (filters: AuditLogFilters) => void;
}

export function useAuditLogs(initialFilters: AuditLogFilters = {}): UseAuditLogsResult {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [filters, setFilters] = useState<AuditLogFilters>(initialFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Build query string
      const params = new URLSearchParams();

      if (filters.userId) params.append('userId', filters.userId);
      if (filters.action) params.append('action', filters.action);
      if (filters.resource) params.append('resource', filters.resource);
      if (filters.status) params.append('status', filters.status);
      if (filters.search) params.append('search', filters.search);
      if (filters.startDate) params.append('startDate', filters.startDate.toISOString());
      if (filters.endDate) params.append('endDate', filters.endDate.toISOString());
      if (filters.page) params.append('page', filters.page.toString());
      if (filters.limit) params.append('limit', filters.limit.toString());

      const response = await apiFetch(`/api/admin/audit-logs?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch audit logs: ${response.statusText}`);
      }

      const data = await response.json();

      setLogs(
        data.logs.map((log: { createdAt: string }) => ({
          ...log,
          createdAt: new Date(log.createdAt),
        }))
      );
      setPagination(data.pagination);
    } catch (error) {
      setError(error instanceof Error ? error : new Error('Failed to fetch audit logs'));
      setLogs([]);
      setPagination(null);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  return {
    logs,
    pagination,
    loading,
    error,
    refetch: fetchLogs,
    setFilters,
  };
}

/**
 * Hook for getting audit log statistics
 */
export function useAuditLogStats(
  filters: {
    startDate?: Date;
    endDate?: Date;
  } = {}
) {
  const [stats, setStats] = useState<AuditLogStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (filters.startDate) params.append('startDate', filters.startDate.toISOString());
      if (filters.endDate) params.append('endDate', filters.endDate.toISOString());

      const response = await apiFetch(`/api/admin/audit-logs/stats?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch stats: ${response.statusText}`);
      }

      const data = await response.json();
      setStats(data);
    } catch (error) {
      setError(error instanceof Error ? error : new Error('Failed to fetch stats'));
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [filters.startDate, filters.endDate]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  return { stats, loading, error, refetch: fetchStats };
}

/**
 * Hook for getting a single audit log by ID
 */
export function useAuditLog(id: string | null) {
  const [log, setLog] = useState<AuditLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchLog = useCallback(async () => {
    if (!id) {
      setLog(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await apiFetch(`/api/admin/audit-logs/${id}`);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Audit log not found');
        }
        throw new Error(`Failed to fetch audit log: ${response.statusText}`);
      }

      const data = await response.json();
      setLog({
        ...data,
        createdAt: new Date(data.createdAt),
      });
    } catch (error) {
      setError(error instanceof Error ? error : new Error('Failed to fetch audit log'));
      setLog(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchLog();
  }, [fetchLog]);

  return { log, loading, error, refetch: fetchLog };
}

/**
 * Export audit logs
 */
export async function exportAuditLogs(
  format: 'csv' | 'json',
  filters: AuditLogFilters = {}
): Promise<void> {
  const params = new URLSearchParams();
  params.append('format', format);

  if (filters.userId) params.append('userId', filters.userId);
  if (filters.action) params.append('action', filters.action);
  if (filters.resource) params.append('resource', filters.resource);
  if (filters.status) params.append('status', filters.status);
  if (filters.search) params.append('search', filters.search);
  if (filters.startDate) params.append('startDate', filters.startDate.toISOString());
  if (filters.endDate) params.append('endDate', filters.endDate.toISOString());
  if (filters.limit) params.append('limit', filters.limit.toString());

  // Trigger download
  const url = `/api/admin/audit-logs/export?${params.toString()}`;
  window.open(url, '_blank');
}
