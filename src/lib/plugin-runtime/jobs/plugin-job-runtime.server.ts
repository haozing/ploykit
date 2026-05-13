import { Permission, PluginError, type PluginContext } from '@ploykit/plugin-sdk';
import { registerJob, unregisterJobsForPlugin, type JobDefinition } from '@/lib/jobs/job-registry';
import { createPluginRuntimeContext } from '../context';
import {
  getPluginRuntimeMapEntry,
  resolvePluginJobModule,
  type PluginRuntimeMapEntry,
} from '../loader';
import { pluginRuntimeRegistry } from '../registry';
import type { PluginRuntimeContract } from '../contract';

export interface RegisteredPluginJob {
  name: string;
  handler: string;
  timeoutMs: number;
  maxRetries: number;
}

type PluginJobHandler = (ctx: PluginContext, payload?: unknown) => unknown | Promise<unknown>;

function createJobRequest(pluginId: string, jobName: string): Request {
  return new Request(`https://ploykit.local/plugins/${pluginId}/jobs/${jobName}`, {
    method: 'POST',
  });
}

function extractPluginJobHandler(module: unknown, jobName: string): PluginJobHandler {
  if (module && typeof module === 'object') {
    const mod = module as Record<string, unknown>;
    const defaultExport = mod.default;
    const localName = jobName.includes('.') ? jobName.split('.').pop() : jobName;
    const handler =
      mod.handler ??
      (localName ? mod[localName] : undefined) ??
      (defaultExport && typeof defaultExport === 'object'
        ? (defaultExport as Record<string, unknown>).handler
        : defaultExport);

    if (typeof handler === 'function') {
      return handler as PluginJobHandler;
    }
  }

  throw new PluginError({
    code: 'PLUGIN_JOB_HANDLER_INVALID',
    message: `Job module for "${jobName}" must export a handler function.`,
    statusCode: 500,
    fix: 'Export a default function or named handler from the job module.',
    details: {
      jobName,
    },
  });
}

async function resolveContract(
  pluginId: string,
  entry: PluginRuntimeMapEntry | null
): Promise<PluginRuntimeContract> {
  return pluginRuntimeRegistry.getOrLoad(pluginId, entry);
}

function assertJobContractPermissions(contract: PluginRuntimeContract): void {
  if (
    Object.keys(contract.jobs).length === 0 ||
    contract.permissions.includes(Permission.JobsRegister)
  ) {
    return;
  }

  throw new PluginError({
    code: 'PLUGIN_JOB_PERMISSION_MISSING',
    message: `Plugin "${contract.id}" declares jobs but does not declare Permission.JobsRegister.`,
    statusCode: 403,
    fix: 'Add Permission.JobsRegister to plugin.ts permissions or remove the jobs declaration.',
    details: {
      pluginId: contract.id,
      permission: Permission.JobsRegister,
    },
  });
}

function assertJobNamespaced(contract: PluginRuntimeContract, jobName: string): void {
  if (jobName.startsWith(`${contract.id}.`)) {
    return;
  }

  throw new PluginError({
    code: 'PLUGIN_JOB_NAMESPACE_INVALID',
    message: `Job "${jobName}" must start with "${contract.id}.".`,
    statusCode: 400,
    fix: `Rename the job to use the plugin namespace, for example "${contract.id}.sync".`,
    details: {
      pluginId: contract.id,
      jobName,
    },
  });
}

export async function registerPluginRuntimeJobs(
  pluginId: string,
  entry: PluginRuntimeMapEntry | null = getPluginRuntimeMapEntry(pluginId)
): Promise<RegisteredPluginJob[]> {
  const contract = await resolveContract(pluginId, entry);
  assertJobContractPermissions(contract);

  const registered: RegisteredPluginJob[] = [];

  for (const [jobName, job] of Object.entries(contract.jobs)) {
    assertJobNamespaced(contract, jobName);

    const moduleLoader = entry ? resolvePluginJobModule(entry, job.handler) : null;
    if (!moduleLoader) {
      throw new PluginError({
        code: 'PLUGIN_JOB_HANDLER_NOT_FOUND',
        message: `Job handler "${job.handler}" was not found for plugin "${pluginId}".`,
        statusCode: 500,
        fix: 'Run npm run plugins:scan and ensure the job handler exists inside the plugin.',
        details: {
          pluginId,
          jobName,
          handler: job.handler,
        },
      });
    }

    const handler = extractPluginJobHandler(await moduleLoader(), jobName);
    const maxRetries = job.retries ?? 0;
    const timeoutMs = job.timeoutMs ?? 30_000;

    registerJob<unknown>({
      name: jobName,
      description: `Plugin job ${jobName}`,
      priority: 'normal',
      maxRetries,
      retryDelayMs: 1000,
      timeoutMs,
      handler: async (payload) => {
        const ctx = createPluginRuntimeContext({
          contract,
          request: createJobRequest(pluginId, jobName),
          user: null,
          system: true,
        });

        await handler(ctx, payload);
      },
    } satisfies JobDefinition<unknown>);

    registered.push({
      name: jobName,
      handler: job.handler,
      timeoutMs,
      maxRetries,
    });
  }

  return registered;
}

export function unregisterPluginRuntimeJobs(pluginId: string): number {
  return unregisterJobsForPlugin(pluginId);
}
