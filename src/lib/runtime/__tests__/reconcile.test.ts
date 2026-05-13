import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerCheck, runReconcile, unregisterCheck } from '../reconcile.server';

describe('runtime reconcile', () => {
  afterEach(() => {
    unregisterCheck('test-ok');
    unregisterCheck('test-warning');
    unregisterCheck('test-timeout');
    vi.useRealTimers();
  });

  it('records duration for each check', async () => {
    registerCheck({
      name: 'test-ok',
      description: 'Test OK',
      run: () => ({
        key: 'test-ok',
        status: 'ok',
        severity: 'info',
        message: 'ok',
      }),
    });

    const report = await runReconcile();

    expect(report.checks).toContainEqual(
      expect.objectContaining({
        key: 'test-ok',
        status: 'ok',
        durationMs: expect.any(Number),
      })
    );
  });

  it('turns slow checks into failed timeout results', async () => {
    vi.useFakeTimers();
    registerCheck({
      name: 'test-timeout',
      description: 'Test timeout',
      run: () => new Promise(() => undefined),
    });

    const reportPromise = runReconcile({ timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    const report = await reportPromise;

    expect(report.overall).toBe('failed');
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        key: 'test-timeout',
        status: 'failed',
        severity: 'error',
        message: 'Check "test-timeout" timed out after 25ms',
        durationMs: expect.any(Number),
      })
    );
  });

  it('uses error severity to compute overall state', async () => {
    registerCheck({
      name: 'test-warning',
      description: 'Test warning',
      run: () => ({
        key: 'test-warning',
        status: 'warning',
        severity: 'warning',
        message: 'warning',
      }),
    });

    const report = await runReconcile();

    expect(report.overall).toBe('degraded');
  });
});
