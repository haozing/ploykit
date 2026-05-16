import { randomUUID } from 'crypto';
import { and, desc, eq, ilike, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { Permission } from '@ploykit/plugin-sdk';
import type { PluginServiceDefinition } from '@ploykit/plugin-sdk';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/_core/errors';
import { env } from '@/lib/_core/env';
import { db, withSystemContext, type Database } from '@/lib/db/client.server';
import {
  pluginInternalServiceBindings,
  pluginResourceBindings,
  pluginServiceCallLogs,
  type NewPluginInternalServiceBinding,
  type PluginInternalServiceBinding,
  type PluginResourceBinding,
  type PluginServiceCallLog,
} from '@/lib/db/schema/plugin-platform';
import { getPluginRuntimeMapEntry } from '../loader';
import { listPluginRuntimeIds } from '../loader';
import { pluginRuntimeRegistry } from '../registry';
import { DbPluginSecretsRepository } from '../capabilities/secrets-capability.server';
import {
  applyInternalServiceRequestHeaders,
  DbPluginInternalServiceRegistry,
  type PluginInternalServiceRegistry,
  type PluginServicesHttpHost,
} from '../capabilities/services-capability.server';
import type { NormalizedPluginResourceScope, PluginCapabilityScope } from '../capabilities';

type TransactionDatabase = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Database | TransactionDatabase;

const bindingScopeSchema = z.enum(['global', 'workspace']);
const bindingStatusSchema = z.enum(['active', 'disabled']);
const bindingAuthTypeSchema = z.enum(['none', 'bearer', 'basic', 'apiKey']);
const bindingActorClaimsTypeSchema = z.enum(['hmac']);

export const internalServiceBindingListQuerySchema = z.object({
  pluginId: z.string().min(1).max(120).optional(),
  serviceName: z.string().min(1).max(120).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  workspaceId: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const internalServiceRequirementsQuerySchema = z.object({
  pluginId: z.string().min(1).max(120).optional(),
  environment: z.string().min(1).max(80).optional(),
  workspaceId: z.string().min(1).max(200).optional(),
});

export const internalServiceLogsQuerySchema = z.object({
  pluginId: z.string().min(1).max(120).optional(),
  serviceName: z.string().min(1).max(120).optional(),
  workspaceId: z.string().min(1).max(200).optional(),
  requestId: z.string().min(1).max(200).optional(),
  status: z.coerce.number().int().optional(),
  errorCode: z.string().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const internalServiceLogsRetentionSchema = z.object({
  retentionDays: z
    .number()
    .int()
    .min(1)
    .max(3650)
    .default(env.PLUGIN_SERVICE_CALL_LOG_RETENTION_DAYS),
});

export const resourceBindingAdminListQuerySchema = z.object({
  pluginId: z.string().min(1).max(120).optional(),
  workspaceId: z.string().min(1).max(200).optional(),
  scopeType: z.enum(['user', 'workspace']).optional(),
  resourceType: z.string().min(1).max(120).optional(),
  status: z.enum(['active', 'disabled', 'archived']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const resourceBindingAdminActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('setStatus'),
    id: z.string().min(1).max(200),
    status: z.enum(['active', 'disabled', 'archived']),
  }),
]);

export const internalServiceBindingActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('upsert'),
    id: z.string().min(1).max(200).optional(),
    pluginId: z.string().min(1).max(120),
    serviceName: z.string().min(1).max(120),
    scopeType: bindingScopeSchema.default('global'),
    scopeId: z.string().max(200).optional().nullable(),
    environment: z.string().max(80).optional().nullable(),
    baseUrl: z.string().url(),
    authType: bindingAuthTypeSchema.default('none'),
    authSecretRef: z.string().max(500).optional().nullable(),
    authSecretValue: z.string().max(10000).optional(),
    authUsernameRef: z.string().max(500).optional().nullable(),
    authUsernameValue: z.string().max(10000).optional(),
    authPasswordRef: z.string().max(500).optional().nullable(),
    authPasswordValue: z.string().max(10000).optional(),
    authHeaderName: z.string().max(120).optional().nullable(),
    actorClaimsEnabled: z.boolean().default(false),
    actorClaimsType: bindingActorClaimsTypeSchema.default('hmac'),
    actorClaimsAudience: z.string().max(200).optional().nullable(),
    actorClaimsSecretRef: z.string().max(500).optional().nullable(),
    actorClaimsSecretValue: z.string().max(10000).optional(),
    actorClaimsKeyId: z.string().max(120).optional().nullable(),
    actorClaimsTtlSeconds: z.number().int().min(10).max(300).default(60),
    timeoutMs: z.number().int().min(100).max(300000).default(30000),
    retryAttempts: z.number().int().min(0).max(5).default(0),
    retryBackoffMs: z.number().int().min(0).max(30000).default(250),
    maxResponseBytes: z.number().int().min(1024).max(52428800).default(10485760),
    healthPath: z.string().max(500).optional().nullable(),
    healthMethod: z.string().max(20).default('GET'),
    healthExpectedStatus: z.number().int().min(100).max(599).default(200),
    status: bindingStatusSchema.default('active'),
    metadata: z.record(z.unknown()).optional(),
  }),
  z.object({
    action: z.literal('setStatus'),
    id: z.string().min(1).max(200),
    status: bindingStatusSchema,
  }),
  z.object({
    action: z.literal('rotateSecret'),
    id: z.string().min(1).max(200),
    field: z.enum(['auth', 'authUsername', 'authPassword', 'actorClaims']),
    value: z.string().min(1).max(10000),
  }),
  z.object({
    action: z.literal('test'),
    id: z.string().min(1).max(200),
    path: z.string().max(500).optional(),
    method: z.string().max(20).optional(),
  }),
]);

export type InternalServiceBindingActionInput = z.infer<typeof internalServiceBindingActionSchema>;

export interface AdminInternalServiceBindingSummary {
  id: string;
  pluginId: string;
  serviceName: string;
  scopeType: string;
  scopeId?: string;
  environment?: string;
  baseUrl: string;
  authType: string;
  authSecretRef?: string;
  authUsernameRef?: string;
  authPasswordRef?: string;
  authHeaderName?: string;
  actorClaimsEnabled: boolean;
  actorClaimsType: string;
  actorClaimsAudience?: string;
  actorClaimsSecretRef?: string;
  actorClaimsKeyId?: string;
  actorClaimsTtlSeconds: number;
  timeoutMs: number;
  retryAttempts: number;
  retryBackoffMs: number;
  maxResponseBytes: number;
  healthPath?: string;
  healthMethod: string;
  healthExpectedStatus: number;
  status: 'active' | 'disabled';
  lastCheckedAt?: string;
  lastCheckStatus?: string;
  lastCheckError?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AdminInternalServiceRequirement {
  pluginId: string;
  serviceName: string;
  methods: readonly string[];
  paths: readonly string[];
  actorClaims: boolean;
  bindingStatus: 'bound' | 'missing' | 'disabled';
  binding?: AdminInternalServiceBindingSummary;
}

export interface AdminServiceCallLogSummary {
  id: string;
  pluginId: string;
  serviceName: string;
  userId?: string;
  workspaceId?: string;
  method: string;
  path: string;
  pathTemplate?: string;
  status?: number;
  ok: boolean;
  durationMs?: number;
  requestId?: string;
  errorCode?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AdminServiceCallLogRetentionResult {
  retentionDays: number;
  cutoff: string;
  deleted: number;
}

export interface AdminResourceBindingSummary {
  id: string;
  pluginId: string;
  scopeType: string;
  scopeId: string;
  resourceType: string;
  resourceId: string;
  cardinality: string;
  displayName?: string;
  status: string;
  metadata: Record<string, unknown>;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) {
    throw new ValidationError('Internal service paths must start with "/".');
  }
  return trimmed;
}

function validateServiceName(name: string): string {
  const normalized = name.trim();
  if (!/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
    throw new ValidationError('Internal service name is invalid.');
  }
  return normalized;
}

function assertNoUnsafeSecretRef(ref: string | null | undefined): void {
  if (!ref) return;
  if (!ref.startsWith('env:') && !ref.startsWith('dbsec:')) {
    throw new ValidationError('Secret refs must use env: or dbsec:.');
  }
}

function assertBindingSecrets(
  input: Extract<InternalServiceBindingActionInput, { action: 'upsert' }>
) {
  assertNoUnsafeSecretRef(input.authSecretRef);
  assertNoUnsafeSecretRef(input.authUsernameRef);
  assertNoUnsafeSecretRef(input.authPasswordRef);
  assertNoUnsafeSecretRef(input.actorClaimsSecretRef);

  if (
    (input.authType === 'bearer' || input.authType === 'apiKey') &&
    !normalizeNullable(input.authSecretRef) &&
    !input.authSecretValue
  ) {
    throw new ValidationError(
      'Bearer and API key service auth require a secret ref or new secret.'
    );
  }

  if (
    input.authType === 'basic' &&
    ((!normalizeNullable(input.authUsernameRef) && !input.authUsernameValue) ||
      (!normalizeNullable(input.authPasswordRef) && !input.authPasswordValue))
  ) {
    throw new ValidationError('Basic service auth requires username and password secrets.');
  }

  if (
    input.actorClaimsEnabled &&
    !normalizeNullable(input.actorClaimsSecretRef) &&
    !input.actorClaimsSecretValue
  ) {
    throw new ValidationError('Actor claims require a signing secret ref or new secret.');
  }
}

function toBindingSummary(row: PluginInternalServiceBinding): AdminInternalServiceBindingSummary {
  return {
    id: row.id,
    pluginId: row.pluginId,
    serviceName: row.serviceName,
    scopeType: row.scopeType,
    scopeId: row.scopeId ?? undefined,
    environment: row.environment ?? undefined,
    baseUrl: row.baseUrl,
    authType: row.authType,
    authSecretRef: row.authSecretRef ?? undefined,
    authUsernameRef: row.authUsernameRef ?? undefined,
    authPasswordRef: row.authPasswordRef ?? undefined,
    authHeaderName: row.authHeaderName ?? undefined,
    actorClaimsEnabled: row.actorClaimsEnabled,
    actorClaimsType: row.actorClaimsType,
    actorClaimsAudience: row.actorClaimsAudience ?? undefined,
    actorClaimsSecretRef: row.actorClaimsSecretRef ?? undefined,
    actorClaimsKeyId: row.actorClaimsKeyId ?? undefined,
    actorClaimsTtlSeconds: row.actorClaimsTtlSeconds,
    timeoutMs: row.timeoutMs,
    retryAttempts: row.retryAttempts,
    retryBackoffMs: row.retryBackoffMs,
    maxResponseBytes: row.maxResponseBytes,
    healthPath: row.healthPath ?? undefined,
    healthMethod: row.healthMethod,
    healthExpectedStatus: row.healthExpectedStatus,
    status: row.status === 'disabled' ? 'disabled' : 'active',
    lastCheckedAt: row.lastCheckedAt?.toISOString(),
    lastCheckStatus: row.lastCheckStatus ?? undefined,
    lastCheckError: row.lastCheckError ?? undefined,
    metadata: record(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toCallLogSummary(row: PluginServiceCallLog): AdminServiceCallLogSummary {
  return {
    id: row.id,
    pluginId: row.pluginId,
    serviceName: row.serviceName,
    userId: row.userId ?? undefined,
    workspaceId: row.workspaceId ?? undefined,
    method: row.method,
    path: row.path,
    pathTemplate: row.pathTemplate ?? undefined,
    status: row.status ?? undefined,
    ok: row.ok === 'true',
    durationMs: row.durationMs ?? undefined,
    requestId: row.requestId ?? undefined,
    errorCode: row.errorCode ?? undefined,
    metadata: record(row.metadata),
    createdAt: row.createdAt.toISOString(),
  };
}

function toResourceBindingSummary(row: PluginResourceBinding): AdminResourceBindingSummary {
  return {
    id: row.id,
    pluginId: row.pluginId,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    cardinality: row.cardinality,
    displayName: row.displayName ?? undefined,
    status: row.status,
    metadata: record(row.metadata),
    createdByUserId: row.createdByUserId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString(),
  };
}

async function assertServiceDeclared(
  pluginId: string,
  serviceName: string
): Promise<PluginServiceDefinition> {
  const entry = getPluginRuntimeMapEntry(pluginId);
  if (!entry?.plugin && !entry?.runtimeContract) {
    throw new NotFoundError('Plugin', pluginId);
  }
  const contract = await pluginRuntimeRegistry.getOrLoad(pluginId, entry);
  const service = contract.services.find((candidate) => candidate.name === serviceName);
  if (!service) {
    throw new ValidationError(`Plugin "${pluginId}" does not declare service "${serviceName}".`, {
      pluginId,
      serviceName,
    });
  }
  return service;
}

async function writeDbSecret(
  executor: Executor,
  pluginId: string,
  ref: string | null | undefined,
  value: string | undefined
): Promise<string | null | undefined> {
  if (value === undefined) {
    return ref;
  }
  const name = ref?.startsWith('dbsec:')
    ? ref.slice('dbsec:'.length)
    : `internal-services/${randomUUID()}`;
  const repository = new DbPluginSecretsRepository(executor);
  await repository.set({ pluginId, userId: '', system: true }, name, value);
  return `dbsec:${name}`;
}

async function getBindingOrThrow(
  executor: Executor,
  id: string
): Promise<PluginInternalServiceBinding> {
  const [row] = await executor
    .select()
    .from(pluginInternalServiceBindings)
    .where(eq(pluginInternalServiceBindings.id, id))
    .limit(1);
  if (!row) {
    throw new NotFoundError('Internal service binding', id);
  }
  return row;
}

async function findInternalServiceBindingForUpsert(
  executor: Executor,
  input: {
    pluginId: string;
    serviceName: string;
    scopeType: string;
    scopeId: string | null;
    environment: string | null;
  }
): Promise<PluginInternalServiceBinding | null> {
  const conditions: SQL[] = [
    eq(pluginInternalServiceBindings.pluginId, input.pluginId),
    eq(pluginInternalServiceBindings.serviceName, input.serviceName),
    eq(pluginInternalServiceBindings.scopeType, input.scopeType),
  ];

  if (input.scopeId) {
    conditions.push(eq(pluginInternalServiceBindings.scopeId, input.scopeId));
  } else {
    conditions.push(sql`${pluginInternalServiceBindings.scopeId} IS NULL`);
  }

  if (input.environment) {
    conditions.push(eq(pluginInternalServiceBindings.environment, input.environment));
  } else {
    conditions.push(sql`${pluginInternalServiceBindings.environment} IS NULL`);
  }

  const [row] = await executor
    .select()
    .from(pluginInternalServiceBindings)
    .where(and(...conditions))
    .limit(1);
  return row ?? null;
}

export async function listInternalServiceBindings(
  input: z.infer<typeof internalServiceBindingListQuerySchema>
) {
  const conditions: SQL[] = [];
  if (input.pluginId) conditions.push(eq(pluginInternalServiceBindings.pluginId, input.pluginId));
  if (input.serviceName)
    conditions.push(eq(pluginInternalServiceBindings.serviceName, input.serviceName));
  if (input.status) conditions.push(eq(pluginInternalServiceBindings.status, input.status));
  if (input.workspaceId) {
    conditions.push(
      or(
        eq(pluginInternalServiceBindings.scopeType, 'global'),
        and(
          eq(pluginInternalServiceBindings.scopeType, 'workspace'),
          eq(pluginInternalServiceBindings.scopeId, input.workspaceId)
        )
      )!
    );
  }

  const rows = await withSystemContext((database) =>
    database
      .select()
      .from(pluginInternalServiceBindings)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(pluginInternalServiceBindings.updatedAt))
      .limit(input.limit)
  );
  return rows.map(toBindingSummary);
}

export async function listInternalServiceRequirements(
  input: z.infer<typeof internalServiceRequirementsQuerySchema>
): Promise<AdminInternalServiceRequirement[]> {
  const pluginIds = input.pluginId ? [input.pluginId] : [...new Set(listPluginRuntimeIds())];
  const registry = new DbPluginInternalServiceRegistry();
  const requirements: AdminInternalServiceRequirement[] = [];

  for (const pluginId of pluginIds) {
    const entry = getPluginRuntimeMapEntry(pluginId);
    if (!entry?.plugin && !entry?.runtimeContract) {
      continue;
    }
    const contract = await pluginRuntimeRegistry.getOrLoad(pluginId, entry);
    for (const service of contract.services) {
      const activeBinding = await registry.resolveBinding({
        pluginId,
        serviceName: service.name,
        workspaceId: input.workspaceId,
        environment: input.environment,
        status: 'active',
      });
      const inactiveBinding =
        activeBinding ??
        (await registry.resolveBinding({
          pluginId,
          serviceName: service.name,
          workspaceId: input.workspaceId,
          environment: input.environment,
          status: 'disabled',
        }));
      const binding = inactiveBinding ? toBindingSummary(inactiveBinding) : undefined;
      requirements.push({
        pluginId,
        serviceName: service.name,
        methods: service.methods,
        paths: service.paths,
        actorClaims: service.actorClaims === true,
        bindingStatus: activeBinding ? 'bound' : inactiveBinding ? 'disabled' : 'missing',
        binding,
      });
    }
  }

  return requirements;
}

export async function handleInternalServiceBindingAction(
  input: InternalServiceBindingActionInput,
  userId?: string,
  options: { registry?: PluginInternalServiceRegistry; httpHost?: PluginServicesHttpHost } = {}
): Promise<{
  success: true;
  binding?: AdminInternalServiceBindingSummary;
  test?: Record<string, unknown>;
}> {
  if (input.action === 'setStatus') {
    const [row] = await withSystemContext((database) =>
      database
        .update(pluginInternalServiceBindings)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(pluginInternalServiceBindings.id, input.id))
        .returning()
    );
    if (!row) throw new NotFoundError('Internal service binding', input.id);
    return { success: true, binding: toBindingSummary(row) };
  }

  if (input.action === 'rotateSecret') {
    const row = await withSystemContext(async (database) => {
      const existing = await getBindingOrThrow(database, input.id);
      const currentRef =
        input.field === 'auth'
          ? existing.authSecretRef
          : input.field === 'authUsername'
            ? existing.authUsernameRef
            : input.field === 'authPassword'
              ? existing.authPasswordRef
              : existing.actorClaimsSecretRef;
      const nextRef = await writeDbSecret(database, existing.pluginId, currentRef, input.value);
      const update =
        input.field === 'auth'
          ? { authSecretRef: nextRef }
          : input.field === 'authUsername'
            ? { authUsernameRef: nextRef }
            : input.field === 'authPassword'
              ? { authPasswordRef: nextRef }
              : {
                  actorClaimsPreviousSecretRef: existing.actorClaimsSecretRef,
                  actorClaimsPreviousKeyId: existing.actorClaimsKeyId,
                  actorClaimsSecretRef: nextRef,
                  actorClaimsKeyId: `kid-${Date.now()}`,
                };
      const [updated] = await database
        .update(pluginInternalServiceBindings)
        .set({ ...update, updatedAt: new Date() })
        .where(eq(pluginInternalServiceBindings.id, input.id))
        .returning();
      return updated;
    });
    return { success: true, binding: toBindingSummary(row) };
  }

  if (input.action === 'test') {
    const result = await testInternalServiceBinding(input.id, input.path, input.method, options);
    return { success: true, test: result };
  }

  const serviceName = validateServiceName(input.serviceName);
  await assertServiceDeclared(input.pluginId, serviceName);
  assertBindingSecrets(input);
  const now = new Date();
  const row = await withSystemContext(async (database) => {
    const authSecretRef = await writeDbSecret(
      database,
      input.pluginId,
      input.authSecretRef,
      input.authSecretValue
    );
    const authUsernameRef = await writeDbSecret(
      database,
      input.pluginId,
      input.authUsernameRef,
      input.authUsernameValue
    );
    const authPasswordRef = await writeDbSecret(
      database,
      input.pluginId,
      input.authPasswordRef,
      input.authPasswordValue
    );
    const actorClaimsSecretRef = await writeDbSecret(
      database,
      input.pluginId,
      input.actorClaimsSecretRef,
      input.actorClaimsSecretValue
    );
    const scopeId = input.scopeType === 'workspace' ? normalizeNullable(input.scopeId) : null;
    const environment = normalizeNullable(input.environment);
    const existing =
      input.id !== undefined
        ? await getBindingOrThrow(database, input.id)
        : await findInternalServiceBindingForUpsert(database, {
            pluginId: input.pluginId,
            serviceName,
            scopeType: input.scopeType,
            scopeId,
            environment,
          });
    if (
      existing &&
      (existing.pluginId !== input.pluginId ||
        existing.serviceName !== serviceName ||
        existing.scopeType !== input.scopeType ||
        existing.scopeId !== scopeId ||
        existing.environment !== environment)
    ) {
      throw new ValidationError(
        'Existing internal service binding identity cannot be changed by id.'
      );
    }
    const id = existing?.id ?? randomUUID();
    const values = {
      id,
      pluginId: input.pluginId,
      serviceName,
      scopeType: input.scopeType,
      scopeId,
      environment,
      baseUrl: input.baseUrl.replace(/\/+$/, ''),
      authType: input.authType,
      authSecretRef,
      authUsernameRef,
      authPasswordRef,
      authHeaderName: normalizeNullable(input.authHeaderName),
      actorClaimsEnabled: input.actorClaimsEnabled,
      actorClaimsType: input.actorClaimsType,
      actorClaimsAudience: normalizeNullable(input.actorClaimsAudience),
      actorClaimsSecretRef,
      actorClaimsPreviousSecretRef: existing?.actorClaimsPreviousSecretRef ?? null,
      actorClaimsKeyId:
        normalizeNullable(input.actorClaimsKeyId) ??
        (input.actorClaimsEnabled ? `kid-${Date.now()}` : null),
      actorClaimsPreviousKeyId: existing?.actorClaimsPreviousKeyId ?? null,
      actorClaimsTtlSeconds: input.actorClaimsTtlSeconds,
      timeoutMs: input.timeoutMs,
      retryAttempts: input.retryAttempts,
      retryBackoffMs: input.retryBackoffMs,
      maxResponseBytes: input.maxResponseBytes,
      healthPath: normalizeNullable(input.healthPath),
      healthMethod: input.healthMethod.toUpperCase(),
      healthExpectedStatus: input.healthExpectedStatus,
      status: input.status,
      metadata: record(input.metadata),
      createdByUserId: userId,
      updatedAt: now,
    } satisfies NewPluginInternalServiceBinding;

    if (existing) {
      const [updated] = await database
        .update(pluginInternalServiceBindings)
        .set({
          baseUrl: values.baseUrl,
          authType: values.authType,
          authSecretRef: values.authSecretRef,
          authUsernameRef: values.authUsernameRef,
          authPasswordRef: values.authPasswordRef,
          authHeaderName: values.authHeaderName,
          actorClaimsEnabled: values.actorClaimsEnabled,
          actorClaimsType: values.actorClaimsType,
          actorClaimsAudience: values.actorClaimsAudience,
          actorClaimsSecretRef: values.actorClaimsSecretRef,
          actorClaimsPreviousSecretRef: values.actorClaimsPreviousSecretRef,
          actorClaimsKeyId: values.actorClaimsKeyId,
          actorClaimsPreviousKeyId: values.actorClaimsPreviousKeyId,
          actorClaimsTtlSeconds: values.actorClaimsTtlSeconds,
          timeoutMs: values.timeoutMs,
          retryAttempts: values.retryAttempts,
          retryBackoffMs: values.retryBackoffMs,
          maxResponseBytes: values.maxResponseBytes,
          healthPath: values.healthPath,
          healthMethod: values.healthMethod,
          healthExpectedStatus: values.healthExpectedStatus,
          status: values.status,
          metadata: values.metadata,
          updatedAt: now,
        })
        .where(eq(pluginInternalServiceBindings.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await database
      .insert(pluginInternalServiceBindings)
      .values(values)
      .returning();
    return created;
  });

  return { success: true, binding: toBindingSummary(row) };
}

function contractForServiceTest(
  pluginId: string,
  service: PluginServiceDefinition
): PluginCapabilityScope['contract'] {
  return {
    id: pluginId,
    name: pluginId,
    version: '0.0.0',
    kind: 'app',
    trustLevel: 'trusted',
    permissions: [Permission.ServicesInvoke],
    menu: [],
    slots: {},
    hostPages: { slots: [], overrides: [] },
    resources: {},
    events: {},
    jobs: {},
    webhooks: {},
    hooks: {},
    meters: [],
    services: [service],
    resourceBindings: [],
    egress: [],
    definition: {
      id: pluginId,
      name: pluginId,
      version: '0.0.0',
      kind: 'app',
      trustLevel: 'trusted',
      permissions: [Permission.ServicesInvoke],
      services: [service],
    },
    routes: { pages: [], apis: [], all: [] },
    lifecycle: {},
  };
}

export async function testInternalServiceBinding(
  id: string,
  path?: string,
  method?: string,
  options: { registry?: PluginInternalServiceRegistry; httpHost?: PluginServicesHttpHost } = {}
) {
  const row = await withSystemContext((database) => getBindingOrThrow(database, id));
  if (row.status === 'disabled') {
    throw new ForbiddenError('Disabled internal service bindings cannot be tested.');
  }
  const serviceDeclaration = await assertServiceDeclared(row.pluginId, row.serviceName);
  const testPath = normalizePath(normalizeNullable(path) ?? row.healthPath ?? '/');
  const testMethod = (method ?? row.healthMethod ?? 'GET').toUpperCase();
  const started = Date.now();
  let status = 'unknown';
  let error: string | null = null;
  let httpStatus: number | null = null;

  try {
    const registry = options.registry ?? new DbPluginInternalServiceRegistry();
    const service = await registry.get({
      pluginId: row.pluginId,
      serviceName: row.serviceName,
      workspaceId: row.scopeType === 'workspace' ? (row.scopeId ?? undefined) : undefined,
      environment: row.environment ?? undefined,
    });
    if (!service) {
      throw new ValidationError('Internal service binding could not be resolved.');
    }
    const url = new URL(testPath, service.baseUrl);
    const headers = new Headers();
    const resourceScope: NormalizedPluginResourceScope | undefined =
      row.scopeType === 'workspace' && row.scopeId
        ? { type: 'workspace', id: row.scopeId }
        : undefined;
    applyInternalServiceRequestHeaders(headers, {
      service,
      resourceScope,
      scope: {
        contract: contractForServiceTest(row.pluginId, serviceDeclaration),
        user: null,
        request: new Request(url),
        requestId: `health-${randomUUID()}`,
        system: true,
      },
    });
    const response = await (options.httpHost ?? { fetch }).fetch(url.toString(), {
      method: testMethod,
      headers,
      signal: AbortSignal.timeout(service.timeoutMs ?? 30000),
    });
    httpStatus = response.status;
    status = response.status === row.healthExpectedStatus ? 'ok' : 'unexpected_status';
  } catch (caught) {
    status = 'error';
    error = caught instanceof Error ? caught.message : String(caught);
  }

  await withSystemContext(async (database) => {
    await database
      .update(pluginInternalServiceBindings)
      .set({
        lastCheckedAt: new Date(),
        lastCheckStatus: status,
        lastCheckError: error,
        updatedAt: new Date(),
      })
      .where(eq(pluginInternalServiceBindings.id, id));
  });

  return {
    bindingId: id,
    pluginId: row.pluginId,
    serviceName: row.serviceName,
    method: testMethod,
    path: testPath,
    status,
    httpStatus,
    expectedStatus: row.healthExpectedStatus,
    error,
    durationMs: Date.now() - started,
  };
}

export async function listInternalServiceCallLogs(
  input: z.infer<typeof internalServiceLogsQuerySchema>
) {
  const conditions: SQL[] = [];
  if (input.pluginId) conditions.push(eq(pluginServiceCallLogs.pluginId, input.pluginId));
  if (input.serviceName) conditions.push(eq(pluginServiceCallLogs.serviceName, input.serviceName));
  if (input.workspaceId) conditions.push(eq(pluginServiceCallLogs.workspaceId, input.workspaceId));
  if (input.requestId) conditions.push(eq(pluginServiceCallLogs.requestId, input.requestId));
  if (input.status !== undefined) conditions.push(eq(pluginServiceCallLogs.status, input.status));
  if (input.errorCode) conditions.push(ilike(pluginServiceCallLogs.errorCode, input.errorCode));

  const rows = await withSystemContext((database) =>
    database
      .select()
      .from(pluginServiceCallLogs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(pluginServiceCallLogs.createdAt))
      .limit(input.limit)
  );
  return rows.map(toCallLogSummary);
}

export async function applyInternalServiceCallLogRetention(
  input: z.infer<typeof internalServiceLogsRetentionSchema>
): Promise<AdminServiceCallLogRetentionResult> {
  const cutoff = new Date(Date.now() - input.retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await withSystemContext(async (database) => {
    const rows = await database
      .delete(pluginServiceCallLogs)
      .where(lt(pluginServiceCallLogs.createdAt, cutoff))
      .returning();
    return rows.length;
  });

  return {
    retentionDays: input.retentionDays,
    cutoff: cutoff.toISOString(),
    deleted,
  };
}

export async function listAdminResourceBindings(
  input: z.infer<typeof resourceBindingAdminListQuerySchema>
) {
  const conditions: SQL[] = [];
  if (input.pluginId) conditions.push(eq(pluginResourceBindings.pluginId, input.pluginId));
  if (input.scopeType) conditions.push(eq(pluginResourceBindings.scopeType, input.scopeType));
  if (input.workspaceId) {
    conditions.push(eq(pluginResourceBindings.scopeType, 'workspace'));
    conditions.push(eq(pluginResourceBindings.scopeId, input.workspaceId));
  }
  if (input.resourceType)
    conditions.push(eq(pluginResourceBindings.resourceType, input.resourceType));
  if (input.status) conditions.push(eq(pluginResourceBindings.status, input.status));

  const rows = await withSystemContext((database) =>
    database
      .select()
      .from(pluginResourceBindings)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(pluginResourceBindings.updatedAt))
      .limit(input.limit)
  );
  return rows.map(toResourceBindingSummary);
}

export async function handleAdminResourceBindingAction(
  input: z.infer<typeof resourceBindingAdminActionSchema>
) {
  const now = new Date();
  const [row] = await withSystemContext((database) =>
    database
      .update(pluginResourceBindings)
      .set({
        status: input.status,
        archivedAt: input.status === 'archived' ? now : null,
        updatedAt: now,
      })
      .where(eq(pluginResourceBindings.id, input.id))
      .returning()
  );
  if (!row) {
    throw new NotFoundError('Resource binding', input.id);
  }
  return { success: true, binding: toResourceBindingSummary(row) };
}
