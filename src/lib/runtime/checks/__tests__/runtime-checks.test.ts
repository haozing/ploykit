import { afterEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({
  NODE_ENV: 'test',
  BILLING_ENABLED: 'false',
}));

const mockReliability = vi.hoisted(() => ({
  initialized: true,
  databaseConfigured: false,
  outboxStore: 'memory' as 'database' | 'memory',
  outboxProcessorStarted: true,
  audit: {
    storage: 'memory' as 'database' | 'memory',
    durable: false,
    redactsSensitiveDetails: true,
  },
  usage: {
    storage: 'memory' as 'database' | 'memory',
    durable: false,
    idempotent: true,
    redactsSensitiveMetadata: true,
  },
}));

vi.mock('@/lib/_core/env', () => ({
  env: mockEnv,
}));

vi.mock('@/lib/bus/event-classification', () => ({
  describeEventClassification: vi.fn(() => ({ rules: [] })),
}));

vi.mock('@/lib/jobs/core-jobs.server', () => ({
  registerCoreJobs: vi.fn(),
}));

vi.mock('@/lib/jobs/job-registry', () => ({
  getJobRegistryStats: vi.fn(() => ({ total: 1, critical: 1 })),
  listJobs: vi.fn(() => [{ name: 'critical-job', priority: 'critical', maxRetries: 3 }]),
}));

vi.mock('@/lib/reliability/init.server', () => ({
  getReliabilityRuntimeStatus: vi.fn(() => mockReliability),
  initializeReliabilityRuntime: vi.fn(() => mockReliability),
}));

vi.mock('@/lib/audit/audit-port.server', () => ({
  describeAuditPort: vi.fn(() => mockReliability.audit),
}));

vi.mock('@/lib/usage/usage-ledger.server', () => ({
  describeUsageLedger: vi.fn(() => mockReliability.usage),
}));

describe('runtime checks', () => {
  afterEach(() => {
    mockEnv.NODE_ENV = 'test';
    mockEnv.BILLING_ENABLED = 'false';
    mockReliability.outboxStore = 'memory';
    mockReliability.outboxProcessorStarted = true;
    mockReliability.audit = {
      storage: 'memory',
      durable: false,
      redactsSensitiveDetails: true,
    };
    mockReliability.usage = {
      storage: 'memory',
      durable: false,
      idempotent: true,
      redactsSensitiveMetadata: true,
    };
  });

  it('fails outbox check when production billing uses memory-backed outbox', async () => {
    mockEnv.NODE_ENV = 'production';
    mockEnv.BILLING_ENABLED = 'true';
    const { outboxCheck } = await import('../outbox-check.server');

    const result = outboxCheck.run();

    expect(result).toMatchObject({
      key: 'outbox',
      status: 'failed',
      severity: 'error',
      message: expect.stringContaining('memory-backed outbox store'),
    });
  });

  it('fails audit/usage check when production billing is not durable', async () => {
    mockEnv.NODE_ENV = 'production';
    mockEnv.BILLING_ENABLED = 'true';
    const { auditUsageCheck } = await import('../audit-usage-check.server');

    const result = auditUsageCheck.run();

    expect(result).toMatchObject({
      key: 'audit-usage',
      status: 'failed',
      severity: 'error',
      message: expect.stringContaining('DB-backed persistence'),
    });
  });
});
