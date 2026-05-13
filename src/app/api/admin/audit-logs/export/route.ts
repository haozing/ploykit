import { withAdminGuard, withErrorHandling, type AuthContext } from '@/lib/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { queryAuditLogs, type AuditLogFilters } from '@/lib/services/audit/audit-service';
import { ValidationError } from '@/lib/_core/errors';
import { hasPermissionIdentifier } from '@/lib/auth/permissions';
import { AUDIT_ACTIONS, auditLogDurable } from '@/lib/services/audit/audit-service';
import { getClientIP } from '@/lib/shared/api-helpers';

/**
 * GET /api/admin/audit-logs/export
 *
 * Export audit logs as CSV or JSON
 *
 * Query params:
 * - format: csv | json (default: csv)
 * - userId, action, resource, status, startDate, endDate (same as list endpoint)
 * - limit: number (max 10000, default: 1000)
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const GET = withAdminGuard(
  withErrorHandling(async (request: NextRequest, context) => {
    const { auth } = context as typeof context & { auth: AuthContext };
    const searchParams = request.nextUrl.searchParams;

    const format = searchParams.get('format') || 'csv';
    const requestedFields = (searchParams.get('fields') || '')
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean);
    const includeMetadata = searchParams.get('includeMetadata') === 'true';
    const includeSensitive = searchParams.get('includeSensitive') === 'true';
    const hasExportPermission = await hasPermissionIdentifier(auth.userId, 'audit:export:all');

    if (
      !hasExportPermission &&
      (includeMetadata || includeSensitive || requestedFields.length > 0)
    ) {
      throw new ValidationError('Field-level audit export requires audit:export:all', {
        field: 'fields',
        requiredPermission: 'audit:export:all',
      });
    }

    if (format !== 'csv' && format !== 'json') {
      throw new ValidationError('Invalid format. Must be "csv" or "json"', {
        field: 'format',
        allowedFormats: ['csv', 'json'],
      });
    }

    const limit = Number.parseInt(searchParams.get('limit') || '1000', 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
      throw new ValidationError('limit must be between 1 and 10000', {
        field: 'limit',
        minimum: 1,
        maximum: 10000,
      });
    }

    // Parse filters
    const filters: AuditLogFilters = {
      userId: searchParams.get('userId') || undefined,
      action: searchParams.get('action') || undefined,
      resource: searchParams.get('resource') || undefined,
      status: (searchParams.get('status') as 'success' | 'failure') || undefined,
      search: searchParams.get('search') || undefined,
      page: 1,
      limit,
    };

    // Parse dates
    const startDateStr = searchParams.get('startDate');
    const endDateStr = searchParams.get('endDate');

    if (startDateStr) {
      filters.startDate = new Date(startDateStr);
    }

    if (endDateStr) {
      filters.endDate = new Date(endDateStr);
    }

    // Query audit logs
    const result = await queryAuditLogs(filters);
    const watermark = buildWatermark(auth.userId, auth.userEmail);
    const exportFields = selectExportFields(requestedFields, includeMetadata);
    const exportLogs = result.logs.map((log) =>
      projectAuditLog(log, exportFields, includeSensitive)
    );

    await auditLogDurable({
      userId: auth.userId,
      userEmail: auth.userEmail,
      action: AUDIT_ACTIONS.AUDIT_EXPORT,
      resource: 'audit_log',
      status: 'success',
      ipAddress: getClientIP(request),
      metadata: {
        format,
        limit,
        fields: exportFields,
        includeSensitive,
        watermark,
      },
    });

    if (format === 'json') {
      // Return as JSON
      return NextResponse.json(
        {
          watermark,
          exportedAt: new Date().toISOString(),
          logs: exportLogs,
        },
        {
          status: 200,
          headers: {
            'Content-Disposition': `attachment; filename="audit-logs-${new Date().toISOString()}.json"`,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    // Convert to CSV
    const csv = convertToCSV(exportLogs, watermark);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Disposition': `attachment; filename="audit-logs-${new Date().toISOString()}.csv"`,
        'Content-Type': 'text/csv',
      },
    });
  })
);

/**
 * Convert audit logs to CSV format
 */
const DEFAULT_EXPORT_FIELDS = [
  'id',
  'createdAt',
  'userId',
  'userEmail',
  'userName',
  'action',
  'resource',
  'resourceId',
  'resourceName',
  'status',
  'ipAddress',
  'userAgent',
  'errorMessage',
];

const ALLOWED_EXPORT_FIELDS = new Set([...DEFAULT_EXPORT_FIELDS, 'metadata', 'errorStack']);

function selectExportFields(requestedFields: string[], includeMetadata: boolean): string[] {
  const fields = requestedFields.length > 0 ? requestedFields : DEFAULT_EXPORT_FIELDS;
  const selected = fields.filter((field) => ALLOWED_EXPORT_FIELDS.has(field));

  if (includeMetadata && !selected.includes('metadata')) {
    selected.push('metadata');
  }

  return selected.length > 0 ? selected : DEFAULT_EXPORT_FIELDS;
}

function projectAuditLog(
  log: Record<string, unknown>,
  fields: string[],
  includeSensitive: boolean
): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((field) => [
      field,
      includeSensitive ? log[field] : maskSensitiveValue(field, log[field]),
    ])
  );
}

function maskSensitiveValue(field: string, value: unknown): unknown {
  if (/(password|secret|token|api[-_]?key|authorization|credential|session|cookie)/i.test(field)) {
    return '[REDACTED]';
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return JSON.parse(
    JSON.stringify(value, (key, nestedValue) =>
      /(password|secret|token|api[-_]?key|authorization|credential|session|cookie)/i.test(key)
        ? '[REDACTED]'
        : nestedValue
    )
  );
}

function buildWatermark(userId: string, userEmail: string): string {
  return `Exported for ${userEmail} (${userId}) at ${new Date().toISOString()}`;
}

function convertToCSV(logs: Array<Record<string, unknown>>, watermark: string): string {
  if (logs.length === 0) {
    return `# ${watermark}\nNo data to export`;
  }

  // CSV headers
  const headers = Object.keys(logs[0]);

  // CSV rows
  const rows = logs.map((log) =>
    headers.map((header) => {
      const value = log[header];
      if (value instanceof Date) return value.toISOString();
      if (value && typeof value === 'object') return JSON.stringify(value);
      return value ?? '';
    })
  );

  // Escape CSV values
  const escapeCSV = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // Build CSV
  const csvHeaders = headers.map(escapeCSV).join(',');
  const csvRows = rows.map((row) => row.map(escapeCSV).join(',')).join('\n');

  return `# ${watermark}\n${csvHeaders}\n${csvRows}`;
}
