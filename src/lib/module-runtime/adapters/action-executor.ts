import type { ModuleContext, ModuleUser } from '@ploykit/module-sdk';
import { createModuleRuntimeContext } from '../context';
import type { ModuleRuntimeHost } from '../host';
import { resolveModuleEntryLoader } from '../loader';
import { checkModuleRuntimeAccess, type ModuleRuntimeAccessSession } from '../security';
import { asModuleActionHandler } from './module-export';

export interface ExecuteModuleActionInput<TInput = unknown> {
  moduleId: string;
  name: string;
  input?: TInput;
  request?: Request;
  user?: ModuleUser | null;
  session?: ModuleRuntimeAccessSession;
  params?: Record<string, string>;
  confirmed?: boolean;
  idempotencyKey?: string;
  createContext?: (input: CreateModuleActionContextInput) => ModuleContext;
}

export interface CreateModuleActionContextInput {
  host: ModuleRuntimeHost;
  moduleId: string;
  name: string;
  request: Request;
  user: ModuleUser | null;
  session: ModuleRuntimeAccessSession;
  params: Record<string, string>;
}

function createSyntheticActionRequest(moduleId: string, name: string): Request {
  return new Request(`http://localhost/modules/${moduleId}/actions/${name}`, {
    method: 'POST',
  });
}

function truthyHeader(value: string | null): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

function actionConfirmed(input: ExecuteModuleActionInput): boolean {
  return (
    input.confirmed === true ||
    truthyHeader(input.request?.headers.get('x-ploykit-action-confirmed') ?? null) ||
    truthyHeader(input.request?.headers.get('x-action-confirmed') ?? null)
  );
}

function requestIdempotencyKey(request: Request | undefined): string | null {
  return (
    request?.headers.get('idempotency-key')?.trim() ||
    request?.headers.get('x-idempotency-key')?.trim() ||
    request?.headers.get('x-ploykit-idempotency-key')?.trim() ||
    null
  );
}

function inputIdempotencyKey(input: unknown): string | null {
  if (input === null || input === undefined) {
    return null;
  }
  if (typeof input === 'string') {
    return input.trim() || null;
  }
  try {
    return JSON.stringify(input);
  } catch {
    return null;
  }
}

type ActionExecutionPolicy = {
  confirmation?: { required?: boolean };
  idempotency?: { required?: boolean; keyFrom?: 'request' | 'user' | 'scope' | 'input' };
};

function resolveRequiredIdempotencyKey(
  action: ActionExecutionPolicy,
  input: ExecuteModuleActionInput,
  session: ModuleRuntimeAccessSession
): string | null {
  const explicit = input.idempotencyKey?.trim() || requestIdempotencyKey(input.request);
  if (explicit) {
    return explicit;
  }

  switch (action.idempotency?.keyFrom) {
    case 'user':
      return session.userId ?? session.user?.id ?? null;
    case 'scope':
      return session.workspaceId ?? session.productId ?? null;
    case 'input':
      return inputIdempotencyKey(input.input);
    case 'request':
    default:
      return null;
  }
}

function assertActionExecutionPolicy(
  action: ActionExecutionPolicy,
  input: ExecuteModuleActionInput,
  session: ModuleRuntimeAccessSession
): void {
  if (action.confirmation?.required && !actionConfirmed(input)) {
    throw new Error('MODULE_ACTION_CONFIRMATION_REQUIRED: action requires explicit confirmation.');
  }

  if (action.idempotency?.required && !resolveRequiredIdempotencyKey(action, input, session)) {
    throw new Error('MODULE_ACTION_IDEMPOTENCY_KEY_REQUIRED: action requires an idempotency key.');
  }
}

async function runWithTimeout<TResult>(
  operation: () => TResult | Promise<TResult>,
  timeoutMs: number | undefined
): Promise<TResult> {
  if (timeoutMs === undefined) {
    return operation();
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<TResult>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`MODULE_ACTION_TIMEOUT: action exceeded ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function executeModuleAction<TInput = unknown, TResult = unknown>(
  host: ModuleRuntimeHost,
  input: ExecuteModuleActionInput<TInput>
): Promise<TResult> {
  const action = host.actions.get(input.moduleId, input.name);
  if (!action) {
    throw new Error(`MODULE_ACTION_NOT_FOUND: ${input.moduleId}.${input.name}`);
  }

  const entry = host.getMapEntry(input.moduleId);
  const contract = host.getContract(input.moduleId);
  if (!entry || !contract) {
    throw new Error(`MODULE_ACTION_RUNTIME_ENTRY_MISSING: ${input.moduleId}.${input.name}`);
  }

  const accessSession = input.session ?? { user: input.user ?? null };
  const accessDenied = checkModuleRuntimeAccess({
    kind: 'action',
    contract,
    session: accessSession,
    auth: action.action.auth ?? 'auth',
    permissions: action.action.permissions,
    commercial: action.action.commercial,
  });
  if (accessDenied) {
    throw new Error(`${accessDenied.code}: ${input.moduleId}.${input.name}`);
  }

  assertActionExecutionPolicy(action.action, input, accessSession);

  const loader = resolveModuleEntryLoader(entry, 'actions', action.action.handler);
  if (!loader) {
    throw new Error(`MODULE_ACTION_HANDLER_MISSING: ${input.moduleId}.${input.name}`);
  }

  const handler = asModuleActionHandler(await loader());
  if (!handler) {
    throw new Error(`MODULE_ACTION_INVALID_EXPORT: ${input.moduleId}.${input.name}`);
  }

  const request = input.request ?? createSyntheticActionRequest(input.moduleId, input.name);
  const params = input.params ?? {};
  const user = accessSession.user;
  const context =
    input.createContext?.({
      host,
      moduleId: input.moduleId,
      name: input.name,
      request,
      user,
      session: accessSession,
      params,
    }) ??
    createModuleRuntimeContext({
      contract,
      request,
      user,
      params,
      data: host.createDataApi?.({
        contract,
        request,
        user,
        params,
        session: accessSession,
      }),
      session: accessSession,
    });

  return runWithTimeout(
    () => handler(context, input.input) as TResult | Promise<TResult>,
    action.action.timeoutMs
  );
}
