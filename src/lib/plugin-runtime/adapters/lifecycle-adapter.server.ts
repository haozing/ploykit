import { randomUUID } from 'crypto';
import { PluginError } from '@ploykit/plugin-sdk';
import { getAuditPort } from '@/lib/audit/audit-port.server';
import { db } from '@/lib/db/client.server';
import { pluginLifecycleLogs } from '@/lib/db/schema/plugins';
import { createPluginRuntimeContext } from '../context';
import {
  getPluginRuntimeMapEntry,
  resolvePluginLifecycleModule,
  type PluginRuntimeMapEntry,
} from '../loader';
import { pluginRuntimeRegistry } from '../registry';
import type { PluginRuntimeContract } from '../contract';

export type PluginRuntimeLifecycleName = 'install' | 'enable' | 'disable' | 'uninstall' | 'upgrade';

export interface RunPluginLifecycleOptions {
  pluginId: string;
  lifecycle: PluginRuntimeLifecycleName;
  userId?: string;
  request?: Request;
  entry?: PluginRuntimeMapEntry;
  metadata?: Record<string, unknown>;
  writeLifecycleLog?: (input: PluginRuntimeLifecycleLogInput) => Promise<void>;
  writeAudit?: (input: PluginRuntimeLifecycleAuditInput) => Promise<void>;
}

export interface PluginRuntimeLifecycleLogInput {
  pluginId: string;
  lifecycle: PluginRuntimeLifecycleName;
  success: boolean;
  error?: string;
  duration: number;
  metadata?: Record<string, unknown>;
}

export interface PluginRuntimeLifecycleAuditInput extends PluginRuntimeLifecycleLogInput {
  userId?: string;
}

export interface PluginRuntimeLifecycleResult {
  success: boolean;
  lifecycle: PluginRuntimeLifecycleName;
  pluginId: string;
  duration: number;
  error?: string;
}

type LifecycleHandler = (
  ctx: ReturnType<typeof createPluginRuntimeContext>
) => unknown | Promise<unknown>;

function extractLifecycleHandler(
  module: unknown,
  lifecycle: PluginRuntimeLifecycleName
): LifecycleHandler {
  if (module && typeof module === 'object') {
    const mod = module as Record<string, unknown>;
    const defaultExport = mod.default;
    const handler =
      mod[lifecycle] ??
      (defaultExport && typeof defaultExport === 'object'
        ? (defaultExport as Record<string, unknown>)[lifecycle]
        : defaultExport);

    if (typeof handler === 'function') {
      return handler as LifecycleHandler;
    }
  }

  throw new PluginError({
    code: 'PLUGIN_LIFECYCLE_HANDLER_INVALID',
    message: `Lifecycle module does not export handler "${lifecycle}".`,
    statusCode: 500,
  });
}

async function defaultLifecycleLogWriter(input: PluginRuntimeLifecycleLogInput): Promise<void> {
  await db.insert(pluginLifecycleLogs).values({
    pluginId: input.pluginId,
    hook: input.lifecycle,
    success: input.success,
    error: input.error,
    metadata: {
      duration: input.duration,
      ...input.metadata,
    },
  });
}

async function defaultAuditWriter(input: PluginRuntimeLifecycleAuditInput): Promise<void> {
  await getAuditPort().log({
    id: randomUUID(),
    type:
      input.lifecycle === 'install'
        ? 'plugin.installed'
        : input.lifecycle === 'enable'
          ? 'plugin.enabled'
          : input.lifecycle === 'disable'
            ? 'plugin.disabled'
            : input.lifecycle === 'uninstall'
              ? 'plugin.uninstalled'
              : 'admin.action',
    action: `plugin.${input.lifecycle}`,
    actorId: input.userId ?? 'system',
    actorType: input.userId ? 'user' : 'system',
    targetId: input.pluginId,
    targetType: 'plugin',
    details: {
      success: input.success,
      duration: input.duration,
      error: input.error,
      ...input.metadata,
    },
    timestamp: new Date(),
  });
}

function createLifecycleRequest(pluginId: string, lifecycle: PluginRuntimeLifecycleName): Request {
  return new Request(`https://ploykit.local/plugins/${pluginId}/lifecycle/${lifecycle}`, {
    method: 'POST',
  });
}

async function getLifecycleContract(
  pluginId: string,
  entry: PluginRuntimeMapEntry | null
): Promise<PluginRuntimeContract> {
  return pluginRuntimeRegistry.getOrLoad(pluginId, entry);
}

export async function runPluginLifecycle(
  options: RunPluginLifecycleOptions
): Promise<PluginRuntimeLifecycleResult> {
  const startedAt = Date.now();
  const entry = options.entry ?? getPluginRuntimeMapEntry(options.pluginId);
  const contract = await getLifecycleContract(options.pluginId, entry);
  const handlerPath = contract.lifecycle[options.lifecycle];

  if (!handlerPath) {
    return {
      success: true,
      lifecycle: options.lifecycle,
      pluginId: options.pluginId,
      duration: Date.now() - startedAt,
    };
  }

  const moduleLoader = entry ? resolvePluginLifecycleModule(entry, handlerPath) : null;
  if (!moduleLoader) {
    throw new PluginError({
      code: 'PLUGIN_LIFECYCLE_HANDLER_NOT_FOUND',
      message: `Lifecycle handler "${handlerPath}" was not found for plugin "${options.pluginId}".`,
      statusCode: 500,
      fix: 'Run npm run plugins:scan and ensure the lifecycle handler exists inside the plugin.',
    });
  }

  let success = false;
  let errorMessage: string | undefined;

  try {
    const handler = extractLifecycleHandler(await moduleLoader(), options.lifecycle);
    const ctx = createPluginRuntimeContext({
      contract,
      request: options.request ?? createLifecycleRequest(options.pluginId, options.lifecycle),
      user: options.userId ? { id: options.userId, role: 'admin' } : null,
      system: !options.userId,
    });

    await handler(ctx);
    success = true;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  const result = {
    success,
    lifecycle: options.lifecycle,
    pluginId: options.pluginId,
    duration: Date.now() - startedAt,
    error: errorMessage,
  };

  const logInput = {
    ...result,
    metadata: options.metadata,
  };

  await (options.writeLifecycleLog ?? defaultLifecycleLogWriter)(logInput);
  await (options.writeAudit ?? defaultAuditWriter)({
    ...logInput,
    userId: options.userId,
  });

  return result;
}
