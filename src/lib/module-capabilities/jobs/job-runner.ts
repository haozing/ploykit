import type { ModuleContext, ModuleJobDefinition } from '@ploykit/module-sdk';
import { readModuleDefaultExport } from '../../module-runtime/adapters';
import {
  createModuleBackgroundContext,
  type ModuleBackgroundContextCapabilities,
} from '../../module-runtime/context';
import type { ModuleRuntimeHost } from '../../module-runtime/host/module-runtime-host';
import type { ModuleRuntimeAccessSession } from '../../module-runtime/security';
import {
  createInMemoryModuleRunRuntime,
  type ModuleRunRecord,
  type ModuleRunRuntime,
} from '../../module-runtime/runs';

export type ModuleJobHandler<TInput = unknown, TResult = unknown> = (
  ctx: ModuleContext,
  input: TInput,
  run: ModuleRunRecord<TInput>
) => TResult | Promise<TResult>;

export interface ModuleJobEntry {
  moduleId: string;
  name: string;
  definition: ModuleJobDefinition;
}

export interface RunModuleJobInput<TInput = unknown> {
  moduleId: string;
  name: string;
  input?: TInput;
  idempotencyKey?: string;
  session?: ModuleRuntimeAccessSession;
}

export interface RunModuleJobResult<TResult = unknown> {
  run: ModuleRunRecord<unknown, TResult>;
  result?: TResult;
}

export interface CreateModuleJobRunnerOptions {
  runs?: ModuleRunRuntime;
  session?: ModuleRuntimeAccessSession;
  capabilities?: ModuleBackgroundContextCapabilities;
  allowConcurrent?: boolean;
}

export interface ModuleJobRunner {
  runs: ModuleRunRuntime;
  listJobs(moduleId?: string): ModuleJobEntry[];
  runJob<TInput = unknown, TResult = unknown>(
    input: RunModuleJobInput<TInput>
  ): Promise<RunModuleJobResult<TResult>>;
}

function normalizeModulePath(value: string): string {
  return value.replace(/^\.\//, '');
}

function asJobHandler(value: unknown): ModuleJobHandler | null {
  const exported = readModuleDefaultExport(value);
  if (typeof exported === 'function') {
    return exported as ModuleJobHandler;
  }
  if (exported && typeof exported === 'object' && 'run' in exported) {
    const run = (exported as { run?: unknown }).run;
    return typeof run === 'function' ? (run as ModuleJobHandler) : null;
  }
  return null;
}

function timeoutAfter(timeoutMs: number, label: string): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(`MODULE_JOB_TIMEOUT: ${label}`)), timeoutMs);
  });
}

async function runWithTimeout<TResult>(
  task: Promise<TResult>,
  timeoutMs: number | undefined,
  label: string
): Promise<TResult> {
  if (!timeoutMs) {
    return task;
  }
  return Promise.race([task, timeoutAfter(timeoutMs, label)]);
}

export function createModuleJobRunner(
  host: ModuleRuntimeHost,
  options: CreateModuleJobRunnerOptions = {}
): ModuleJobRunner {
  const runs = options.runs ?? createInMemoryModuleRunRuntime();
  const active = new Set<string>();

  return {
    runs,
    listJobs(moduleId) {
      return host.contracts
        .filter((contract) => !moduleId || contract.id === moduleId)
        .flatMap((contract) =>
          Object.entries(contract.jobs).map(([name, definition]) => ({
            moduleId: contract.id,
            name,
            definition,
          }))
        );
    },
    async runJob<TInput = unknown, TResult = unknown>(
      input: RunModuleJobInput<TInput>
    ): Promise<RunModuleJobResult<TResult>> {
      const contract = host.getContract(input.moduleId);
      if (!contract) {
        throw new Error(`MODULE_JOB_MODULE_NOT_FOUND: ${input.moduleId}`);
      }

      const definition = contract.jobs[input.name];
      if (!definition) {
        throw new Error(`MODULE_JOB_NOT_FOUND: ${input.moduleId}.${input.name}`);
      }

      const activeKey = `${input.moduleId}:${input.name}`;
      if (!options.allowConcurrent && active.has(activeKey)) {
        throw new Error(`MODULE_JOB_ALREADY_RUNNING: ${activeKey}`);
      }

      const run = runs.createRun({
        moduleId: input.moduleId,
        kind: 'job',
        name: input.name,
        input: input.input,
        maxAttempts: (definition.retries ?? 0) + 1,
        idempotencyKey: input.idempotencyKey,
      });

      if (run.status !== 'queued') {
        return { run: run as ModuleRunRecord<unknown, TResult> };
      }

      active.add(activeKey);
      let lastRun = run as ModuleRunRecord<TInput>;

      try {
        while (lastRun.attempt < lastRun.maxAttempts) {
          lastRun = runs.startRun(lastRun.id) as ModuleRunRecord<TInput>;
          try {
            const entry = host.getMapEntry(contract.id);
            const loader = entry?.jobs?.[normalizeModulePath(definition.handler)];
            if (!loader) {
              throw new Error(`MODULE_JOB_HANDLER_MISSING: ${definition.handler}`);
            }

            const handler = asJobHandler(await loader());
            if (!handler) {
              throw new Error(`MODULE_JOB_HANDLER_INVALID: ${definition.handler}`);
            }

            const request = new Request(
              `http://localhost/modules/${contract.id}/jobs/${encodeURIComponent(input.name)}`,
              { method: 'POST' }
            );
            const ctx = createModuleBackgroundContext({
              host,
              contract,
              request,
              session: input.session ?? options.session,
              capabilities: options.capabilities,
            });
            const result = await runWithTimeout<TResult>(
              Promise.resolve(handler(ctx, input.input, lastRun)) as Promise<TResult>,
              definition.timeoutMs,
              `${contract.id}.${input.name}`
            );
            const succeeded = runs.succeedRun(lastRun.id, result);
            return { run: succeeded, result };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            runs.appendLog(lastRun.id, 'error', message);
            if (lastRun.attempt >= lastRun.maxAttempts) {
              return {
                run: runs.failRun(
                  lastRun.id,
                  error instanceof Error ? error : new Error(String(error))
                ) as ModuleRunRecord<unknown, TResult>,
              };
            }
          }
        }

        return {
          run: runs.failRun(lastRun.id, 'Job exhausted all attempts.') as ModuleRunRecord<
            unknown,
            TResult
          >,
        };
      } finally {
        active.delete(activeKey);
      }
    },
  };
}
