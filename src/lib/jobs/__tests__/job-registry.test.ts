import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearJobRegistry,
  getJob,
  getJobRegistryStats,
  listJobRuns,
  listJobs,
  registerJob,
  runJob,
  unregisterJob,
  unregisterJobsForPlugin,
} from '../job-registry';

describe('job registry', () => {
  beforeEach(() => {
    clearJobRegistry();
  });

  it('registers and lists jobs', () => {
    registerJob({
      name: 'test.job',
      priority: 'normal',
      maxRetries: 0,
      retryDelayMs: 0,
      timeoutMs: 1000,
      handler: async () => {},
    });

    expect(getJob('test.job')?.priority).toBe('normal');
    expect(listJobs()).toHaveLength(1);
    expect(getJobRegistryStats()).toMatchObject({ jobs: 1, criticalJobs: 0 });
  });

  it('unregisters a single job and all jobs for a plugin namespace', () => {
    registerJob({
      name: 'plugin-a.sync',
      priority: 'normal',
      maxRetries: 0,
      retryDelayMs: 0,
      timeoutMs: 1000,
      handler: async () => {},
    });
    registerJob({
      name: 'plugin-a.cleanup',
      priority: 'normal',
      maxRetries: 0,
      retryDelayMs: 0,
      timeoutMs: 1000,
      handler: async () => {},
    });
    registerJob({
      name: 'plugin-b.sync',
      priority: 'normal',
      maxRetries: 0,
      retryDelayMs: 0,
      timeoutMs: 1000,
      handler: async () => {},
    });

    unregisterJob('plugin-a.cleanup');
    expect(getJob('plugin-a.cleanup')).toBeUndefined();
    expect(unregisterJobsForPlugin('plugin-a')).toBe(1);
    expect(listJobs().map((job) => job.name)).toEqual(['plugin-b.sync']);
  });

  it('runs a job successfully and records the run', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerJob({
      name: 'test.success',
      priority: 'high',
      maxRetries: 0,
      retryDelayMs: 0,
      timeoutMs: 1000,
      handler,
    });

    const run = await runJob('test.success', { ok: true });

    expect(handler).toHaveBeenCalledWith({ ok: true });
    expect(run.status).toBe('succeeded');
    expect(run.attempts).toBe(1);
    expect(listJobRuns('test.success')).toHaveLength(1);
  });

  it('retries failed jobs before succeeding', async () => {
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(undefined);

    registerJob({
      name: 'test.retry',
      priority: 'critical',
      maxRetries: 1,
      retryDelayMs: 0,
      timeoutMs: 1000,
      handler,
    });

    const run = await runJob('test.retry', undefined);

    expect(run.status).toBe('succeeded');
    expect(run.attempts).toBe(2);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('marks a job failed after retries are exhausted', async () => {
    registerJob({
      name: 'test.fail',
      priority: 'critical',
      maxRetries: 1,
      retryDelayMs: 0,
      timeoutMs: 1000,
      handler: async () => {
        throw new Error('boom');
      },
    });

    const run = await runJob('test.fail', undefined);

    expect(run.status).toBe('failed');
    expect(run.attempts).toBe(2);
    expect(run.error).toBe('boom');
    expect(getJobRegistryStats().failed).toBe(1);
  });

  it('deduplicates runs by idempotency key', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerJob({
      name: 'test.idempotent',
      priority: 'normal',
      maxRetries: 0,
      retryDelayMs: 0,
      timeoutMs: 1000,
      handler,
    });

    const first = await runJob('test.idempotent', { value: 1 }, { idempotencyKey: 'same-key' });
    const second = await runJob('test.idempotent', { value: 2 }, { idempotencyKey: 'same-key' });

    expect(first.id).toBe(second.id);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
