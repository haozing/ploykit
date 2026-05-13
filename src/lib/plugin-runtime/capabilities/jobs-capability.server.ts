import { Permission, type PluginJobs } from '@ploykit/plugin-sdk';
import {
  registerJob,
  runJob,
  type JobDefinition,
  type JobRunRecord,
} from '@/lib/jobs/job-registry';
import {
  assertJsonSerializable,
  assertPluginNamespaced,
  enforceCapabilityPermission,
  type PluginCapabilityScope,
} from './guards.server';

export interface PluginJobsHost {
  registerJob<TPayload>(definition: JobDefinition<TPayload>): void;
  runJob<TPayload>(
    name: string,
    payload: TPayload,
    options?: { idempotencyKey?: string }
  ): Promise<JobRunRecord>;
}

export interface CreatePluginJobsOptions {
  host?: Partial<PluginJobsHost>;
}

const defaultJobsHost: PluginJobsHost = {
  registerJob,
  runJob,
};

function resolveHost(host?: Partial<PluginJobsHost>): PluginJobsHost {
  return {
    ...defaultJobsHost,
    ...host,
  };
}

export function createPluginJobsCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginJobsOptions = {}
): PluginJobs {
  const host = resolveHost(options.host);

  return {
    async enqueue(name, payload = {}) {
      enforceCapabilityPermission(scope, Permission.JobsEnqueue, 'ctx.jobs.enqueue');
      assertPluginNamespaced(scope, name, 'Job');
      assertJsonSerializable(payload, 'Job payload');

      const run = await host.runJob(name, payload, {
        idempotencyKey: `${scope.requestId}:job:${name}`,
      });

      return {
        id: run.id,
      };
    },

    register(name, handler, options = {}) {
      enforceCapabilityPermission(scope, Permission.JobsRegister, 'ctx.jobs.register');
      assertPluginNamespaced(scope, name, 'Job');

      host.registerJob<Record<string, unknown> | undefined>({
        name,
        description: `Plugin job ${name}`,
        priority: 'normal',
        maxRetries: options.retries ?? 0,
        retryDelayMs: 1000,
        timeoutMs: options.timeoutMs ?? 30_000,
        handler: async (payload) => {
          await handler(payload);
        },
      });
    },
  };
}
