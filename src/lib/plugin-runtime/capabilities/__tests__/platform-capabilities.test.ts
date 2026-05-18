import { beforeEach, describe, expect, it, vi } from 'vitest';
import { definePlugin, Permission, PluginError, type PermissionValue } from '@ploykit/plugin-sdk';
import type { UsageLedger, UsageRecord } from '@/lib/usage/usage-ledger.server';
import type {
  PluginApiKey,
  PluginConnector,
  PluginFile,
  PluginRun,
  PluginRunLog,
  PluginRunResult,
  Workspace,
  WorkspaceInvitation,
  WorkspaceMember,
} from '@/lib/db/schema/plugin-platform';
import { normalizePluginRuntimeContract } from '../../contract';
import {
  createPluginApiKeysCapability,
  createPluginConnectorsCapability,
  createPluginRateLimitCapability,
  createPluginRunsCapability,
  createPluginWorkspaceCapability,
  withPluginResourceScopeAccessOverride,
  DbPluginApiKeysRepository,
  type PluginApiKeysRepository,
  type PluginConnectorFilesHost,
  type PluginConnectorHttpHost,
  type PluginConnectorSecretHost,
  type PluginConnectorsRepository,
  type PluginFilesRepository,
  type PluginFilesScope,
  type PluginRateLimitRepository,
  type PluginRunsRepository,
  type PluginWorkspaceRepository,
} from '..';
import { enforcePluginRuntimeAuth } from '../../context';

vi.mock('../api-keys-capability.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api-keys-capability.server')>();
  return {
    ...actual,
    DbPluginApiKeysRepository: vi.fn(),
  };
});

function createScope(
  permissions: PermissionValue[],
  user: { id: string; role: 'admin' | 'user'; email: string } = {
    id: 'user-1',
    role: 'user',
    email: 'user@example.test',
  }
) {
  return {
    contract: normalizePluginRuntimeContract(
      definePlugin({
        id: 'platform-test',
        name: 'Platform Test',
        version: '1.0.0',
        permissions,
      })
    ),
    user,
    request: new Request('https://test.local/api/plugins/platform-test/run'),
    requestId: 'request-1',
  };
}

function buildWorkspaceRow(input: Partial<Workspace> & Pick<Workspace, 'id' | 'ownerUserId'>) {
  const now = new Date('2026-05-12T00:00:00.000Z');
  return {
    id: input.id,
    name: input.name ?? input.id,
    slug: input.slug ?? null,
    ownerUserId: input.ownerUserId,
    status: input.status ?? 'active',
    metadata: input.metadata ?? {},
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  } satisfies Workspace;
}

function buildWorkspaceMemberRow(
  input: Partial<WorkspaceMember> & Pick<WorkspaceMember, 'id' | 'workspaceId' | 'userId' | 'role'>
) {
  const now = new Date('2026-05-12T00:00:00.000Z');
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    userId: input.userId,
    role: input.role,
    status: input.status ?? 'active',
    email: input.email ?? `${input.userId}@example.test`,
    joinedAt: input.joinedAt ?? now,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  } satisfies WorkspaceMember;
}

class MemoryWorkspaceRepository implements PluginWorkspaceRepository {
  readonly workspaces = new Map<string, Workspace>();
  readonly membersByWorkspace = new Map<string, WorkspaceMember[]>();
  readonly invitations: WorkspaceInvitation[] = [];

  async current(scope: Parameters<PluginWorkspaceRepository['current']>[0]) {
    return (await this.list(scope))[0] ?? null;
  }

  async list(scope: Parameters<PluginWorkspaceRepository['list']>[0]) {
    return Array.from(this.workspaces.values()).filter((workspace) =>
      (this.membersByWorkspace.get(workspace.id) ?? []).some(
        (member) => member.userId === scope.userId && member.status === 'active'
      )
    );
  }

  async create(
    scope: Parameters<PluginWorkspaceRepository['create']>[0],
    input: Parameters<PluginWorkspaceRepository['create']>[1]
  ) {
    const now = new Date();
    const workspace: Workspace = {
      id: `workspace-${this.workspaces.size + 1}`,
      name: input.name,
      slug: input.slug ?? null,
      ownerUserId: scope.userId,
      status: 'active',
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
    const member: WorkspaceMember = {
      id: `member-${this.membersByWorkspace.size + 1}`,
      workspaceId: workspace.id,
      userId: scope.userId,
      role: 'owner',
      status: 'active',
      email: scope.userEmail ?? null,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.workspaces.set(workspace.id, workspace);
    this.membersByWorkspace.set(workspace.id, [member]);
    return workspace;
  }

  async members(_scope: Parameters<PluginWorkspaceRepository['members']>[0], workspaceId: string) {
    return this.membersByWorkspace.get(workspaceId) ?? [];
  }

  async hasRole(
    scope: Parameters<PluginWorkspaceRepository['hasRole']>[0],
    workspaceId: string,
    roles: Parameters<PluginWorkspaceRepository['hasRole']>[2]
  ) {
    return (this.membersByWorkspace.get(workspaceId) ?? []).some(
      (member) => member.userId === scope.userId && roles.includes(member.role as never)
    );
  }

  async invite(
    scope: Parameters<PluginWorkspaceRepository['invite']>[0],
    input: Parameters<PluginWorkspaceRepository['invite']>[1]
  ) {
    const invitation: WorkspaceInvitation = {
      id: `invitation-${this.invitations.length + 1}`,
      workspaceId: input.workspaceId,
      email: input.email,
      role: input.role,
      status: 'pending',
      invitedByUserId: scope.userId,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.invitations.push(invitation);
    return invitation;
  }
}

class MemoryRunsRepository implements PluginRunsRepository {
  readonly runs = new Map<string, PluginRun>();
  readonly logs: PluginRunLog[] = [];
  readonly results: PluginRunResult[] = [];

  async create(
    scope: Parameters<PluginRunsRepository['create']>[0],
    input: Parameters<PluginRunsRepository['create']>[1]
  ) {
    if (input.idempotencyKey) {
      const existing = Array.from(this.runs.values()).find(
        (run) =>
          run.pluginId === scope.pluginId &&
          run.userId === scope.userId &&
          run.idempotencyKey === input.idempotencyKey
      );
      if (existing) return existing;
    }

    const now = new Date();
    const run: PluginRun = {
      id: `run-${this.runs.size + 1}`,
      pluginId: scope.pluginId,
      userId: scope.userId,
      scopeType: input.resourceScope.type,
      scopeId: input.resourceScope.id,
      title: input.title,
      visibility: input.visibility,
      status: 'queued',
      progress: 0,
      inputs: input.inputs as unknown as Record<string, unknown>[],
      costs: input.costs as unknown as Record<string, unknown>[],
      retry: input.retry as unknown as Record<string, unknown>,
      idempotencyKey: input.idempotencyKey ?? null,
      metadata: input.metadata,
      error: null,
      cancelReason: null,
      cancelRequestedAt: null,
      startedAt: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.runs.set(run.id, run);
    return run;
  }

  async update(
    scope: Parameters<PluginRunsRepository['update']>[0],
    id: string,
    input: Parameters<PluginRunsRepository['update']>[2]
  ) {
    const existing = await this.get(scope, id);
    if (!existing) throw new Error('missing run');
    const updated: PluginRun = {
      ...existing,
      status: input.status ?? existing.status,
      progress: input.progress ?? existing.progress,
      metadata: input.metadata ?? existing.metadata,
      error: input.error === undefined ? existing.error : input.error,
      cancelReason: input.cancelReason ?? existing.cancelReason,
      cancelRequestedAt: input.cancelRequestedAt ?? existing.cancelRequestedAt,
      startedAt:
        input.status === 'running' || input.status === 'waiting_external'
          ? new Date()
          : existing.startedAt,
      finishedAt: input.finishedAt ?? existing.finishedAt,
      updatedAt: new Date(),
    };
    this.runs.set(id, updated);
    return updated;
  }

  async appendLog(
    _scope: Parameters<PluginRunsRepository['appendLog']>[0],
    _id: string,
    input: Parameters<PluginRunsRepository['appendLog']>[2]
  ) {
    const row: PluginRunLog = {
      id: input.id,
      runId: input.runId,
      level: input.level,
      message: input.message,
      metadata: input.metadata ?? {},
      createdAt: new Date(),
    };
    this.logs.push(row);
    return row;
  }

  async addResult(
    _scope: Parameters<PluginRunsRepository['addResult']>[0],
    _id: string,
    input: Parameters<PluginRunsRepository['addResult']>[2]
  ) {
    const row: PluginRunResult = {
      id: input.id,
      runId: input.runId,
      type: input.type,
      ref: input.ref,
      metadata: input.metadata ?? {},
      createdAt: new Date(),
    };
    this.results.push(row);
    return row;
  }

  async get(scope: Parameters<PluginRunsRepository['get']>[0], id: string) {
    const run = this.runs.get(id) ?? null;
    return run?.pluginId === scope.pluginId && run.userId === scope.userId ? run : null;
  }

  async getById(scope: Parameters<PluginRunsRepository['get']>[0], id: string) {
    const run = this.runs.get(id) ?? null;
    return run?.pluginId === scope.pluginId ? run : null;
  }

  async listResults(_scope: Parameters<PluginRunsRepository['listResults']>[0], id: string) {
    return this.results.filter((result) => result.runId === id);
  }

  async list(
    scope: Parameters<PluginRunsRepository['list']>[0],
    input: Parameters<PluginRunsRepository['list']>[1]
  ) {
    return Array.from(this.runs.values()).filter((run) => {
      if (run.pluginId !== scope.pluginId) return false;
      if (input.status && run.status !== input.status) return false;
      if (!input.resourceScope) return run.userId === scope.userId;
      return run.scopeType === input.resourceScope.type && run.scopeId === input.resourceScope.id;
    });
  }
}

class MemoryFilesRepository implements PluginFilesRepository {
  readonly files = new Map<string, PluginFile>();

  add(
    scope: {
      pluginId: string;
      userId: string;
      resourceScope: { type: 'user' | 'workspace'; id: string };
    },
    input: Omit<Partial<PluginFile>, 'runId' | 'purpose'> & {
      id: string;
      fileName: string;
      purpose: PluginFile['purpose'];
      runId?: string | null;
    }
  ) {
    const now = new Date();
    const row: PluginFile = {
      pluginId: scope.pluginId,
      userId: scope.userId,
      scopeType: scope.resourceScope.type,
      scopeId: scope.resourceScope.id,
      ownerUserId: scope.userId,
      contentType: 'text/plain',
      size: 5,
      hash: 'sha256:test',
      status: 'ready',
      storageKey: `plugins/${scope.pluginId}/${input.id}`,
      storageProvider: 'local',
      metadata: {},
      expiresAt: null,
      uploadedAt: now,
      archivedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      ...input,
      runId: input.runId ?? null,
    };
    this.files.set(row.id, row);
    return row;
  }

  async createPending(
    scope: PluginFilesScope,
    input: Parameters<PluginFilesRepository['createPending']>[1]
  ) {
    return this.add(
      {
        pluginId: scope.pluginId,
        userId: scope.userId,
        resourceScope: input.resourceScope,
      },
      {
        id: `file-${this.files.size + 1}`,
        fileName: input.fileName,
        contentType: input.contentType,
        size: input.size,
        purpose: input.purpose,
        status: 'pending_upload',
        storageKey: input.storageKey,
        runId: input.runId ?? null,
        metadata: input.metadata,
        expiresAt: input.expiresAt ?? null,
        uploadedAt: null,
      }
    );
  }

  async complete(
    _scope: PluginFilesScope,
    input: Parameters<PluginFilesRepository['complete']>[1]
  ) {
    const existing = this.files.get(input.fileId);
    if (!existing) throw new Error('missing file');
    const row: PluginFile = {
      ...existing,
      storageKey: input.storageKey ?? existing.storageKey,
      size: input.size,
      hash: input.hash ?? existing.hash,
      contentType: input.contentType ?? existing.contentType,
      metadata: input.metadata ? { ...existing.metadata, ...input.metadata } : existing.metadata,
      status: 'ready',
      uploadedAt: new Date(),
      updatedAt: new Date(),
    };
    this.files.set(row.id, row);
    return row;
  }

  async get(_scope: PluginFilesScope, id: string) {
    return this.files.get(id) ?? null;
  }

  async list(_scope: PluginFilesScope, input: Parameters<PluginFilesRepository['list']>[1]) {
    return Array.from(this.files.values()).filter(
      (file) =>
        file.scopeType === input.resourceScope.type &&
        file.scopeId === input.resourceScope.id &&
        (!input.purpose || file.purpose === input.purpose) &&
        (!input.status || file.status === input.status) &&
        (!input.runId || file.runId === input.runId) &&
        !file.deletedAt
    );
  }

  async getUsage() {
    return { fileCount: 0, storageBytes: 0, dailyUploadBytes: 0 };
  }

  async archive(_scope: PluginFilesScope, id: string) {
    const existing = this.files.get(id);
    if (!existing) throw new Error('missing file');
    const row = { ...existing, status: 'archived', archivedAt: new Date() } satisfies PluginFile;
    this.files.set(id, row);
    return row;
  }

  async softDelete(_scope: PluginFilesScope, id: string) {
    const existing = this.files.get(id);
    if (!existing) throw new Error('missing file');
    const row = { ...existing, status: 'deleted', deletedAt: new Date() } satisfies PluginFile;
    this.files.set(id, row);
    return row;
  }
}

class MemoryApiKeysRepository implements PluginApiKeysRepository {
  readonly keys = new Map<string, PluginApiKey & { cleartext: string }>();

  async create(
    scope: Parameters<PluginApiKeysRepository['create']>[0],
    input: Parameters<PluginApiKeysRepository['create']>[1]
  ) {
    const now = new Date();
    const cleartext = `pk_platform_test_${this.keys.size + 1}`;
    const row: PluginApiKey & { cleartext: string } = {
      id: `api-key-${this.keys.size + 1}`,
      pluginId: scope.pluginId,
      userId: scope.userId,
      scopeType: input.resourceScope.type,
      scopeId: input.resourceScope.id,
      name: input.name,
      prefix: 'pk_platform_test',
      keyHash: `hash-${cleartext}`,
      permissions: input.permissions,
      metadata: input.metadata,
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
      cleartext,
    };
    this.keys.set(row.id, row);
    return { row, cleartext };
  }

  async list(
    scope: Parameters<PluginApiKeysRepository['list']>[0],
    input: Parameters<PluginApiKeysRepository['list']>[1]
  ) {
    return Array.from(this.keys.values()).filter((key) => {
      if (key.pluginId !== scope.pluginId) return false;
      if (!input.resourceScope) return key.userId === scope.userId;
      if (key.scopeType !== input.resourceScope.type || key.scopeId !== input.resourceScope.id) {
        return false;
      }
      return input.resourceScope.type === 'workspace' || key.userId === scope.userId;
    });
  }

  async revoke(scope: Parameters<PluginApiKeysRepository['revoke']>[0], id: string) {
    const key = this.keys.get(id);
    if (key?.pluginId === scope.pluginId && key.userId === scope.userId) {
      key.revokedAt = new Date();
    }
  }

  async verify(pluginId: string, key: string) {
    return (
      Array.from(this.keys.values()).find(
        (row) =>
          row.pluginId === pluginId &&
          row.cleartext === key &&
          !row.revokedAt &&
          (!row.expiresAt || row.expiresAt.getTime() > Date.now())
      ) ?? null
    );
  }
}

class MemoryRateLimitRepository implements PluginRateLimitRepository {
  readonly counts = new Map<string, number>();

  async check(
    scope: Parameters<PluginRateLimitRepository['check']>[0],
    input: Parameters<PluginRateLimitRepository['check']>[1]
  ) {
    const key = `${scope.pluginId}:${input.bucket}`;
    const count = (this.counts.get(key) ?? 0) + input.cost;
    this.counts.set(key, count);
    return {
      allowed: count <= input.limit,
      remaining: Math.max(input.limit - count, 0),
      resetAt: new Date(input.now.getTime() + input.windowMs),
      retryAfterSeconds: count > input.limit ? 60 : undefined,
    };
  }
}

class MemoryConnectorsRepository implements PluginConnectorsRepository {
  readonly connectors = new Map<string, PluginConnector>();
  readonly calls: Parameters<PluginConnectorsRepository['recordCall']>[1][] = [];

  private key(
    scope: Parameters<PluginConnectorsRepository['get']>[0],
    name: string,
    resourceScope?: { type: 'user' | 'workspace'; id: string }
  ) {
    return `${scope.pluginId}:${name}:${resourceScope?.type ?? 'global'}:${resourceScope?.id ?? 'global'}`;
  }

  async get(
    scope: Parameters<PluginConnectorsRepository['get']>[0],
    name: string,
    resourceScope?: { type: 'user' | 'workspace'; id: string }
  ) {
    const existing = this.connectors.get(this.key(scope, name, resourceScope));
    if (existing) return existing;

    const now = new Date();
    return {
      id: 'connector-1',
      pluginId: scope.pluginId,
      name,
      type: 'http',
      scopeType: null,
      scopeId: null,
      baseUrl: 'https://api.example.test',
      auth: { type: 'none' },
      authType: 'none',
      secretName: null,
      egress: {},
      retry: {},
      redaction: {},
      status: 'active',
      timeoutMs: 1000,
      retryCount: 0,
      metadata: { test: true },
      createdAt: now,
      updatedAt: now,
    } satisfies PluginConnector;
  }

  async list(
    scope: Parameters<PluginConnectorsRepository['list']>[0],
    input: Parameters<PluginConnectorsRepository['list']>[1]
  ) {
    return Array.from(this.connectors.values()).filter(
      (connector) =>
        connector.pluginId === scope.pluginId &&
        (input.includeDisabled || connector.status === 'active') &&
        (!input.resourceScope ||
          (connector.scopeType === input.resourceScope.type &&
            connector.scopeId === input.resourceScope.id))
    );
  }

  async upsert(
    scope: Parameters<PluginConnectorsRepository['upsert']>[0],
    input: Parameters<PluginConnectorsRepository['upsert']>[1]
  ) {
    const now = new Date();
    const key = this.key(scope, input.name, input.resourceScope);
    const connector: PluginConnector = {
      id: this.connectors.get(key)?.id ?? `connector-${this.connectors.size + 1}`,
      pluginId: scope.pluginId,
      name: input.name,
      type: input.type,
      scopeType: input.resourceScope?.type ?? null,
      scopeId: input.resourceScope?.id ?? null,
      baseUrl: input.baseUrl,
      auth: input.auth as unknown as Record<string, unknown>,
      authType: input.authType,
      secretName: input.secretName ?? null,
      egress: input.egress as Record<string, unknown>,
      retry: input.retry as Record<string, unknown>,
      redaction: input.redaction as Record<string, unknown>,
      status: 'active',
      timeoutMs: input.timeoutMs,
      retryCount: input.retryCount,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
    this.connectors.set(key, connector);
    return connector;
  }

  async setStatus(
    scope: Parameters<PluginConnectorsRepository['setStatus']>[0],
    name: string,
    status: 'active' | 'disabled',
    resourceScope?: { type: 'user' | 'workspace'; id: string }
  ) {
    const connector = await this.get(scope, name, resourceScope);
    const updated = { ...connector, status, updatedAt: new Date() };
    this.connectors.set(this.key(scope, name, resourceScope), updated);
    return updated;
  }

  async delete(
    scope: Parameters<PluginConnectorsRepository['delete']>[0],
    name: string,
    resourceScope?: { type: 'user' | 'workspace'; id: string }
  ) {
    this.connectors.delete(this.key(scope, name, resourceScope));
  }

  async recordCall(
    _scope: Parameters<PluginConnectorsRepository['recordCall']>[0],
    input: Parameters<PluginConnectorsRepository['recordCall']>[1]
  ) {
    this.calls.push(input);
  }
}

describe('platform plugin capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wires workspace, runs, api keys, rate limits, and connectors through clean host APIs', async () => {
    await withPluginResourceScopeAccessOverride(
      async () => true,
      async () => {
        const scope = createScope([
          Permission.WorkspaceRead,
          Permission.WorkspaceWrite,
          Permission.RunsRead,
          Permission.RunsWrite,
          Permission.ApiKeysRead,
          Permission.ApiKeysWrite,
          Permission.RateLimitCheck,
          Permission.ConnectorsRead,
          Permission.ConnectorsInvoke,
          Permission.ConnectorsManage,
          Permission.FilesRead,
        ]);
        const auditPort = { log: vi.fn(), query: vi.fn(async () => []) };
        const workspaceRepository = new MemoryWorkspaceRepository();
        const runsRepository = new MemoryRunsRepository();
        const filesRepository = new MemoryFilesRepository();
        const apiKeysRepository = new MemoryApiKeysRepository();
        const rateLimitRepository = new MemoryRateLimitRepository();
        const connectorsRepository = new MemoryConnectorsRepository();
        const connectorFetch = vi
          .fn<PluginConnectorHttpHost['fetch']>()
          .mockResolvedValueOnce(Response.json({ retry: true }, { status: 503 }))
          .mockResolvedValueOnce(
            Response.json(
              { ok: true, source: 'connector' },
              { status: 201, headers: { 'x-service-token': 'response-secret' } }
            )
          );
        const connectorSecrets: PluginConnectorSecretHost = {
          async get(name) {
            return name === 'storymotion-token' ? 'connector-secret-token' : null;
          },
        };
        const connectorFilesHost: PluginConnectorFilesHost = {
          async resolve(input) {
            return Promise.all(
              input.files.map(async (reference) => {
                const file = await filesRepository.get(
                  {
                    pluginId: input.connectorScope.pluginId,
                    userId: input.connectorScope.userId,
                    userRole: 'user',
                  },
                  reference.fileId
                );
                if (!file || file.status !== 'ready') {
                  throw new Error(`missing connector file ${reference.fileId}`);
                }
                return {
                  id: file.id,
                  name: reference.name ?? file.fileName,
                  scope: { type: file.scopeType as 'user' | 'workspace', id: file.scopeId },
                  fileName: file.fileName,
                  contentType: file.contentType,
                  size: file.size,
                  hash: file.hash ?? undefined,
                  purpose: file.purpose as 'source' | 'result' | 'temp',
                  runId: file.runId ?? undefined,
                  downloadUrl: `https://test.local/api/plugin-files/${file.id}/download?signed=1`,
                };
              })
            );
          },
        };
        const usageRecords: UsageRecord[] = [];
        const usageLedger: UsageLedger = {
          async record(record) {
            usageRecords.push(record);
          },
          async query() {
            return usageRecords;
          },
          async getQuotaUsage() {
            return usageRecords.reduce((sum, record) => sum + record.amount, 0);
          },
        };
        const consumeCredits = vi.fn(async (_scope, input) => ({
          consumed: true,
          amount: input.amount,
          balanceBefore: 10,
          balanceAfter: 10 - input.amount,
          meter: input.meter,
          metric: input.metric,
          scope: input.accountScope,
          userId:
            input.userId ??
            (input.accountScope.type === 'user' ? input.accountScope.id : undefined),
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata,
        }));

        const workspace = createPluginWorkspaceCapability(scope, {
          repository: workspaceRepository,
          auditPort,
        });
        const runs = createPluginRunsCapability(scope, {
          repository: runsRepository,
          filesRepository,
          auditPort,
        });
        const apiKeys = createPluginApiKeysCapability(scope, {
          repository: apiKeysRepository,
          auditPort,
        });
        const rateLimit = createPluginRateLimitCapability(scope, {
          repository: rateLimitRepository,
        });
        const connectors = createPluginConnectorsCapability(scope, {
          repository: connectorsRepository,
          httpHost: { fetch: connectorFetch },
          secretHost: connectorSecrets,
          filesHost: connectorFilesHost,
          usageLedger,
          creditsHost: { consume: consumeCredits },
          auditPort,
          callbackBaseUrl: 'https://test.local/api/plugins',
          callbackSecret: 'test-secret',
        });

        await expect(workspace.current()).resolves.toBeNull();
        const createdWorkspace = await workspace.create({
          name: 'Shared Studio',
          slug: 'shared-studio',
          metadata: { kind: 'test' },
        });
        await expect(workspace.current()).resolves.toMatchObject({ id: createdWorkspace.id });
        await expect(workspace.members(createdWorkspace.id)).resolves.toHaveLength(1);
        await expect(workspace.hasRole(['owner', 'admin'], createdWorkspace.id)).resolves.toBe(
          true
        );
        await expect(
          workspace.invite({
            workspaceId: createdWorkspace.id,
            email: 'editor@example.test',
            role: 'editor',
          })
        ).resolves.toMatchObject({ role: 'editor', status: 'pending' });

        const resourceScope = { type: 'workspace' as const, id: createdWorkspace.id };
        const run = await runs.create({
          scope: resourceScope,
          title: 'Long operation',
          visibility: 'user-visible',
          inputs: [{ type: 'file', ref: 'file-input-1', label: 'Input PDF' }],
          costs: [{ meter: 'platform-test.connector.storymotion', amount: 1, unit: 'call' }],
          retry: { allowed: true, maxAttempts: 2 },
          metadata: { stage: 'created' },
          idempotencyKey: 'run-1',
        });
        filesRepository.add(
          { pluginId: 'platform-test', userId: 'user-1', resourceScope },
          { id: 'file-input-1', fileName: 'input.txt', purpose: 'source', runId: run.id }
        );
        filesRepository.add(
          { pluginId: 'platform-test', userId: 'user-1', resourceScope },
          { id: 'file-result-1', fileName: 'result.txt', purpose: 'result', runId: run.id }
        );
        await expect(
          runs.create({
            scope: resourceScope,
            title: 'Long operation duplicate',
            idempotencyKey: 'run-1',
          })
        ).resolves.toMatchObject({ id: run.id });
        await runs.update(run.id, { status: 'running', progress: 50 });
        await expect(
          runs.appendLog(run.id, { level: 'info', message: 'Started', metadata: { run: true } })
        ).resolves.toMatchObject({ runId: run.id, message: 'Started' });
        await expect(
          runs.addResult(run.id, { type: 'artifact', ref: 'docs/result.md', label: 'Report' })
        ).resolves.toMatchObject({ runId: run.id, ref: 'docs/result.md' });
        await expect(runs.complete(run.id, { done: true })).resolves.toMatchObject({
          status: 'succeeded',
          progress: 100,
        });
        await expect(runs.get(run.id)).resolves.toMatchObject({
          id: run.id,
          visibility: 'user-visible',
          inputs: [
            expect.objectContaining({ type: 'file', ref: 'file-input-1', label: 'Input PDF' }),
          ],
          results: [
            expect.objectContaining({ type: 'artifact', ref: 'docs/result.md', label: 'Report' }),
          ],
          costs: [
            expect.objectContaining({ meter: 'platform-test.connector.storymotion', amount: 1 }),
          ],
          retry: { allowed: true, maxAttempts: 2 },
          files: {
            inputs: [expect.objectContaining({ id: 'file-input-1', purpose: 'source' })],
            outputs: [expect.objectContaining({ id: 'file-result-1', purpose: 'result' })],
            temp: [],
          },
        });
        await expect(runs.list({ scope: resourceScope })).resolves.toHaveLength(1);

        const apiKey = await apiKeys.create({
          name: 'External Worker',
          scope: resourceScope,
          permissions: ['pipeline:run'],
        });
        await expect(apiKeys.list({ scope: resourceScope })).resolves.toHaveLength(1);
        await apiKeys.revoke(apiKey.id);
        await expect(apiKeysRepository.verify('platform-test', apiKey.key)).resolves.toBeNull();

        await expect(
          rateLimit.check({ bucket: 'platform-test.pipeline.run', limit: 2, window: '1m' })
        ).resolves.toMatchObject({ allowed: true, remaining: 1 });
        await expect(
          rateLimit.check({ bucket: 'platform-test.pipeline.run', limit: 2, window: '1m', cost: 2 })
        ).rejects.toMatchObject({ code: 'PLUGIN_RATE_LIMITED' });

        await expect(connectors.get('storymotion')).resolves.toMatchObject({
          name: 'storymotion',
          baseUrl: 'https://api.example.test',
        });
        await expect(
          connectors.upsert({
            name: 'managed-service',
            baseUrl: 'https://managed.example.test',
            scope: resourceScope,
            authType: 'bearer',
            secretName: 'managed-token',
            timeoutMs: 5000,
            retryCount: 1,
          })
        ).resolves.toMatchObject({
          name: 'managed-service',
          scope: resourceScope,
          authType: 'bearer',
          auth: { type: 'bearer', secretName: 'managed-token' },
          secretName: 'managed-token',
          retry: { count: 1, backoffMs: 250 },
        });
        await expect(connectors.list({ scope: resourceScope })).resolves.toHaveLength(1);
        await expect(
          connectors.setStatus('managed-service', 'disabled', { scope: resourceScope })
        ).resolves.toMatchObject({
          status: 'disabled',
        });
        await expect(
          connectors.list({ scope: resourceScope, includeDisabled: true })
        ).resolves.toHaveLength(1);
        await connectors.delete('managed-service', { scope: resourceScope });
        await expect(
          connectors.list({ scope: resourceScope, includeDisabled: true })
        ).resolves.toEqual([]);
        await connectors.upsert({
          name: 'storymotion',
          baseUrl: 'https://api.example.test',
          auth: { type: 'bearer', secretName: 'storymotion-token' },
          egress: {
            allowedHosts: ['api.example.test'],
            allowedMethods: ['POST'],
            maxBodyBytes: 4096,
            maxResponseBytes: 4096,
          },
          retry: { count: 1, backoffMs: 0, retryableStatusCodes: [503] },
          redaction: {
            requestHeaders: ['authorization'],
            responseHeaders: ['x-service-token'],
            bodyFields: ['apiToken'],
          },
        });
        await expect(
          connectors.call('storymotion', {
            path: '/jobs',
            json: { runId: run.id, apiToken: 'body-secret' },
            files: [{ fileId: 'file-input-1', name: 'brief' }],
            runId: run.id,
            meter: 'platform-test.connector.storymotion',
            creditAmount: 1,
          })
        ).resolves.toMatchObject({
          ok: true,
          status: 201,
          json: { ok: true, source: 'connector' },
        });
        await expect(
          connectors.createSignedCallback({ connector: 'storymotion', runId: run.id })
        ).resolves.toMatchObject({ token: expect.any(String), expiresAt: expect.any(Date) });

        expect(connectorsRepository.calls).toHaveLength(1);
        expect(connectorFetch).toHaveBeenCalledTimes(2);
        expect(connectorFetch.mock.calls[0]?.[0]).toBe('https://api.example.test/jobs');
        expect(connectorFetch.mock.calls[1]?.[0]).toBe('https://api.example.test/jobs');
        expect(connectorFetch.mock.calls[1]?.[1]?.headers).toMatchObject({
          authorization: 'Bearer connector-secret-token',
        });
        expect(JSON.parse(String(connectorFetch.mock.calls[1]?.[1]?.body))).toMatchObject({
          runId: run.id,
          apiToken: 'body-secret',
          files: [
            {
              id: 'file-input-1',
              name: 'brief',
              downloadUrl: expect.stringContaining('/api/plugin-files/file-input-1/download'),
            },
          ],
        });
        expect(connectorsRepository.calls[0]?.requestMetadata).toMatchObject({
          fileIds: ['file-input-1'],
          headers: { authorization: '[REDACTED]' },
          json: { runId: run.id, apiToken: '[REDACTED]' },
          retry: { count: 1, retryableStatusCodes: [503] },
        });
        expect(JSON.stringify(connectorsRepository.calls[0]?.requestMetadata)).not.toContain(
          'downloadUrl'
        );
        expect(JSON.stringify(connectorsRepository.calls[0]?.requestMetadata)).not.toContain(
          'connector-secret-token'
        );
        expect(JSON.stringify(connectorsRepository.calls[0]?.responseMetadata)).not.toContain(
          'response-secret'
        );
        expect(usageRecords).toHaveLength(1);
        expect(consumeCredits).toHaveBeenCalledWith(
          expect.objectContaining({ pluginId: 'platform-test', userId: 'user-1' }),
          expect.objectContaining({ meter: 'platform-test.connector.storymotion', amount: 1 })
        );
        expect(auditPort.log).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'platform-test.workspace.create' })
        );
        expect(auditPort.log).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'platform-test.runs.create' })
        );
        expect(auditPort.log).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'platform-test.connectors.call' })
        );
        expect(auditPort.log).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'platform-test.connectors.upsert' })
        );
      }
    );
  }, 30_000);

  it('enforces workspace read and invite role boundaries', async () => {
    const repository = new MemoryWorkspaceRepository();
    repository.workspaces.set(
      'workspace-allowed',
      buildWorkspaceRow({ id: 'workspace-allowed', ownerUserId: 'owner-user' })
    );
    repository.workspaces.set(
      'workspace-other',
      buildWorkspaceRow({ id: 'workspace-other', ownerUserId: 'other-user' })
    );
    repository.membersByWorkspace.set('workspace-other', [
      buildWorkspaceMemberRow({
        id: 'member-other',
        workspaceId: 'workspace-other',
        userId: 'other-user',
        role: 'owner',
      }),
    ]);

    for (const role of ['owner', 'admin', 'editor', 'viewer'] as const) {
      repository.membersByWorkspace.set('workspace-allowed', [
        buildWorkspaceMemberRow({
          id: `member-${role}`,
          workspaceId: 'workspace-allowed',
          userId: 'user-1',
          role,
        }),
      ]);
      const workspace = createPluginWorkspaceCapability(
        createScope([Permission.WorkspaceRead, Permission.WorkspaceWrite]),
        { repository }
      );

      await expect(workspace.members('workspace-allowed')).resolves.toEqual([
        expect.objectContaining({ workspaceId: 'workspace-allowed', userId: 'user-1', role }),
      ]);

      if (role === 'owner' || role === 'admin') {
        await expect(
          workspace.invite({
            workspaceId: 'workspace-allowed',
            email: `${role}@example.test`,
            role: 'editor',
          })
        ).resolves.toMatchObject({ workspaceId: 'workspace-allowed', role: 'editor' });
      } else {
        await expect(
          workspace.invite({
            workspaceId: 'workspace-allowed',
            email: `${role}@example.test`,
            role: 'viewer',
          })
        ).rejects.toMatchObject({
          code: 'PLUGIN_WORKSPACE_ADMIN_REQUIRED',
          statusCode: 403,
        });
      }
    }

    await expect(
      createPluginWorkspaceCapability(createScope([Permission.WorkspaceRead]), {
        repository,
      }).members('workspace-other')
    ).rejects.toMatchObject({
      code: 'PLUGIN_WORKSPACE_SCOPE_FORBIDDEN',
      statusCode: 403,
      details: {
        requestedScope: { type: 'workspace', id: 'workspace-other' },
        requiredRoles: ['owner', 'admin', 'editor', 'viewer'],
      },
    });

    await expect(
      createPluginWorkspaceCapability(
        createScope([Permission.WorkspaceRead, Permission.WorkspaceWrite]),
        { repository }
      ).invite({ workspaceId: '   ', email: 'blank@example.test', role: 'viewer' })
    ).rejects.toMatchObject({
      code: 'PLUGIN_WORKSPACE_ID_INVALID',
      statusCode: 400,
    });
  });

  it('enforces workspace role matrix across runs, api keys, and connectors', async () => {
    const workspaceScope = { type: 'workspace' as const, id: 'workspace-matrix' };
    const roleForUser = new Map<string, 'owner' | 'admin' | 'editor' | 'viewer'>();
    const runsRepository = new MemoryRunsRepository();
    const apiKeysRepository = new MemoryApiKeysRepository();
    const connectorsRepository = new MemoryConnectorsRepository();
    const httpHost: PluginConnectorHttpHost = {
      fetch: vi.fn(async () => Response.json({ ok: true }, { status: 200 })),
    };

    const withMatrixGuard = <T>(callback: () => Promise<T>) =>
      withPluginResourceScopeAccessOverride(async (scope, resourceScope, action) => {
        if (resourceScope.type === 'user') return resourceScope.id === scope.user?.id;
        const role = roleForUser.get(scope.user?.id ?? '');
        const forbidden = (): never => {
          throw new PluginError({
            code: 'PLUGIN_WORKSPACE_SCOPE_FORBIDDEN',
            message: `Cannot ${action} workspace in matrix test.`,
            statusCode: 403,
            details: {
              action,
              requestedScope: resourceScope,
              userId: scope.user?.id,
            },
          });
        };
        if (!role) forbidden();
        if (action === 'read') return true;
        if (action === 'write' && (role === 'owner' || role === 'admin' || role === 'editor')) {
          return true;
        }
        if (role === 'owner' || role === 'admin') return true;
        return forbidden();
      }, callback);

    await withMatrixGuard(async () => {
      roleForUser.set('owner-user', 'owner');
      const ownerScope = createScope(
        [
          Permission.RunsRead,
          Permission.RunsWrite,
          Permission.ApiKeysRead,
          Permission.ApiKeysWrite,
          Permission.ConnectorsRead,
          Permission.ConnectorsInvoke,
          Permission.ConnectorsManage,
        ],
        { id: 'owner-user', role: 'user', email: 'owner@example.test' }
      );
      const ownerRuns = createPluginRunsCapability(ownerScope, { repository: runsRepository });
      const ownerApiKeys = createPluginApiKeysCapability(ownerScope, {
        repository: apiKeysRepository,
      });
      const ownerConnectors = createPluginConnectorsCapability(ownerScope, {
        repository: connectorsRepository,
        httpHost,
      });
      const sharedRun = await ownerRuns.create({
        scope: workspaceScope,
        title: 'Workspace matrix run',
        visibility: 'user-visible',
      });
      await ownerApiKeys.create({ name: 'Workspace worker', scope: workspaceScope });
      await ownerConnectors.upsert({
        name: 'workspace-service',
        baseUrl: 'https://api.example.test',
        scope: workspaceScope,
        egress: { allowedHosts: ['api.example.test'] },
      });

      for (const role of ['owner', 'admin', 'editor', 'viewer'] as const) {
        const userId = `${role}-user`;
        roleForUser.set(userId, role);
        const scope = createScope(
          [
            Permission.RunsRead,
            Permission.RunsWrite,
            Permission.ApiKeysRead,
            Permission.ApiKeysWrite,
            Permission.ConnectorsRead,
            Permission.ConnectorsInvoke,
            Permission.ConnectorsManage,
          ],
          { id: userId, role: 'user', email: `${role}@example.test` }
        );
        const runs = createPluginRunsCapability(scope, { repository: runsRepository });
        const apiKeys = createPluginApiKeysCapability(scope, { repository: apiKeysRepository });
        const connectors = createPluginConnectorsCapability(scope, {
          repository: connectorsRepository,
          httpHost,
        });

        await expect(runs.list({ scope: workspaceScope })).resolves.toContainEqual(
          expect.objectContaining({ id: sharedRun.id })
        );
        await expect(connectors.list({ scope: workspaceScope })).resolves.toContainEqual(
          expect.objectContaining({ name: 'workspace-service' })
        );
        await expect(
          connectors.call('workspace-service', { scope: workspaceScope, path: '/health' })
        ).resolves.toMatchObject({ ok: true });

        if (role === 'owner' || role === 'admin' || role === 'editor') {
          await expect(
            runs.create({
              scope: workspaceScope,
              title: `${role} can create runs`,
              visibility: 'user-visible',
            })
          ).resolves.toMatchObject({ scope: workspaceScope });
        } else {
          await expect(
            runs.create({
              scope: workspaceScope,
              title: 'viewer cannot create runs',
            })
          ).rejects.toMatchObject({
            code: 'PLUGIN_WORKSPACE_SCOPE_FORBIDDEN',
            details: { action: 'write' },
          });
        }

        if (role === 'owner' || role === 'admin') {
          await expect(apiKeys.list({ scope: workspaceScope })).resolves.toHaveLength(1);
          await expect(
            connectors.setStatus('workspace-service', 'disabled', { scope: workspaceScope })
          ).resolves.toMatchObject({ status: 'disabled' });
          await connectors.setStatus('workspace-service', 'active', { scope: workspaceScope });
          await expect(
            connectors.upsert({
              name: `${role}-managed-service`,
              baseUrl: 'https://api.example.test',
              scope: workspaceScope,
              egress: { allowedHosts: ['api.example.test'] },
            })
          ).resolves.toMatchObject({ scope: workspaceScope });
        } else {
          await expect(apiKeys.list({ scope: workspaceScope })).rejects.toMatchObject({
            code: 'PLUGIN_WORKSPACE_SCOPE_FORBIDDEN',
            details: { action: 'manage' },
          });
          await expect(
            connectors.setStatus('workspace-service', 'disabled', { scope: workspaceScope })
          ).rejects.toMatchObject({
            code: 'PLUGIN_WORKSPACE_SCOPE_FORBIDDEN',
            details: { action: 'manage' },
          });
        }
      }

      const strangerScope = createScope(
        [
          Permission.RunsRead,
          Permission.RunsWrite,
          Permission.ApiKeysRead,
          Permission.ApiKeysWrite,
          Permission.ConnectorsRead,
          Permission.ConnectorsManage,
        ],
        { id: 'stranger-user', role: 'user', email: 'stranger@example.test' }
      );
      await expect(
        createPluginRunsCapability(strangerScope, { repository: runsRepository }).list({
          scope: workspaceScope,
        })
      ).rejects.toMatchObject({
        code: 'PLUGIN_WORKSPACE_SCOPE_FORBIDDEN',
        details: { action: 'read' },
      });
      await expect(
        createPluginConnectorsCapability(strangerScope, {
          repository: connectorsRepository,
          httpHost,
        }).list({ scope: workspaceScope })
      ).rejects.toMatchObject({
        code: 'PLUGIN_WORKSPACE_SCOPE_FORBIDDEN',
        details: { action: 'read' },
      });
    });
  });

  it('enforces permissions for new host capability boundaries', async () => {
    const scope = createScope([]);

    await expect(
      createPluginWorkspaceCapability(scope, {
        repository: new MemoryWorkspaceRepository(),
      }).current()
    ).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: { permission: Permission.WorkspaceRead },
    });

    await expect(
      createPluginRunsCapability(scope, {
        repository: new MemoryRunsRepository(),
      }).create({
        scope: { type: 'workspace', id: 'workspace-1' },
        title: 'Denied',
      })
    ).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: { permission: Permission.RunsWrite },
    });

    await expect(
      createPluginApiKeysCapability(scope, {
        repository: new MemoryApiKeysRepository(),
      }).create({
        name: 'Denied',
        scope: { type: 'workspace', id: 'workspace-1' },
      })
    ).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: { permission: Permission.ApiKeysWrite },
    });

    await expect(
      createPluginRateLimitCapability(scope, {
        repository: new MemoryRateLimitRepository(),
      }).check({ bucket: 'platform-test.denied', limit: 1, window: '1m' })
    ).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: { permission: Permission.RateLimitCheck },
    });

    await expect(
      createPluginConnectorsCapability(scope, {
        repository: new MemoryConnectorsRepository(),
      }).call('storymotion', { path: '/jobs' })
    ).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: { permission: Permission.ConnectorsInvoke },
    });

    await expect(
      createPluginConnectorsCapability(createScope([Permission.ConnectorsInvoke]), {
        repository: new MemoryConnectorsRepository(),
        filesHost: {
          async resolve() {
            return [];
          },
        },
      }).call('storymotion', { path: '/jobs', files: [{ fileId: 'file-1' }] })
    ).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: { permission: Permission.FilesRead },
    });

    await expect(
      createPluginConnectorsCapability(scope, {
        repository: new MemoryConnectorsRepository(),
      }).upsert({ name: 'storymotion', baseUrl: 'https://api.example.test' })
    ).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: { permission: Permission.ConnectorsManage },
    });
  });

  it('expands rate limit buckets by plugin, API key, and route', async () => {
    const repository = new MemoryRateLimitRepository();
    const rateLimit = createPluginRateLimitCapability(
      {
        ...createScope([Permission.RateLimitCheck]),
        apiKey: {
          id: 'api-key-1',
          scope: { type: 'workspace', id: 'workspace-1' },
          permissions: ['POST:/run'],
        },
        request: new Request('https://test.local/api/plugins/platform-test/run?debug=1'),
      },
      { repository }
    );

    await expect(
      rateLimit.check({
        bucket: 'platform-test.{pluginId}.{apiKeyId}.{route}',
        limit: 2,
        window: '1m',
      })
    ).resolves.toMatchObject({ allowed: true, remaining: 1 });
    expect(
      repository.counts.get(
        'platform-test:platform-test.platform-test.api-key-1./api/plugins/platform-test/run'
      )
    ).toBe(1);
  });

  it('validates plugin API keys against route permissions and exposes scoped auth context', async () => {
    const contract = normalizePluginRuntimeContract(
      definePlugin({
        id: 'platform-test',
        name: 'Platform Test',
        version: '1.0.0',
        permissions: [Permission.RunsWrite],
        routes: {
          apis: [
            {
              path: '/run',
              handler: './api/run',
              auth: 'auth',
              machineAuth: 'apiKey',
              methods: ['POST'],
              permissions: [Permission.RunsWrite],
            },
          ],
        },
      })
    );
    const route = contract.routes.apis[0];
    const verify = vi.fn(async () => ({
      id: 'api-key-1',
      pluginId: 'platform-test',
      userId: 'user-1',
      scopeType: 'workspace',
      scopeId: 'workspace-1',
      name: 'Worker',
      prefix: 'pk_platform_test',
      keyHash: 'hash',
      permissions: ['POST:/run'],
      metadata: {},
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    vi.mocked(DbPluginApiKeysRepository).mockImplementation(function () {
      return { verify } as unknown as DbPluginApiKeysRepository;
    });

    const authResult = await enforcePluginRuntimeAuth(
      contract,
      route,
      new Headers({ authorization: 'Bearer cleartext' })
    );

    expect(authResult).toMatchObject({
      user: { id: 'user-1', role: 'user' },
      apiKey: {
        id: 'api-key-1',
        scope: { type: 'workspace', id: 'workspace-1' },
        permissions: expect.arrayContaining(['POST:/run']),
      },
    });
  });

  it('allows plugin API keys through declared route permissions', async () => {
    const contract = normalizePluginRuntimeContract(
      definePlugin({
        id: 'platform-test',
        name: 'Platform Test',
        version: '1.0.0',
        permissions: [Permission.RunsWrite],
        routes: {
          apis: [
            {
              path: '/run',
              handler: './api/run',
              auth: 'auth',
              machineAuth: 'apiKey',
              methods: ['POST'],
              permissions: [Permission.RunsWrite],
            },
          ],
        },
      })
    );
    const verify = vi.fn(async () => ({
      id: 'api-key-1',
      pluginId: 'platform-test',
      userId: 'user-1',
      scopeType: 'workspace',
      scopeId: 'workspace-1',
      name: 'Worker',
      prefix: 'pk_platform_test',
      keyHash: 'hash',
      permissions: [Permission.RunsWrite],
      metadata: {},
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    vi.mocked(DbPluginApiKeysRepository).mockImplementation(function () {
      return { verify } as unknown as DbPluginApiKeysRepository;
    });

    await expect(
      enforcePluginRuntimeAuth(
        contract,
        contract.routes.apis[0],
        new Headers({ authorization: 'Bearer cleartext' })
      )
    ).resolves.toMatchObject({
      apiKey: {
        id: 'api-key-1',
        permissions: expect.arrayContaining([Permission.RunsWrite]),
      },
    });
  });

  it('rejects plugin API keys that lack route permission', async () => {
    const contract = normalizePluginRuntimeContract(
      definePlugin({
        id: 'platform-test',
        name: 'Platform Test',
        version: '1.0.0',
        routes: {
          apis: [
            {
              path: '/run',
              handler: './api/run',
              auth: 'auth',
              machineAuth: 'apiKey',
              methods: ['POST'],
            },
          ],
        },
      })
    );
    const verify = vi.fn(async () => ({
      id: 'api-key-1',
      pluginId: 'platform-test',
      userId: 'user-1',
      scopeType: 'workspace',
      scopeId: 'workspace-1',
      name: 'Worker',
      prefix: 'pk_platform_test',
      keyHash: 'hash',
      permissions: ['GET:/other'],
      metadata: {},
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    vi.mocked(DbPluginApiKeysRepository).mockImplementation(function () {
      return { verify } as unknown as DbPluginApiKeysRepository;
    });

    await expect(
      enforcePluginRuntimeAuth(
        contract,
        contract.routes.apis[0],
        new Headers({ authorization: 'Bearer cleartext' })
      )
    ).rejects.toMatchObject({
      code: 'PLUGIN_API_KEY_PERMISSION_DENIED',
      statusCode: 403,
    });
  });

  it('treats invalid, expired, revoked, and cross-plugin API keys as invalid', async () => {
    const repository = new MemoryApiKeysRepository();
    const scope = {
      pluginId: 'platform-test',
      userId: 'user-1',
      userRole: 'user' as const,
    };
    const active = await repository.create(scope, {
      name: 'Active',
      resourceScope: { type: 'workspace', id: 'workspace-1' },
      permissions: ['POST:/run'],
      metadata: {},
    });
    const expired = await repository.create(scope, {
      name: 'Expired',
      resourceScope: { type: 'workspace', id: 'workspace-1' },
      permissions: ['POST:/run'],
      metadata: {},
      expiresAt: new Date(Date.now() - 1000),
    });
    const revoked = await repository.create(scope, {
      name: 'Revoked',
      resourceScope: { type: 'workspace', id: 'workspace-1' },
      permissions: ['POST:/run'],
      metadata: {},
    });
    await repository.revoke(scope, revoked.row.id);

    await expect(repository.verify('platform-test', active.cleartext)).resolves.toMatchObject({
      id: active.row.id,
    });
    await expect(repository.verify('platform-test', 'missing')).resolves.toBeNull();
    await expect(repository.verify('platform-test', expired.cleartext)).resolves.toBeNull();
    await expect(repository.verify('platform-test', revoked.cleartext)).resolves.toBeNull();
    await expect(repository.verify('other-plugin', active.cleartext)).resolves.toBeNull();

    const contract = normalizePluginRuntimeContract(
      definePlugin({
        id: 'platform-test',
        name: 'Platform Test',
        version: '1.0.0',
        routes: {
          apis: [
            {
              path: '/run',
              handler: './api/run',
              auth: 'auth',
              machineAuth: 'apiKey',
              methods: ['POST'],
            },
          ],
        },
      })
    );
    vi.mocked(DbPluginApiKeysRepository).mockImplementation(function () {
      return {
        verify: vi.fn(async () => null),
      } as unknown as DbPluginApiKeysRepository;
    });

    await expect(
      enforcePluginRuntimeAuth(
        contract,
        contract.routes.apis[0],
        new Headers({ authorization: 'Bearer expired-or-revoked-or-cross-plugin' })
      )
    ).rejects.toMatchObject({
      code: 'PLUGIN_API_KEY_INVALID',
      statusCode: 401,
    });
  });

  it('prevents scoped API keys from accessing another resource scope', async () => {
    const scope = {
      ...createScope([Permission.RunsWrite]),
      apiKey: {
        id: 'api-key-1',
        scope: { type: 'workspace' as const, id: 'workspace-1' },
        permissions: ['POST:/run'],
      },
    };
    const runs = createPluginRunsCapability(scope, {
      repository: new MemoryRunsRepository(),
    });

    await expect(
      runs.create({
        scope: { type: 'workspace', id: 'workspace-2' },
        title: 'Denied',
      })
    ).rejects.toMatchObject({
      code: 'PLUGIN_API_KEY_SCOPE_FORBIDDEN',
      statusCode: 403,
      details: {
        apiKeyId: 'api-key-1',
        apiKeyScope: { type: 'workspace', id: 'workspace-1' },
        requestedScope: { type: 'workspace', id: 'workspace-2' },
      },
    });

    await withPluginResourceScopeAccessOverride(
      async () => true,
      async () => {
        await expect(
          runs.create({
            scope: { type: 'workspace', id: 'workspace-1' },
            title: 'Allowed',
          })
        ).resolves.toMatchObject({
          scope: { type: 'workspace', id: 'workspace-1' },
          title: 'Allowed',
        });
      }
    );
  });
});
