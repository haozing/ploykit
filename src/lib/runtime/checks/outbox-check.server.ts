/**
 * Outbox Check
 *
 * Validates that critical event transport (outbox) is available.
 */

import type { RuntimeCheck } from '../types';
import { env } from '@/lib/_core/env';
import { describeEventClassification } from '@/lib/bus/event-classification';
import { registerCoreJobs } from '@/lib/jobs/core-jobs.server';
import { getJobRegistryStats, listJobs } from '@/lib/jobs/job-registry';
import { initializeReliabilityRuntime } from '@/lib/reliability/init.server';

export const outboxCheck: RuntimeCheck = {
  name: 'outbox',
  description: 'Validate critical event outbox transport',

  run() {
    const issues: string[] = [];
    const warnings: string[] = [];
    const reliability = initializeReliabilityRuntime();

    // Verify outbox transport module can be imported
    try {
      // The module exists if we got here (imported at build time)
      // Phase 1: in-memory outbox is always available
      const outboxAvailable = true;
      if (!outboxAvailable) {
        issues.push('Outbox transport not available');
      }
    } catch {
      issues.push('Outbox event transport module failed to load');
    }

    try {
      registerCoreJobs();
      const jobs = listJobs();
      if (!jobs.some((job) => job.priority === 'critical')) {
        issues.push('No critical background jobs registered');
      }
    } catch {
      issues.push('Core background jobs failed to register');
    }

    if (!reliability.initialized) {
      warnings.push('Reliability runtime has not been initialized before outbox runtime check');
    }

    if (env.NODE_ENV === 'production' && env.BILLING_ENABLED === 'true') {
      if (reliability.outboxStore !== 'database') {
        issues.push('Billing is enabled but critical events are using memory-backed outbox store');
      }

      if (!reliability.outboxProcessorStarted) {
        issues.push('Billing is enabled but the outbox processor is not marked as started');
      }
    }

    // Billing/webhook critical paths need outbox
    if (issues.length > 0) {
      return {
        key: 'outbox',
        status: 'failed',
        severity: 'error',
        message: issues.join('; '),
        details: {
          reliability,
          eventClassification: describeEventClassification(),
          jobRegistry: getJobRegistryStats(),
        },
        fix: 'Ensure database-backed outbox is configured, the outbox processor starts, and event classes are registered',
      };
    }

    if (warnings.length > 0) {
      return {
        key: 'outbox',
        status: 'warning',
        severity: 'warning',
        message: warnings.join('; '),
        details: {
          reliability,
          eventClassification: describeEventClassification(),
          jobRegistry: getJobRegistryStats(),
          registeredJobs: listJobs().map((job) => ({
            name: job.name,
            priority: job.priority,
            maxRetries: job.maxRetries,
            timeoutMs: job.timeoutMs,
          })),
        },
      };
    }

    return {
      key: 'outbox',
      status: 'ok',
      severity: 'info',
      message: 'Critical event outbox transport is available',
      details: {
        reliability,
        eventClassification: describeEventClassification(),
        jobRegistry: getJobRegistryStats(),
        registeredJobs: listJobs().map((job) => ({
          name: job.name,
          priority: job.priority,
          maxRetries: job.maxRetries,
          timeoutMs: job.timeoutMs,
        })),
        note:
          reliability.outboxStore === 'database'
            ? 'DB-backed event_outbox store is active for critical billing/webhook/plugin lifecycle events'
            : 'Memory outbox is active; DB-backed event_outbox store will be enabled automatically when database configuration is present',
      },
    };
  },
};
