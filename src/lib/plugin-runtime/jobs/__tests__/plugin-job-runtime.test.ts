import { beforeEach, describe, expect, it } from 'vitest';
import { definePlugin, Permission } from '@ploykit/plugin-sdk';
import { clearJobRegistry, getJob, runJob } from '@/lib/jobs/job-registry';
import { normalizePluginRuntimeContract } from '../../contract';
import type { PluginRuntimeMapEntry } from '../../loader';
import { pluginRuntimeRegistry } from '../../registry';
import {
  registerPluginRuntimeJobs,
  unregisterPluginRuntimeJobs,
} from '../plugin-job-runtime.server';

function createEntry(overrides: Partial<PluginRuntimeMapEntry> = {}): PluginRuntimeMapEntry {
  const contract = normalizePluginRuntimeContract(
    definePlugin({
      id: 'runtime-worker',
      name: 'Runtime Worker',
      version: '1.0.0',
      permissions: [Permission.JobsRegister],
      jobs: {
        'runtime-worker.sync': {
          handler: './jobs/sync',
          timeoutMs: 5000,
          retries: 1,
        },
      },
    })
  );

  return {
    runtimeContract: contract,
    ...overrides,
  };
}

describe('plugin job runtime', () => {
  beforeEach(() => {
    clearJobRegistry();
    pluginRuntimeRegistry.clear();
  });

  it('registers declared plugin jobs and runs their handlers with plugin context', async () => {
    const handled: unknown[] = [];
    const entry = createEntry({
      jobModules: {
        'jobs/sync': async () => ({
          default: async (ctx: { plugin: { id: string } }, payload: unknown) => {
            handled.push({ pluginId: ctx.plugin.id, payload });
          },
        }),
      },
    });

    const registered = await registerPluginRuntimeJobs('runtime-worker', entry);

    expect(registered).toEqual([
      {
        name: 'runtime-worker.sync',
        handler: './jobs/sync',
        timeoutMs: 5000,
        maxRetries: 1,
      },
    ]);
    expect(getJob('runtime-worker.sync')).toBeTruthy();

    const run = await runJob('runtime-worker.sync', { ok: true });

    expect(run.status).toBe('succeeded');
    expect(handled).toEqual([
      {
        pluginId: 'runtime-worker',
        payload: { ok: true },
      },
    ]);
  });

  it('unregisters jobs by plugin namespace', async () => {
    const entry = createEntry({
      jobModules: {
        'jobs/sync': async () => ({ default: async () => undefined }),
      },
    });

    await registerPluginRuntimeJobs('runtime-worker', entry);

    expect(unregisterPluginRuntimeJobs('runtime-worker')).toBe(1);
    expect(getJob('runtime-worker.sync')).toBeUndefined();
  });

  it('fails when a declared job handler is missing from the runtime map', async () => {
    await expect(registerPluginRuntimeJobs('runtime-worker', createEntry())).rejects.toMatchObject({
      code: 'PLUGIN_JOB_HANDLER_NOT_FOUND',
      details: {
        jobName: 'runtime-worker.sync',
        handler: './jobs/sync',
      },
    });
  });
});
