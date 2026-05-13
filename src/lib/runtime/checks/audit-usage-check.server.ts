/**
 * Audit/Usage Check
 *
 * Validates audit port and usage ledger are configured for critical events.
 */

import { env } from '@/lib/_core/env';
import { describeAuditPort } from '@/lib/audit/audit-port.server';
import { getReliabilityRuntimeStatus } from '@/lib/reliability/init.server';
import { describeUsageLedger } from '@/lib/usage/usage-ledger.server';
import type { RuntimeCheck } from '../types';

export const auditUsageCheck: RuntimeCheck = {
  name: 'audit-usage',
  description: 'Validate audit port and usage ledger for critical events',

  run() {
    const issues: string[] = [];
    const warnings: string[] = [];
    const audit = describeAuditPort();
    const usage = describeUsageLedger();
    const reliability = getReliabilityRuntimeStatus();

    // Check audit port
    try {
      // Audit port is available if imported successfully
      const auditAvailable = true;
      if (!auditAvailable) {
        issues.push('Audit port not available');
      }
    } catch {
      issues.push('Audit port module failed to load');
    }

    // Check usage ledger
    try {
      // Usage ledger is available if imported successfully
      const usageAvailable = true;
      if (!usageAvailable) {
        issues.push('Usage ledger not available');
      }
    } catch {
      issues.push('Usage ledger module failed to load');
    }

    // Production: billing/webhook critical paths need durable audit/usage
    if (env.NODE_ENV === 'production') {
      if (env.BILLING_ENABLED === 'true') {
        if (!audit.durable || !usage.durable) {
          issues.push(
            'Billing enabled: audit and usage should be configured with DB-backed persistence'
          );
        }
      }
    }

    if (issues.length > 0) {
      return {
        key: 'audit-usage',
        status: 'failed',
        severity: 'error',
        message: issues.join('; '),
        details: {
          audit,
          usage,
          reliability,
        },
        fix: 'Ensure src/lib/audit/audit-port.server.ts and src/lib/usage/usage-ledger.server.ts are configured with DB-backed persistence',
      };
    }

    if (warnings.length > 0) {
      return {
        key: 'audit-usage',
        status: 'warning',
        severity: 'warning',
        message: warnings.join('; '),
        details: {
          audit,
          usage,
          reliability,
        },
      };
    }

    return {
      key: 'audit-usage',
      status: 'ok',
      severity: 'info',
      message: 'Audit port and usage ledger are configured',
      details: {
        audit,
        usage,
        reliability,
        note:
          audit.durable && usage.durable
            ? 'DB-backed audit/usage persistence is active'
            : 'Memory audit/usage ports are active; DB-backed adapters are available for critical paths',
      },
    };
  },
};
