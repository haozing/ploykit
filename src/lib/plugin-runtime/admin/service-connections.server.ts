import { randomUUID } from 'crypto';
import { and, desc, eq, ilike, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { Permission } from '@ploykit/plugin-sdk';
import type { PluginServiceRequirementDefinition } from '@ploykit/plugin-sdk';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/_core/errors';
import { env } from '@/lib/_core/env';
import { db, withSystemContext, type Database } from '@/lib/db/client.server';
import {
  pluginServiceConnections,
  pluginResourceBindings,
  pluginServiceConnectionLogs,
  type NewPluginServiceConnection,
  type PluginServiceConnection,
  type PluginResourceBinding,
  type PluginServiceConnectionLog,
} from '@/lib/db/schema/plugin-platform';
import { getPluginRuntimeMapEntry } from '../loader';
import { getCurrentRuntimeProductId } from '../product-context.server';
import { pluginRuntimeRegistry } from '../registry';
import { pluginQueryService } from '@/lib/plugins/plugin-query.server';
import { DbHostSecretStore } from '../secrets/host-secret-store.server';
import {
  applyServiceConnectionRequestHeaders,
  DbPluginServiceConnectionRegistry,
  type PluginServiceConnectionRegistry,
  type PluginServicesHttpHost,
} from '../capabilities/services-capability.server';
import type { NormalizedPluginResourceScope, PluginCapabilityScope } from '../capabilities';

type TransactionDatabase = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Database | TransactionDatabase;

const connectionScopeSchema = z.enum(['global', 'workspace']);
const connectionStatusSchema = z.enum(['active', 'disabled']);
const connectionAuthTypeSchema = z.enum(['none', 'bearer', 'basic', 'apiKey']);
const connectionActorClaimsTypeSchema = z.enum(['hmac', 'jwt']);
const connectionOwnerTypeSchema = z.enum(['plugin', 'suite', 'product']);
const secretSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('env'), name: z.string().min(1).max(300) }),
  z.object({
    type: z.literal('encrypted'),
    ref: z.string().max(500).optional().nullable(),
    value: z.string().max(10000).optional(),
  }),
]);

export const serviceConnectionListQuerySchema = z.object({
  productId: z.string().min(1).max(120).optional(),
  pluginId: z.string().min(1).max(120).optional(),
  ownerType: connectionOwnerTypeSchema.optional(),
  ownerId: z.string().min(1).max(120).optional(),
  serviceName: z.string().min(1).max(120).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  workspaceId: z.string().min(1).max(200).optional(),
  environment: z.string().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const serviceConnectionRequirementsQuerySchema = z.object({
  productId: z.string().min(1).max(120).optional(),
  pluginId: z.string().min(1).max(120).optional(),
  serviceName: z.string().min(1).max(120).optional(),
  environment: z.string().min(1).max(80).optional(),
  workspaceId: z.string().min(1).max(200).optional(),
});

export const serviceConnectionLogsQuerySchema = z.object({
  pluginId: z.string().min(1).max(120).optional(),
  serviceName: z.string().min(1).max(120).optional(),
  workspaceId: z.string().min(1).max(200).optional(),
  requestId: z.string().min(1).max(200).optional(),
  status: z.coerce.number().int().optional(),
  errorCode: z.string().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const serviceConnectionLogsRetentionSchema = z.object({
  retentionDays: z
    .number()
    .int()
    .min(1)
    .max(3650)
    .default(env.PLUGIN_SERVICE_CONNECTION_LOG_RETENTION_DAYS),
});

export const resourceBindingAdminListQuerySchema = z.object({
  productId: z.string().min(1).max(120).optional(),
  pluginId: z.string().min(1).max(120).optional(),
  ownerType: connectionOwnerTypeSchema.optional(),
  ownerId: z.string().min(1).max(120).optional(),
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

export const serviceConnectionActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('upsert'),
    id: z.string().min(1).max(200).optional(),
    productId: z.string().min(1).max(120).optional(),
    pluginId: z.string().min(1).max(120),
    ownerType: connectionOwnerTypeSchema.default('plugin'),
    ownerId: z.string().min(1).max(120).optional(),
    serviceName: z.string().min(1).max(120),
    scopeType: connectionScopeSchema.default('global'),
    scopeId: z.string().max(200).optional().nullable(),
    environment: z.string().max(80).optional().nullable(),
    baseUrl: z.string().url(),
    authType: connectionAuthTypeSchema.default('none'),
    authSecretSource: secretSourceSchema.optional(),
    authUsernameSource: secretSourceSchema.optional(),
    authPasswordSource: secretSourceSchema.optional(),
    authHeaderName: z.string().max(120).optional().nullable(),
    actorClaimsEnabled: z.boolean().default(false),
    actorClaimsType: connectionActorClaimsTypeSchema.default('hmac'),
    actorClaimsAudience: z.string().max(200).optional().nullable(),
    actorClaimsSecretSource: secretSourceSchema.optional(),
    actorClaimsKeyId: z.string().max(120).optional().nullable(),
    actorClaimsTtlSeconds: z.number().int().min(10).max(300).default(60),
    timeoutMs: z.number().int().min(100).max(300000).default(30000),
    retryAttempts: z.number().int().min(0).max(5).default(0),
    retryBackoffMs: z.number().int().min(0).max(30000).default(250),
    maxResponseBytes: z.number().int().min(1024).max(52428800).default(10485760),
    healthPath: z.string().max(500).optional().nullable(),
    healthMethod: z.string().max(20).default('GET'),
    healthExpectedStatus: z.number().int().min(100).max(599).default(200),
    status: connectionStatusSchema.default('active'),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    action: z.literal('setStatus'),
    id: z.string().min(1).max(200),
    status: connectionStatusSchema,
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

export type ServiceConnectionActionInput = z.infer<typeof serviceConnectionActionSchema>;

export type AdminSecretSourceSummary =
  | { type: 'none'; label: string }
  | { type: 'env'; name: string; label: string }
  | { type: 'encrypted'; name: string; label: string }
  | { type: 'invalid'; ref: string; label: string };

export interface AdminServiceConnectionSummary {
  id: string;
  productId: string;
  pluginId: string;
  ownerType: string;
  ownerId: string;
  serviceName: string;
  scopeType: string;
  scopeId?: string;
  environment?: string;
  baseUrl: string;
  authType: string;
  authSecretSource: AdminSecretSourceSummary;
  authUsernameSource: AdminSecretSourceSummary;
  authPasswordSource: AdminSecretSourceSummary;
  authHeaderName?: string;
  actorClaimsEnabled: boolean;
  actorClaimsType: string;
  actorClaimsAudience?: string;
  actorClaimsSecretSource: AdminSecretSourceSummary;
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

export interface AdminServiceConnectionRequirement {
  productId: string;
  pluginId: string;
  ownerType: 'plugin' | 'suite' | 'product';
  ownerId: string;
  serviceName: string;
  methods: readonly string[];
  paths: readonly string[];
  actorClaims: boolean;
  required: boolean;
  connectionStatus: 'bound' | 'missing' | 'disabled';
  connection?: AdminServiceConnectionSummary;
}

export interface AdminServiceConnectionLogSummary {
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

export interface AdminServiceConnectionLogRetentionResult {
  retentionDays: number;
  cutoff: string;
  deleted: number;
}

export interface AdminResourceBindingSummary {
  id: string;
  productId: string;
  pluginId: string;
  ownerType: string;
  ownerId: string;
  visibility: string;
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
    throw new ValidationError('Service connection paths must start with "/".');
  }
  return trimmed;
}

function validateServiceName(name: string): string {
  const normalized = name.trim();
  if (!/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
    throw new ValidationError('Service connection name is invalid.');
  }
  return normalized;
}

async function resolveRuntimeOwner(input: {
  productId?: string;
  pluginId: string;
  ownerType?: 'plugin' | 'suite' | 'product';
  ownerId?: string;
}): Promise<{ productId: string; ownerType: 'plugin' | 'suite' | 'product'; ownerId: string }> {
  const productId = input.productId ?? getCurrentRuntimeProductId();
  const ownerType = input.ownerType ?? 'plugin';
  const installation =
    ownerType === 'suite'
      ? await pluginQueryService.getInstallation(input.pluginId, { productId })
      : null;
  const ownerId =
    input.ownerId ??
    (ownerType === 'plugin'
      ? input.pluginId
      : ownerType === 'suite'
        ? installation?.suiteId
        : productId);

  if (!ownerId) {
    throw new ValidationError(
      `Cannot resolve ${ownerType} owner for plugin "${input.pluginId}". Install it with a suiteId or pass ownerId explicitly.`
    );
  }
  if (ownerType === 'plugin' && ownerId !== input.pluginId) {
    throw new ValidationError('Plugin-owned service connections must use the plugin id as owner.');
  }
  if (ownerType === 'product' && ownerId !== productId) {
    throw new ValidationError(
      'Product-owned service connections must use the product id as owner.'
    );
  }
  if (ownerType === 'suite' && installation?.suiteId && ownerId !== installation.suiteId) {
    throw new ValidationError(
      `Suite-owned service connections for "${input.pluginId}" must use suite "${installation.suiteId}".`
    );
  }

  return { productId, ownerType, ownerId };
}

function resolveServiceRequirementOwner(input: {
  productId: string;
  pluginId: string;
  serviceName: string;
}): { productId: string; ownerType: 'plugin' | 'suite' | 'product'; ownerId: string } {
  return { productId: input.productId, ownerType: 'plugin', ownerId: input.pluginId };
}

type SecretSourceInput = z.infer<typeof secretSourceSchema>;

function toSecretSourceSummary(ref: string | null | undefined): AdminSecretSourceSummary {
  if (!ref) {
    return { type: 'none', label: 'none' };
  }
  if (ref.startsWith('env:')) {
    const name = ref.slice('env:'.length);
    return { type: 'env', name, label: `Environment variable (${name})` };
  }
  if (ref.startsWith('dbsec:')) {
    const name = ref.slice('dbsec:'.length);
    return { type: 'encrypted', name, label: 'Encrypted database secret' };
  }
  return { type: 'invalid', ref, label: 'Invalid secret source' };
}

function validateEnvSecretName(name: string): string {
  const normalized = name.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    throw new ValidationError('Environment secret names must look like ENV_VAR_NAME.');
  }
  return normalized;
}

function normalizeDbSecretRef(ref: string | null | undefined): string | null {
  const normalized = normalizeNullable(ref);
  if (!normalized) return null;
  if (!normalized.startsWith('dbsec:')) {
    throw new ValidationError('Encrypted secret refs must use dbsec:.');
  }
  return normalized;
}

async function resolveSecretSource(
  executor: Executor,
  source: SecretSourceInput | undefined,
  existingRef: string | null | undefined,
  createdByUserId?: string
): Promise<string | null> {
  if (!source) {
    return existingRef ?? null;
  }
  if (source.type === 'none') {
    return null;
  }
  if (source.type === 'env') {
    return `env:${validateEnvSecretName(source.name)}`;
  }

  const existingDbRef = normalizeDbSecretRef(source.ref ?? existingRef);
  if (source.value === undefined) {
    return existingDbRef;
  }

  const store = new DbHostSecretStore(executor);
  const name = await store.set({
    name: existingDbRef?.slice('dbsec:'.length),
    value: source.value,
    createdByUserId,
  });
  return `dbsec:${name}`;
}

function assertResolvedBindingSecrets(
  input: Extract<ServiceConnectionActionInput, { action: 'upsert' }>,
  refs: {
    authSecretRef: string | null;
    authUsernameRef: string | null;
    authPasswordRef: string | null;
    actorClaimsSecretRef: string | null;
  }
) {
  if ((input.authType === 'bearer' || input.authType === 'apiKey') && !refs.authSecretRef) {
    throw new ValidationError('Bearer and API key service auth require a secret source.');
  }

  if (input.authType === 'basic' && (!refs.authUsernameRef || !refs.authPasswordRef)) {
    throw new ValidationError('Basic service auth requires username and password secret sources.');
  }

  if (input.actorClaimsEnabled && !refs.actorClaimsSecretRef) {
    throw new ValidationError('Actor claims require a signing secret source.');
  }
}

function assertCreateSecretSources(
  input: Extract<ServiceConnectionActionInput, { action: 'upsert' }>
) {
  if (input.id) {
    return;
  }

  if (
    (input.authType === 'bearer' || input.authType === 'apiKey') &&
    (!input.authSecretSource || input.authSecretSource.type === 'none')
  ) {
    throw new ValidationError('Bearer and API key service auth require a secret source.');
  }

  if (
    input.authType === 'basic' &&
    (!input.authUsernameSource ||
      input.authUsernameSource.type === 'none' ||
      !input.authPasswordSource ||
      input.authPasswordSource.type === 'none')
  ) {
    throw new ValidationError('Basic service auth requires username and password secret sources.');
  }

  if (
    input.actorClaimsEnabled &&
    (!input.actorClaimsSecretSource || input.actorClaimsSecretSource.type === 'none')
  ) {
    throw new ValidationError('Actor claims require a signing secret source.');
  }
}

function toConnectionSummary(row: PluginServiceConnection): AdminServiceConnectionSummary {
  return {
    id: row.id,
    productId: row.productId,
    pluginId: row.pluginId,
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    serviceName: row.serviceName,
    scopeType: row.scopeType,
    scopeId: row.scopeId ?? undefined,
    environment: row.environment ?? undefined,
    baseUrl: row.baseUrl,
    authType: row.authType,
    authSecretSource: toSecretSourceSummary(row.authSecretRef),
    authUsernameSource: toSecretSourceSummary(row.authUsernameRef),
    authPasswordSource: toSecretSourceSummary(row.authPasswordRef),
    authHeaderName: row.authHeaderName ?? undefined,
    actorClaimsEnabled: row.actorClaimsEnabled,
    actorClaimsType: row.actorClaimsType,
    actorClaimsAudience: row.actorClaimsAudience ?? undefined,
    actorClaimsSecretSource: toSecretSourceSummary(row.actorClaimsSecretRef),
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

function toCallLogSummary(row: PluginServiceConnectionLog): AdminServiceConnectionLogSummary {
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
    productId: row.productId,
    pluginId: row.pluginId,
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    visibility: row.visibility,
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
): Promise<PluginServiceRequirementDefinition> {
  const entry = getPluginRuntimeMapEntry(pluginId);
  if (!entry?.plugin && !entry?.runtimeContract) {
    throw new NotFoundError('Plugin', pluginId);
  }
  const contract = await pluginRuntimeRegistry.getOrLoad(pluginId, entry);
  const service = contract.serviceRequirements.find((candidate) => candidate.name === serviceName);
  if (!service) {
    throw new ValidationError(`Plugin "${pluginId}" does not declare service "${serviceName}".`, {
      pluginId,
      serviceName,
    });
  }
  return service;
}

async function getBindingOrThrow(executor: Executor, id: string): Promise<PluginServiceConnection> {
  const [row] = await executor
    .select()
    .from(pluginServiceConnections)
    .where(eq(pluginServiceConnections.id, id))
    .limit(1);
  if (!row) {
    throw new NotFoundError('Service connection', id);
  }
  return row;
}

async function findServiceConnectionForUpsert(
  executor: Executor,
  input: {
    productId: string;
    pluginId: string;
    ownerType: string;
    ownerId: string;
    serviceName: string;
    scopeType: string;
    scopeId: string | null;
    environment: string | null;
  }
): Promise<PluginServiceConnection | null> {
  const conditions: SQL[] = [
    eq(pluginServiceConnections.productId, input.productId),
    eq(pluginServiceConnections.ownerType, input.ownerType),
    eq(pluginServiceConnections.ownerId, input.ownerId),
    eq(pluginServiceConnections.serviceName, input.serviceName),
    eq(pluginServiceConnections.scopeType, input.scopeType),
  ];

  if (input.scopeId) {
    conditions.push(eq(pluginServiceConnections.scopeId, input.scopeId));
  } else {
    conditions.push(sql`${pluginServiceConnections.scopeId} IS NULL`);
  }

  if (input.environment) {
    conditions.push(eq(pluginServiceConnections.environment, input.environment));
  } else {
    conditions.push(sql`${pluginServiceConnections.environment} IS NULL`);
  }

  const [row] = await executor
    .select()
    .from(pluginServiceConnections)
    .where(and(...conditions))
    .limit(1);
  return row ?? null;
}

export async function listServiceConnections(
  input: z.infer<typeof serviceConnectionListQuerySchema>
) {
  const productId = input.productId ?? getCurrentRuntimeProductId();
  const conditions: SQL[] = [eq(pluginServiceConnections.productId, productId)];
  if (input.pluginId) conditions.push(eq(pluginServiceConnections.pluginId, input.pluginId));
  if (input.ownerType) conditions.push(eq(pluginServiceConnections.ownerType, input.ownerType));
  if (input.ownerId) conditions.push(eq(pluginServiceConnections.ownerId, input.ownerId));
  if (input.serviceName)
    conditions.push(eq(pluginServiceConnections.serviceName, input.serviceName));
  if (input.status) conditions.push(eq(pluginServiceConnections.status, input.status));
  if (input.environment) {
    conditions.push(eq(pluginServiceConnections.environment, input.environment));
  }
  if (input.workspaceId) {
    conditions.push(
      or(
        eq(pluginServiceConnections.scopeType, 'global'),
        and(
          eq(pluginServiceConnections.scopeType, 'workspace'),
          eq(pluginServiceConnections.scopeId, input.workspaceId)
        )
      )!
    );
  }

  const rows = await withSystemContext((database) =>
    database
      .select()
      .from(pluginServiceConnections)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(pluginServiceConnections.updatedAt))
      .limit(input.limit)
  );
  return rows.map(toConnectionSummary);
}

export async function listServiceConnectionRequirements(
  input: z.infer<typeof serviceConnectionRequirementsQuerySchema>
): Promise<AdminServiceConnectionRequirement[]> {
  const productId = input.productId ?? getCurrentRuntimeProductId();
  const pluginIds = input.pluginId
    ? [input.pluginId]
    : [
        ...new Set(
          (await pluginQueryService.listInstalledPlugins({ productId }))
            .filter((installation) => installation.installStatus === 'installed')
            .map((installation) => installation.pluginId)
        ),
      ];
  const registry = new DbPluginServiceConnectionRegistry();
  const requirements: AdminServiceConnectionRequirement[] = [];

  for (const pluginId of pluginIds) {
    const entry = getPluginRuntimeMapEntry(pluginId);
    if (!entry?.plugin && !entry?.runtimeContract) {
      continue;
    }
    const contract = await pluginRuntimeRegistry.getOrLoad(pluginId, entry);
    for (const service of contract.serviceRequirements) {
      if (input.serviceName && service.name !== input.serviceName) {
        continue;
      }
      const owner = resolveServiceRequirementOwner({
        productId,
        pluginId,
        serviceName: service.name,
      });
      const activeBinding = await registry.resolveBinding({
        pluginId,
        productId,
        serviceName: service.name,
        workspaceId: input.workspaceId,
        environment: input.environment,
        status: 'active',
      });
      const inactiveBinding =
        activeBinding ??
        (await registry.resolveBinding({
          pluginId,
          productId,
          serviceName: service.name,
          workspaceId: input.workspaceId,
          environment: input.environment,
          status: 'disabled',
        }));
      const connection = inactiveBinding ? toConnectionSummary(inactiveBinding) : undefined;
      requirements.push({
        productId,
        pluginId,
        ownerType:
          connection?.ownerType === 'suite' || connection?.ownerType === 'product'
            ? connection.ownerType
            : owner.ownerType,
        ownerId: connection?.ownerId ?? owner.ownerId,
        serviceName: service.name,
        methods: service.methods,
        paths: service.paths,
        actorClaims: service.actorClaims === true,
        required: service.required !== false,
        connectionStatus: activeBinding ? 'bound' : inactiveBinding ? 'disabled' : 'missing',
        connection,
      });
    }
  }

  return requirements;
}

export async function handleServiceConnectionAction(
  input: ServiceConnectionActionInput,
  userId?: string,
  options: { registry?: PluginServiceConnectionRegistry; httpHost?: PluginServicesHttpHost } = {}
): Promise<{
  success: true;
  connection?: AdminServiceConnectionSummary;
  test?: Record<string, unknown>;
}> {
  if (input.action === 'setStatus') {
    const [row] = await withSystemContext((database) =>
      database
        .update(pluginServiceConnections)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(pluginServiceConnections.id, input.id))
        .returning()
    );
    if (!row) throw new NotFoundError('Service connection', input.id);
    return { success: true, connection: toConnectionSummary(row) };
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
      const nextRef = await resolveSecretSource(
        database,
        {
          type: 'encrypted',
          ref: currentRef?.startsWith('dbsec:') ? currentRef : undefined,
          value: input.value,
        },
        currentRef,
        userId
      );
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
        .update(pluginServiceConnections)
        .set({ ...update, updatedAt: new Date() })
        .where(eq(pluginServiceConnections.id, input.id))
        .returning();
      return updated;
    });
    return { success: true, connection: toConnectionSummary(row) };
  }

  if (input.action === 'test') {
    const result = await testServiceConnection(input.id, input.path, input.method, options);
    return { success: true, test: result };
  }

  const serviceName = validateServiceName(input.serviceName);
  assertCreateSecretSources(input);
  await assertServiceDeclared(input.pluginId, serviceName);
  const owner = await resolveRuntimeOwner({
    productId: input.productId,
    pluginId: input.pluginId,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
  });
  const now = new Date();
  const row = await withSystemContext(async (database) => {
    const scopeId = input.scopeType === 'workspace' ? normalizeNullable(input.scopeId) : null;
    const environment = normalizeNullable(input.environment);
    const existing =
      input.id !== undefined
        ? await getBindingOrThrow(database, input.id)
        : await findServiceConnectionForUpsert(database, {
            productId: owner.productId,
            pluginId: input.pluginId,
            ownerType: owner.ownerType,
            ownerId: owner.ownerId,
            serviceName,
            scopeType: input.scopeType,
            scopeId,
            environment,
          });
    if (
      existing &&
      (existing.productId !== owner.productId ||
        existing.ownerType !== owner.ownerType ||
        existing.ownerId !== owner.ownerId ||
        existing.pluginId !== input.pluginId ||
        existing.serviceName !== serviceName ||
        existing.scopeType !== input.scopeType ||
        existing.scopeId !== scopeId ||
        existing.environment !== environment)
    ) {
      throw new ValidationError('Existing service connection identity cannot be changed by id.');
    }
    const authSecretRef = await resolveSecretSource(
      database,
      input.authSecretSource,
      existing?.authSecretRef,
      userId
    );
    const authUsernameRef = await resolveSecretSource(
      database,
      input.authUsernameSource,
      existing?.authUsernameRef,
      userId
    );
    const authPasswordRef = await resolveSecretSource(
      database,
      input.authPasswordSource,
      existing?.authPasswordRef,
      userId
    );
    const actorClaimsSecretRef = await resolveSecretSource(
      database,
      input.actorClaimsSecretSource,
      existing?.actorClaimsSecretRef,
      userId
    );
    assertResolvedBindingSecrets(input, {
      authSecretRef,
      authUsernameRef,
      authPasswordRef,
      actorClaimsSecretRef,
    });
    const id = existing?.id ?? randomUUID();
    const values = {
      id,
      productId: owner.productId,
      pluginId: input.pluginId,
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
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
    } satisfies NewPluginServiceConnection;

    if (existing) {
      const [updated] = await database
        .update(pluginServiceConnections)
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
        .where(eq(pluginServiceConnections.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await database.insert(pluginServiceConnections).values(values).returning();
    return created;
  });

  return { success: true, connection: toConnectionSummary(row) };
}

function contractForServiceTest(
  pluginId: string,
  service: PluginServiceRequirementDefinition
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
    serviceRequirements: [service],
    resourceBindings: [],
    egress: [],
    definition: {
      id: pluginId,
      name: pluginId,
      version: '0.0.0',
      kind: 'app',
      trustLevel: 'trusted',
      permissions: [Permission.ServicesInvoke],
      serviceRequirements: [service],
    },
    routes: { pages: [], apis: [], all: [] },
    lifecycle: {},
  };
}

export async function testServiceConnection(
  id: string,
  path?: string,
  method?: string,
  options: { registry?: PluginServiceConnectionRegistry; httpHost?: PluginServicesHttpHost } = {}
) {
  const row = await withSystemContext((database) => getBindingOrThrow(database, id));
  if (row.status === 'disabled') {
    throw new ForbiddenError('Disabled service connections cannot be tested.');
  }
  const serviceDeclaration = await assertServiceDeclared(row.pluginId, row.serviceName);
  const testPath = normalizePath(normalizeNullable(path) ?? row.healthPath ?? '/');
  const testMethod = (method ?? row.healthMethod ?? 'GET').toUpperCase();
  const started = Date.now();
  let status = 'unknown';
  let error: string | null = null;
  let httpStatus: number | null = null;

  try {
    const registry = options.registry ?? new DbPluginServiceConnectionRegistry();
    const service = await registry.get({
      pluginId: row.pluginId,
      productId: row.productId,
      serviceName: row.serviceName,
      workspaceId: row.scopeType === 'workspace' ? (row.scopeId ?? undefined) : undefined,
      environment: row.environment ?? undefined,
    });
    if (!service) {
      throw new ValidationError('Service connection could not be resolved.');
    }
    const url = new URL(testPath, service.baseUrl);
    const headers = new Headers();
    const resourceScope: NormalizedPluginResourceScope | undefined =
      row.scopeType === 'workspace' && row.scopeId
        ? { type: 'workspace', id: row.scopeId }
        : undefined;
    applyServiceConnectionRequestHeaders(headers, {
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
      .update(pluginServiceConnections)
      .set({
        lastCheckedAt: new Date(),
        lastCheckStatus: status,
        lastCheckError: error,
        updatedAt: new Date(),
      })
      .where(eq(pluginServiceConnections.id, id));
  });

  return {
    connectionId: id,
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

export async function listServiceConnectionCallLogs(
  input: z.infer<typeof serviceConnectionLogsQuerySchema>
) {
  const conditions: SQL[] = [];
  if (input.pluginId) conditions.push(eq(pluginServiceConnectionLogs.pluginId, input.pluginId));
  if (input.serviceName)
    conditions.push(eq(pluginServiceConnectionLogs.serviceName, input.serviceName));
  if (input.workspaceId)
    conditions.push(eq(pluginServiceConnectionLogs.workspaceId, input.workspaceId));
  if (input.requestId) conditions.push(eq(pluginServiceConnectionLogs.requestId, input.requestId));
  if (input.status !== undefined)
    conditions.push(eq(pluginServiceConnectionLogs.status, input.status));
  if (input.errorCode)
    conditions.push(ilike(pluginServiceConnectionLogs.errorCode, input.errorCode));

  const rows = await withSystemContext((database) =>
    database
      .select()
      .from(pluginServiceConnectionLogs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(pluginServiceConnectionLogs.createdAt))
      .limit(input.limit)
  );
  return rows.map(toCallLogSummary);
}

export async function applyServiceConnectionCallLogRetention(
  input: z.infer<typeof serviceConnectionLogsRetentionSchema>
): Promise<AdminServiceConnectionLogRetentionResult> {
  const cutoff = new Date(Date.now() - input.retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await withSystemContext(async (database) => {
    const rows = await database
      .delete(pluginServiceConnectionLogs)
      .where(lt(pluginServiceConnectionLogs.createdAt, cutoff))
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
  const productId = input.productId ?? getCurrentRuntimeProductId();
  const conditions: SQL[] = [eq(pluginResourceBindings.productId, productId)];
  if (input.pluginId) conditions.push(eq(pluginResourceBindings.pluginId, input.pluginId));
  if (input.ownerType) conditions.push(eq(pluginResourceBindings.ownerType, input.ownerType));
  if (input.ownerId) conditions.push(eq(pluginResourceBindings.ownerId, input.ownerId));
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
