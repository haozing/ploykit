import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { redactSensitive } from '@/lib/module-runtime/observability/redaction';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import { getAdminActionRegistryEntry, type AdminRegistryEntry } from './admin-route-registry';
import { defaultProductId } from './default-scope';
import { localizedPath, type SupportedLanguage } from './i18n';
import { requireAdminActionContext, type HostRequestContext } from './request-context';
import { requireCapability } from './rbac';
import { getHostRuntimeStore } from './runtime-store';

export interface AdminActionExecution<TInput = unknown, TResult = unknown> {
  action: AdminRegistryEntry;
  context: HostRequestContext;
  input: TInput;
  formData: FormData;
  session: ModuleHostSession;
  lang: SupportedLanguage;
  correlationId: string;
  result?: TResult;
}

export interface AdminActionDefinition<TInput = unknown, TResult = unknown> {
  id: string;
  parse?: (formData: FormData, context: HostRequestContext) => TInput | Promise<TInput>;
  run: (execution: AdminActionExecution<TInput, TResult>) => TResult | Promise<TResult>;
  revalidate?: (
    execution: AdminActionExecution<TInput, TResult>
  ) => readonly string[] | void | Promise<readonly string[] | void>;
  redirect?: (
    execution: AdminActionExecution<TInput, TResult>
  ) => string | void | Promise<string | void>;
  audit?: {
    event?: string;
    metadata?: (
      execution: AdminActionExecution<TInput, TResult>
    ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  };
  confirmationField?: string;
}

export type AdminActionHandler = (formData: FormData) => Promise<void>;

type RegisteredAdminActionDefinition = AdminActionDefinition<any, any>;

const adminActionDefinitions = new Map<string, RegisteredAdminActionDefinition>();

function registerAdminActionDefinition(definition: RegisteredAdminActionDefinition): string {
  const actionDefinitionId = definition.id;
  const existing = adminActionDefinitions.get(actionDefinitionId);
  if (existing && existing !== definition && process.env.NODE_ENV === 'production') {
    throw new Error(`ADMIN_ACTION_DEFINITION_DUPLICATE:${actionDefinitionId}`);
  }
  adminActionDefinitions.set(actionDefinitionId, definition);
  return actionDefinitionId;
}

function getRegisteredAdminActionDefinition(actionDefinitionId: string): RegisteredAdminActionDefinition {
  const definition = adminActionDefinitions.get(actionDefinitionId);
  if (!definition) {
    throw new Error(`ADMIN_ACTION_DEFINITION_NOT_FOUND:${actionDefinitionId}`);
  }
  return definition;
}

function hasDangerousConfirmation(formData: FormData, field: string): boolean {
  const value = formData.get(field);
  return value === 'true' || value === 'on' || value === 'confirm' || value === 'CONFIRM';
}

function actorId(context: HostRequestContext): string | null {
  return context.actorId ?? context.userId ?? context.session.user?.id ?? null;
}

async function recordAdminActionAudit<TInput, TResult>(
  execution: AdminActionExecution<TInput, TResult>,
  metadata: Record<string, unknown>
) {
  const runtimeStore = await getHostRuntimeStore();
  await runtimeStore.store.recordAudit({
    productId: defaultProductId(execution.context.productId),
    workspaceId: execution.context.workspaceId,
    actorId: actorId(execution.context),
    type: execution.action.auditEvent,
    metadata: redactSensitive({
      actionId: execution.action.id,
      actionKey: `${execution.action.kind}:${execution.action.id}`,
      capability: execution.action.capability,
      risk: execution.action.risk,
      path: execution.action.path,
      requestPath: execution.context.requestPath,
      correlationId: execution.correlationId,
      ...metadata,
    }),
  });
}

export function createAdminAction<TInput = unknown, TResult = unknown>(
  definition: AdminActionDefinition<TInput, TResult>
): AdminActionHandler {
  const actionDefinitionId = registerAdminActionDefinition(definition);
  return async function adminAction(formData: FormData) {
    'use server';

    const definition = getRegisteredAdminActionDefinition(actionDefinitionId) as AdminActionDefinition<TInput, TResult>;
    const action = getAdminActionRegistryEntry(definition.id);
    const context = await requireAdminActionContext(action.path);
    requireCapability(context.session, 'admin.access');
    requireCapability(context.session, action.capability);

    const confirmationField = definition.confirmationField ?? 'confirm';
    if (action.risk === 'dangerous' && !hasDangerousConfirmation(formData, confirmationField)) {
      throw new Error(`ADMIN_ACTION_CONFIRMATION_REQUIRED:${definition.id}`);
    }

    const input = definition.parse
      ? await definition.parse(formData, context)
      : (undefined as TInput);
    const execution: AdminActionExecution<TInput, TResult> = {
      action,
      context,
      input,
      formData,
      session: context.session,
      lang: context.lang,
      correlationId: context.correlationId || randomUUID(),
    };
    execution.result = await definition.run(execution);

    const paths = await definition.revalidate?.(execution);
    for (const path of paths ?? []) {
      revalidatePath(localizedPath(context.lang, path));
    }

    const metadata = definition.audit?.metadata
      ? await definition.audit.metadata(execution)
      : {};
    await recordAdminActionAudit(
      {
        ...execution,
        action: definition.audit?.event ? { ...action, auditEvent: definition.audit.event } : action,
      },
      metadata
    );

    const redirectTo = await definition.redirect?.(execution);
    if (redirectTo) {
      redirect(redirectTo);
    }
  };
}
