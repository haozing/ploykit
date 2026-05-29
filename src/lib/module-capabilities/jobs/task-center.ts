import type { ModuleRunRecord } from '../../module-runtime/runs';
import type { RuntimeStore } from '../../module-runtime/stores';
import type { ModuleRuntimeAccessSession } from '../../module-runtime/security';

export interface RuntimeTaskCenter {
  list(input: {
    session: ModuleRuntimeAccessSession;
    productId: string;
    workspaceId?: string | null;
    moduleId?: string;
  }): Promise<ModuleRunRecord[]>;
  requestCancel(input: {
    session: ModuleRuntimeAccessSession;
    runId: string;
    productId?: string;
    workspaceId?: string | null;
    moduleId?: string;
  }): Promise<ModuleRunRecord>;
  retry(input: {
    session: ModuleRuntimeAccessSession;
    runId: string;
    productId?: string;
    workspaceId?: string | null;
    moduleId?: string;
  }): Promise<ModuleRunRecord>;
}

export function createRuntimeTaskCenter(store: RuntimeStore): RuntimeTaskCenter {
  function isPrivileged(session: ModuleRuntimeAccessSession): boolean {
    return Boolean(session.system || session.user?.role === 'admin');
  }

  function sessionOwnerId(session: ModuleRuntimeAccessSession): string | undefined {
    return session.userId ?? session.user?.id ?? session.actorId;
  }

  function runOwnerId(run: ModuleRunRecord): string | undefined {
    const input = run.input as { ownerId?: unknown } | undefined;
    return typeof input?.ownerId === 'string' && input.ownerId.length > 0
      ? input.ownerId
      : undefined;
  }

  function assertCanAccessTaskCenter(session: ModuleRuntimeAccessSession): void {
    if (session.system || session.user?.role === 'admin') {
      return;
    }
    if (sessionOwnerId(session)) {
      return;
    }
    throw new Error('MODULE_TASK_SESSION_REQUIRED');
  }

  function matchesSessionScope(session: ModuleRuntimeAccessSession, run: ModuleRunRecord): boolean {
    if (session.productId && run.productId !== session.productId) {
      return false;
    }
    if (session.workspaceId !== undefined && (run.workspaceId ?? null) !== session.workspaceId) {
      return false;
    }
    return true;
  }

  function matchesRequestedScope(
    input: { productId?: string; workspaceId?: string | null; moduleId?: string },
    run: ModuleRunRecord
  ): boolean {
    if (input.productId && run.productId !== input.productId) {
      return false;
    }
    if (input.workspaceId !== undefined && (run.workspaceId ?? null) !== input.workspaceId) {
      return false;
    }
    if (input.moduleId && run.moduleId !== input.moduleId) {
      return false;
    }
    return true;
  }

  async function readManageableRun(input: {
    session: ModuleRuntimeAccessSession;
    runId: string;
    productId?: string;
    workspaceId?: string | null;
    moduleId?: string;
  }): Promise<ModuleRunRecord> {
    assertCanAccessTaskCenter(input.session);
    const run = await store.getRun(input.runId);
    if (!run || !matchesRequestedScope(input, run) || !matchesSessionScope(input.session, run)) {
      throw new Error(`MODULE_TASK_NOT_FOUND: ${input.runId}`);
    }
    if (isPrivileged(input.session)) {
      return run;
    }
    if (runOwnerId(run) !== sessionOwnerId(input.session)) {
      throw new Error(`MODULE_TASK_FORBIDDEN: ${input.runId}`);
    }
    return run;
  }

  return {
    async list(input) {
      assertCanAccessTaskCenter(input.session);
      const runs = await store.listRuns({
        productId: input.productId,
        workspaceId: input.workspaceId,
        moduleId: input.moduleId,
      });
      if (input.session.system || input.session.user?.role === 'admin') {
        return runs;
      }
      return runs.filter((run) => runOwnerId(run) === sessionOwnerId(input.session));
    },
    async requestCancel(input) {
      await readManageableRun(input);
      return store.updateRunStatus(input.runId, 'cancel_requested');
    },
    async retry(input) {
      await readManageableRun(input);
      return store.updateRunStatus(input.runId, 'queued', { progress: 0 });
    },
  };
}
