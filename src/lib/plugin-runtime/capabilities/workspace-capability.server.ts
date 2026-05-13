import { randomUUID } from 'crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  Permission,
  PluginError,
  type PluginWorkspace,
  type PluginWorkspaceApi,
  type PluginWorkspaceInvitation,
  type PluginWorkspaceMember,
  type PluginWorkspaceRole,
} from '@ploykit/plugin-sdk';
import { db, type Database } from '@/lib/db/client.server';
import {
  workspaceInvitations,
  workspaceMembers,
  workspaces,
  type NewWorkspace,
  type NewWorkspaceInvitation,
  type NewWorkspaceMember,
  type Workspace,
  type WorkspaceInvitation,
  type WorkspaceMember,
} from '@/lib/db/schema/plugin-platform';
import {
  assertJsonSerializable,
  enforceCapabilityPermission,
  requireUser,
  type PluginCapabilityScope,
} from './guards.server';
import { recordCapabilityAudit } from './audit-helper.server';
import type { AuditPort } from '@/lib/audit/audit-port.server';

type TransactionDatabase = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Database | TransactionDatabase;

export interface PluginWorkspaceScope {
  pluginId: string;
  userId: string;
  userEmail?: string;
}

export interface PluginWorkspaceRepository {
  current(scope: PluginWorkspaceScope): Promise<Workspace | null>;
  list(scope: PluginWorkspaceScope): Promise<Workspace[]>;
  create(
    scope: PluginWorkspaceScope,
    input: { name: string; slug?: string; metadata: Record<string, unknown> }
  ): Promise<Workspace>;
  members(scope: PluginWorkspaceScope, workspaceId: string): Promise<WorkspaceMember[]>;
  hasRole(
    scope: PluginWorkspaceScope,
    workspaceId: string,
    roles: readonly PluginWorkspaceRole[]
  ): Promise<boolean>;
  invite(
    scope: PluginWorkspaceScope,
    input: { workspaceId: string; email: string; role: Exclude<PluginWorkspaceRole, 'owner'> }
  ): Promise<WorkspaceInvitation>;
}

export interface CreatePluginWorkspaceOptions {
  repository?: PluginWorkspaceRepository;
  auditPort?: AuditPort;
}

const VALID_ROLES = new Set<PluginWorkspaceRole>(['owner', 'admin', 'editor', 'viewer']);
const WORKSPACE_READ_ROLES = ['owner', 'admin', 'editor', 'viewer'] satisfies PluginWorkspaceRole[];

function toWorkspace(row: Workspace): PluginWorkspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug ?? undefined,
    ownerUserId: row.ownerUserId,
    status: row.status === 'disabled' ? 'disabled' : 'active',
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMember(row: WorkspaceMember): PluginWorkspaceMember {
  return {
    workspaceId: row.workspaceId,
    userId: row.userId,
    role: row.role as PluginWorkspaceRole,
    status:
      row.status === 'invited' || row.status === 'disabled' || row.status === 'active'
        ? row.status
        : 'active',
    email: row.email ?? undefined,
    joinedAt: row.joinedAt ?? undefined,
  };
}

function toInvitation(row: WorkspaceInvitation): PluginWorkspaceInvitation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    role: row.role as Exclude<PluginWorkspaceRole, 'owner'>,
    status:
      row.status === 'accepted' || row.status === 'revoked' || row.status === 'expired'
        ? row.status
        : 'pending',
    expiresAt: row.expiresAt ?? undefined,
    createdAt: row.createdAt,
  };
}

function normalizeName(name: string): string {
  const normalized = name.trim();
  if (!normalized || normalized.length > 120) {
    throw new PluginError({
      code: 'PLUGIN_WORKSPACE_NAME_INVALID',
      message: 'Workspace name must be non-empty and at most 120 characters.',
      statusCode: 400,
    });
  }
  return normalized;
}

function normalizeWorkspaceId(workspaceId: string): string {
  const normalized = workspaceId.trim();
  if (!normalized) {
    throw new PluginError({
      code: 'PLUGIN_WORKSPACE_ID_INVALID',
      message: 'Workspace id must be non-empty.',
      statusCode: 400,
    });
  }
  return normalized;
}

function normalizeRoles(roles: PluginWorkspaceRole | PluginWorkspaceRole[]): PluginWorkspaceRole[] {
  const values = Array.isArray(roles) ? roles : [roles];
  if (values.length === 0 || values.some((role) => !VALID_ROLES.has(role))) {
    throw new PluginError({
      code: 'PLUGIN_WORKSPACE_ROLE_INVALID',
      message: 'Workspace role is invalid.',
      statusCode: 400,
    });
  }
  return values;
}

function resolveScope(scope: PluginCapabilityScope, capability: string): PluginWorkspaceScope {
  const user = requireUser(scope, capability);
  return {
    pluginId: scope.contract.id,
    userId: user.id,
    userEmail: user.email,
  };
}

export class DbPluginWorkspaceRepository implements PluginWorkspaceRepository {
  constructor(private readonly executor: Executor = db) {}

  private async inSystem<T>(fn: (executor: Executor) => Promise<T>): Promise<T> {
    if (this.executor !== db) {
      return fn(this.executor);
    }

    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', 'system', true)`);
      return fn(tx);
    });
  }

  async current(scope: PluginWorkspaceScope) {
    const rows = await this.list(scope);
    return rows[0] ?? null;
  }

  async list(scope: PluginWorkspaceScope) {
    return this.inSystem(async (executor) => {
      const rows = await executor
        .select({ workspace: workspaces })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
        .where(
          and(eq(workspaceMembers.userId, scope.userId), eq(workspaceMembers.status, 'active'))
        );

      return rows.map((row) => row.workspace);
    });
  }

  async create(
    scope: PluginWorkspaceScope,
    input: { name: string; slug?: string; metadata: Record<string, unknown> }
  ) {
    const now = new Date();
    return this.inSystem(async (executor) => {
      const [workspace] = await executor
        .insert(workspaces)
        .values({
          id: randomUUID(),
          name: input.name,
          slug: input.slug,
          ownerUserId: scope.userId,
          metadata: input.metadata,
          updatedAt: now,
        } satisfies NewWorkspace)
        .returning();

      await executor.insert(workspaceMembers).values({
        id: randomUUID(),
        workspaceId: workspace.id,
        userId: scope.userId,
        role: 'owner',
        status: 'active',
        email: scope.userEmail,
        joinedAt: now,
        updatedAt: now,
      } satisfies NewWorkspaceMember);

      return workspace;
    });
  }

  async members(_scope: PluginWorkspaceScope, workspaceId: string) {
    return this.inSystem((executor) =>
      executor
        .select()
        .from(workspaceMembers)
        .where(
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.status, 'active'))
        )
    );
  }

  async hasRole(
    scope: PluginWorkspaceScope,
    workspaceId: string,
    roles: readonly PluginWorkspaceRole[]
  ) {
    return this.inSystem(async (executor) => {
      const rows = await executor
        .select()
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, scope.userId),
            eq(workspaceMembers.status, 'active'),
            inArray(workspaceMembers.role, roles)
          )
        )
        .limit(1);

      return rows.length > 0;
    });
  }

  async invite(
    scope: PluginWorkspaceScope,
    input: { workspaceId: string; email: string; role: Exclude<PluginWorkspaceRole, 'owner'> }
  ) {
    return this.inSystem(async (executor) => {
      const [invitation] = await executor
        .insert(workspaceInvitations)
        .values({
          id: randomUUID(),
          workspaceId: input.workspaceId,
          email: input.email,
          role: input.role,
          status: 'pending',
          invitedByUserId: scope.userId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        } satisfies NewWorkspaceInvitation)
        .returning();

      return invitation;
    });
  }
}

export function createPluginWorkspaceCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginWorkspaceOptions = {}
): PluginWorkspaceApi {
  const repository = options.repository ?? new DbPluginWorkspaceRepository();

  return {
    async current() {
      enforceCapabilityPermission(scope, Permission.WorkspaceRead, 'ctx.workspace.current');
      const workspaceScope = resolveScope(scope, 'ctx.workspace.current');
      const workspace = await repository.current(workspaceScope);
      return workspace ? toWorkspace(workspace) : null;
    },

    async list() {
      enforceCapabilityPermission(scope, Permission.WorkspaceRead, 'ctx.workspace.list');
      const workspaceScope = resolveScope(scope, 'ctx.workspace.list');
      const rows = await repository.list(workspaceScope);
      return rows.map(toWorkspace);
    },

    async create(input) {
      enforceCapabilityPermission(scope, Permission.WorkspaceWrite, 'ctx.workspace.create');
      const workspaceScope = resolveScope(scope, 'ctx.workspace.create');
      const metadata = input.metadata ?? {};
      assertJsonSerializable(metadata, 'Workspace metadata');
      const workspace = await repository.create(workspaceScope, {
        name: normalizeName(input.name),
        slug: input.slug?.trim() || undefined,
        metadata,
      });
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.workspace.create`,
        { workspaceId: workspace.id, name: workspace.name },
        options.auditPort
      );
      return toWorkspace(workspace);
    },

    async members(workspaceId) {
      enforceCapabilityPermission(scope, Permission.WorkspaceRead, 'ctx.workspace.members');
      const workspaceScope = resolveScope(scope, 'ctx.workspace.members');
      const targetWorkspaceId =
        workspaceId ?? (await repository.current(workspaceScope))?.id ?? undefined;
      if (!targetWorkspaceId) {
        return [];
      }
      const normalizedTargetWorkspaceId = normalizeWorkspaceId(targetWorkspaceId);
      if (
        !(await repository.hasRole(
          workspaceScope,
          normalizedTargetWorkspaceId,
          WORKSPACE_READ_ROLES
        ))
      ) {
        throw new PluginError({
          code: 'PLUGIN_WORKSPACE_SCOPE_FORBIDDEN',
          message: `ctx.workspace.members cannot read workspace "${normalizedTargetWorkspaceId}" from this context.`,
          statusCode: 403,
          details: {
            pluginId: scope.contract.id,
            capability: 'ctx.workspace.members',
            action: 'read',
            requestedScope: { type: 'workspace', id: normalizedTargetWorkspaceId },
            requiredRoles: WORKSPACE_READ_ROLES,
            userId: workspaceScope.userId,
          },
        });
      }
      const rows = await repository.members(workspaceScope, normalizedTargetWorkspaceId);
      return rows.map(toMember);
    },

    async hasRole(roles, workspaceId) {
      enforceCapabilityPermission(scope, Permission.WorkspaceRead, 'ctx.workspace.hasRole');
      const workspaceScope = resolveScope(scope, 'ctx.workspace.hasRole');
      const targetWorkspaceId =
        workspaceId ?? (await repository.current(workspaceScope))?.id ?? undefined;
      if (!targetWorkspaceId) {
        return false;
      }
      return repository.hasRole(
        workspaceScope,
        normalizeWorkspaceId(targetWorkspaceId),
        normalizeRoles(roles)
      );
    },

    async invite(input) {
      enforceCapabilityPermission(scope, Permission.WorkspaceWrite, 'ctx.workspace.invite');
      const workspaceScope = resolveScope(scope, 'ctx.workspace.invite');
      const workspaceId = normalizeWorkspaceId(input.workspaceId);
      if (!(await repository.hasRole(workspaceScope, workspaceId, ['owner', 'admin']))) {
        throw new PluginError({
          code: 'PLUGIN_WORKSPACE_ADMIN_REQUIRED',
          message: 'Workspace owner or admin role is required to invite members.',
          statusCode: 403,
        });
      }
      const invitation = await repository.invite(workspaceScope, {
        workspaceId,
        email: input.email.trim().toLowerCase(),
        role: input.role,
      });
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.workspace.invite`,
        { workspaceId: invitation.workspaceId, email: invitation.email, role: invitation.role },
        options.auditPort
      );
      return toInvitation(invitation);
    },
  };
}
