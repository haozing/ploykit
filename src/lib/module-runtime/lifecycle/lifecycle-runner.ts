import type { ModuleContext, ModuleLifecycleDefinition } from '@ploykit/module-sdk';
import { readModuleDefaultExport } from '../adapters';
import {
  createModuleBackgroundContext,
  type ModuleBackgroundContextCapabilities,
} from '../context';
import type { ModuleRuntimeHost } from '../host/module-runtime-host';
import type { ModuleRuntimeAccessSession } from '../security';

export type ModuleLifecycleHook = keyof ModuleLifecycleDefinition;

export type ModuleLifecycleHandler<TInput = unknown, TResult = unknown> = (
  ctx: ModuleContext,
  input: TInput
) => TResult | Promise<TResult>;

export interface RunModuleLifecycleHookInput<TInput = unknown> {
  moduleId: string;
  hook: ModuleLifecycleHook;
  input?: TInput;
  session?: ModuleRuntimeAccessSession;
  capabilities?: ModuleBackgroundContextCapabilities;
}

export interface ModuleLifecycleHookResult<TResult = unknown> {
  moduleId: string;
  hook: ModuleLifecycleHook;
  skipped: boolean;
  result?: TResult;
}

function normalizeModulePath(value: string): string {
  return value.replace(/^\.\//, '');
}

function asLifecycleHandler(value: unknown): ModuleLifecycleHandler | null {
  const exported = readModuleDefaultExport(value);
  if (typeof exported === 'function') {
    return exported as ModuleLifecycleHandler;
  }
  if (exported && typeof exported === 'object' && 'run' in exported) {
    const run = (exported as { run?: unknown }).run;
    return typeof run === 'function' ? (run as ModuleLifecycleHandler) : null;
  }
  return null;
}

export async function runModuleLifecycleHook<TInput = unknown, TResult = unknown>(
  host: ModuleRuntimeHost,
  input: RunModuleLifecycleHookInput<TInput>
): Promise<ModuleLifecycleHookResult<TResult>> {
  const contract = host.getContract(input.moduleId);
  if (!contract) {
    throw new Error(`MODULE_LIFECYCLE_MODULE_NOT_FOUND: ${input.moduleId}`);
  }

  const handlerPath = contract.lifecycle[input.hook];
  if (!handlerPath) {
    return {
      moduleId: contract.id,
      hook: input.hook,
      skipped: true,
    };
  }

  const entry = host.getMapEntry(contract.id);
  const loader = entry?.lifecycle?.[normalizeModulePath(handlerPath)];
  if (!loader) {
    throw new Error(`MODULE_LIFECYCLE_HANDLER_MISSING: ${handlerPath}`);
  }

  const handler = asLifecycleHandler(await loader());
  if (!handler) {
    throw new Error(`MODULE_LIFECYCLE_HANDLER_INVALID: ${handlerPath}`);
  }

  const request = new Request(
    `http://localhost/modules/${contract.id}/lifecycle/${String(input.hook)}`,
    { method: 'POST' }
  );
  const ctx = createModuleBackgroundContext({
    host,
    contract,
    request,
    session: input.session,
    capabilities: input.capabilities,
  });
  return {
    moduleId: contract.id,
    hook: input.hook,
    skipped: false,
    result: (await handler(ctx, input.input)) as TResult,
  };
}

export async function runAllModuleLifecycleHooks<TInput = unknown>(
  host: ModuleRuntimeHost,
  input: Omit<RunModuleLifecycleHookInput<TInput>, 'moduleId'>
): Promise<ModuleLifecycleHookResult[]> {
  const results: ModuleLifecycleHookResult[] = [];
  for (const contract of host.contracts) {
    results.push(
      await runModuleLifecycleHook(host, {
        ...input,
        moduleId: contract.id,
      })
    );
  }
  return results;
}
