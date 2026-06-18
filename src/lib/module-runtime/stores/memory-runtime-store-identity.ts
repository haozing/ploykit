import type {
  RuntimeStore,
  RuntimeStoreAuthSession,
  RuntimeStoreAuthSessionStatus,
  RuntimeStoreApiKeyRecord,
  RuntimeStoreHostUser,
  RuntimeStoreHostUserStatus,
  RuntimeStorePlatformUser,
  RuntimeStorePlatformUserStatus,
  RuntimeStoreUserIdentity,
  RuntimeStoreUserIdentityStatus,
  RuntimeStoreWorkspaceInvite,
  RuntimeStoreWorkspaceInviteStatus,
  RuntimeStoreWorkspaceMember,
  RuntimeStoreWorkspaceMemberStatus,
} from './runtime-store-types';

type InMemoryIdentityRuntimeStore = Pick<
  RuntimeStore,
  | 'createApiKey'
  | 'getApiKey'
  | 'findApiKeyByHash'
  | 'updateApiKey'
  | 'listApiKeys'
  | 'upsertHostUser'
  | 'getHostUser'
  | 'findHostUserByEmail'
  | 'listHostUsers'
  | 'updateHostUserStatus'
  | 'upsertPlatformUser'
  | 'getPlatformUser'
  | 'findPlatformUserByEmail'
  | 'listPlatformUsers'
  | 'updatePlatformUserStatus'
  | 'upsertWorkspaceMember'
  | 'listWorkspaceMembers'
  | 'updateWorkspaceMemberStatus'
  | 'upsertWorkspaceInvite'
  | 'getWorkspaceInvite'
  | 'findWorkspaceInviteByTokenHash'
  | 'listWorkspaceInvites'
  | 'updateWorkspaceInviteStatus'
  | 'createAuthSession'
  | 'getAuthSession'
  | 'listAuthSessions'
  | 'touchAuthSession'
  | 'revokeAuthSession'
  | 'revokeAuthSessions'
  | 'upsertUserIdentity'
  | 'findUserIdentity'
  | 'listUserIdentities'
  | 'updateUserIdentityStatus'
>;

interface CreateInMemoryIdentityRuntimeStoreInput {
  now: () => Date;
  createId: (prefix: string) => string;
}

function iso(now: () => Date): string {
  return now().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase();
}

function normalizeIdentityEmail(email: string | undefined): string | undefined {
  const normalized = email?.trim().toLowerCase();
  return normalized || undefined;
}

function identityScopeKey(input: {
  productId: string;
  environmentId?: string | null;
  provider: string;
  providerKey: string;
}): string {
  return [
    input.productId,
    input.environmentId ?? '',
    normalizeProvider(input.provider),
    input.providerKey,
  ].join('\u0000');
}

export function createInMemoryIdentityRuntimeStore({
  now,
  createId,
}: CreateInMemoryIdentityRuntimeStoreInput): InMemoryIdentityRuntimeStore {
  const apiKeys = new Map<string, RuntimeStoreApiKeyRecord>();
  const hostUsers = new Map<string, RuntimeStoreHostUser>();
  const platformUsers = new Map<string, RuntimeStorePlatformUser>();
  const workspaceMembers = new Map<string, RuntimeStoreWorkspaceMember>();
  const workspaceInvites = new Map<string, RuntimeStoreWorkspaceInvite>();
  const authSessions = new Map<string, RuntimeStoreAuthSession>();
  const userIdentities = new Map<string, RuntimeStoreUserIdentity>();

  function readHostUser(id: string): RuntimeStoreHostUser {
    const user = hostUsers.get(id);
    if (!user) {
      throw new Error(`RUNTIME_STORE_HOST_USER_NOT_FOUND: ${id}`);
    }
    return user;
  }

  function readUserIdentity(id: string): RuntimeStoreUserIdentity {
    const identity = userIdentities.get(id);
    if (!identity) {
      throw new Error(`RUNTIME_STORE_USER_IDENTITY_NOT_FOUND: ${id}`);
    }
    return identity;
  }

  function readPlatformUser(id: string): RuntimeStorePlatformUser {
    const user = platformUsers.get(id);
    if (!user) {
      throw new Error(`RUNTIME_STORE_PLATFORM_USER_NOT_FOUND: ${id}`);
    }
    return user;
  }

  function readWorkspaceMember(id: string): RuntimeStoreWorkspaceMember {
    const member = workspaceMembers.get(id);
    if (!member) {
      throw new Error(`RUNTIME_STORE_WORKSPACE_MEMBER_NOT_FOUND: ${id}`);
    }
    return member;
  }

  function readWorkspaceInvite(id: string): RuntimeStoreWorkspaceInvite {
    const invite = workspaceInvites.get(id);
    if (!invite) {
      throw new Error(`RUNTIME_STORE_WORKSPACE_INVITE_NOT_FOUND: ${id}`);
    }
    return invite;
  }

  function readAuthSession(id: string): RuntimeStoreAuthSession {
    const session = authSessions.get(id);
    if (!session) {
      throw new Error(`RUNTIME_STORE_AUTH_SESSION_NOT_FOUND: ${id}`);
    }
    return session;
  }

  function findIdentityByScope(input: {
    productId: string;
    environmentId?: string | null;
    provider: string;
    providerKey: string;
  }): RuntimeStoreUserIdentity | undefined {
    const key = identityScopeKey(input);
    return [...userIdentities.values()].find((identity) => identityScopeKey(identity) === key);
  }

  function platformEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  function workspaceMemberScopeKey(input: {
    productId: string;
    workspaceId: string;
    platformUserId: string;
  }): string {
    return [input.productId, input.workspaceId, input.platformUserId].join('\u0000');
  }

  return {
    async createApiKey(input) {
      const timestamp = iso(now);
      const id = input.id ?? createId('api_key');
      if (apiKeys.has(id)) {
        throw new Error(`RUNTIME_STORE_API_KEY_ALREADY_EXISTS: ${id}`);
      }
      const keyHashCollision = [...apiKeys.values()].find(
        (candidate) => candidate.keyHash === input.keyHash
      );
      if (keyHashCollision) {
        throw new Error(`RUNTIME_STORE_API_KEY_HASH_ALREADY_EXISTS: ${input.prefix}`);
      }
      const record: RuntimeStoreApiKeyRecord = {
        id,
        productId: input.productId,
        environmentId: input.environmentId ?? null,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId ?? null,
        name: input.name,
        prefix: input.prefix,
        keyHash: input.keyHash,
        ownerSubjectType: input.ownerSubjectType,
        ownerSubjectId: input.ownerSubjectId,
        createdBy: input.createdBy,
        permissions: input.permissions ?? [],
        rateLimit: input.rateLimit,
        status: input.status ?? 'active',
        expiresAt: input.expiresAt,
        revokedAt: input.revokedAt,
        lastUsedAt: input.lastUsedAt,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      apiKeys.set(record.id, record);
      return clone(record);
    },
    async getApiKey(input) {
      const record = apiKeys.get(input.id);
      if (
        !record ||
        (input.productId && record.productId !== input.productId) ||
        (input.environmentId !== undefined &&
          record.environmentId !== undefined &&
          record.environmentId !== null &&
          record.environmentId !== input.environmentId) ||
        (input.workspaceId !== undefined && record.workspaceId !== input.workspaceId)
      ) {
        return null;
      }
      return clone(record);
    },
    async findApiKeyByHash(input) {
      const record =
        [...apiKeys.values()].find(
          (candidate) =>
            candidate.keyHash === input.keyHash &&
            (!input.prefix || candidate.prefix === input.prefix) &&
            (!input.productId || candidate.productId === input.productId) &&
            (input.environmentId === undefined ||
              candidate.environmentId === undefined ||
              candidate.environmentId === null ||
              candidate.environmentId === input.environmentId)
        ) ?? null;
      return record ? clone(record) : null;
    },
    async updateApiKey(id, patch) {
      const previous = apiKeys.get(id);
      if (!previous) {
        throw new Error(`RUNTIME_STORE_API_KEY_NOT_FOUND: ${id}`);
      }
      const next: RuntimeStoreApiKeyRecord = {
        ...previous,
        prefix: patch.prefix ?? previous.prefix,
        keyHash: patch.keyHash ?? previous.keyHash,
        status: patch.status ?? previous.status,
        expiresAt: patch.expiresAt === null ? undefined : (patch.expiresAt ?? previous.expiresAt),
        revokedAt: patch.revokedAt === null ? undefined : (patch.revokedAt ?? previous.revokedAt),
        lastUsedAt:
          patch.lastUsedAt === null ? undefined : (patch.lastUsedAt ?? previous.lastUsedAt),
        rateLimit: patch.rateLimit === null ? undefined : (patch.rateLimit ?? previous.rateLimit),
        metadata: { ...previous.metadata, ...(patch.metadata ?? {}) },
        updatedAt: iso(now),
      };
      apiKeys.set(id, next);
      return clone(next);
    },
    async listApiKeys(query = {}) {
      return [...apiKeys.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) =>
            query.environmentId === undefined || (record.environmentId ?? null) === query.environmentId
        )
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => query.moduleId === undefined || record.moduleId === query.moduleId)
        .filter(
          (record) => !query.ownerSubjectType || record.ownerSubjectType === query.ownerSubjectType
        )
        .filter((record) => !query.ownerSubjectId || record.ownerSubjectId === query.ownerSubjectId)
        .filter((record) => !query.status || record.status === query.status)
        .map((record) => clone(record));
    },
    async upsertHostUser(input) {
      const timestamp = iso(now);
      const existing = hostUsers.get(input.id);
      const user: RuntimeStoreHostUser = {
        id: input.id,
        email: input.email.trim().toLowerCase(),
        passwordHash: input.passwordHash,
        role: input.role,
        status: input.status,
        productId: input.productId,
        workspaceId: input.workspaceId,
        workspaceRole: input.workspaceRole,
        permissions: input.permissions ? [...input.permissions] : undefined,
        metadata: input.metadata ?? {},
        createdAt: input.createdAt ?? existing?.createdAt ?? timestamp,
        updatedAt: input.updatedAt ?? timestamp,
      };
      hostUsers.set(user.id, user);
      return clone(user);
    },
    async getHostUser(id) {
      const user = hostUsers.get(id);
      return user ? clone(user) : null;
    },
    async findHostUserByEmail(email) {
      const normalized = email.trim().toLowerCase();
      const user = [...hostUsers.values()].find((record) => record.email === normalized);
      return user ? clone(user) : null;
    },
    async listHostUsers(query = {}) {
      return [...hostUsers.values()]
        .filter((user) => !query.productId || user.productId === query.productId)
        .filter((user) => !query.role || user.role === query.role)
        .filter((user) => !query.status || user.status === query.status)
        .map((user) => clone(user));
    },
    async updateHostUserStatus(id: string, status: RuntimeStoreHostUserStatus, metadata) {
      const previous = readHostUser(id);
      const next: RuntimeStoreHostUser = {
        ...previous,
        status,
        metadata: { ...previous.metadata, ...(metadata ?? {}) },
        updatedAt: iso(now),
      };
      hostUsers.set(id, next);
      return clone(next);
    },
    async upsertPlatformUser(input) {
      const timestamp = iso(now);
      const email = platformEmail(input.email);
      if (!email.includes('@')) {
        throw new Error('RUNTIME_STORE_PLATFORM_USER_EMAIL_INVALID');
      }
      const existingByEmail = [...platformUsers.values()].find((user) => user.email === email);
      if (existingByEmail && input.id && existingByEmail.id !== input.id) {
        throw new Error(`RUNTIME_STORE_PLATFORM_USER_EMAIL_CONFLICT: ${email}`);
      }
      const id = existingByEmail?.id ?? input.id ?? createId('platform_user');
      const previous = platformUsers.get(id) ?? existingByEmail;
      const record: RuntimeStorePlatformUser = {
        id,
        email,
        displayName: input.displayName ?? previous?.displayName,
        status: input.status ?? previous?.status ?? 'active',
        metadata: { ...(previous?.metadata ?? {}), ...(input.metadata ?? {}) },
        createdAt: input.createdAt ?? previous?.createdAt ?? timestamp,
        updatedAt: input.updatedAt ?? timestamp,
      };
      platformUsers.set(record.id, record);
      return clone(record);
    },
    async getPlatformUser(id) {
      const user = platformUsers.get(id);
      return user ? clone(user) : null;
    },
    async findPlatformUserByEmail(email) {
      const normalized = platformEmail(email);
      const user = [...platformUsers.values()].find((record) => record.email === normalized);
      return user ? clone(user) : null;
    },
    async listPlatformUsers(query = {}) {
      return [...platformUsers.values()]
        .filter((user) => !query.status || user.status === query.status)
        .map((user) => clone(user));
    },
    async updatePlatformUserStatus(
      id: string,
      status: RuntimeStorePlatformUserStatus,
      metadata
    ) {
      const previous = readPlatformUser(id);
      const next: RuntimeStorePlatformUser = {
        ...previous,
        status,
        metadata: { ...previous.metadata, ...(metadata ?? {}) },
        updatedAt: iso(now),
      };
      platformUsers.set(id, next);
      return clone(next);
    },
    async upsertWorkspaceMember(input) {
      const timestamp = iso(now);
      const existingByScope = [...workspaceMembers.values()].find(
        (member) => workspaceMemberScopeKey(member) === workspaceMemberScopeKey(input)
      );
      const id = existingByScope?.id ?? input.id ?? createId('workspace_member');
      const existingById = workspaceMembers.get(id);
      if (
        existingById &&
        workspaceMemberScopeKey(existingById) !== workspaceMemberScopeKey(input)
      ) {
        throw new Error(`RUNTIME_STORE_WORKSPACE_MEMBER_ID_CONFLICT: ${id}`);
      }
      const previous = existingByScope ?? existingById;
      const member: RuntimeStoreWorkspaceMember = {
        id,
        productId: input.productId,
        workspaceId: input.workspaceId,
        platformUserId: input.platformUserId,
        role: input.role,
        status: input.status ?? previous?.status ?? 'active',
        metadata: { ...(previous?.metadata ?? {}), ...(input.metadata ?? {}) },
        createdAt: input.createdAt ?? previous?.createdAt ?? timestamp,
        updatedAt: input.updatedAt ?? timestamp,
      };
      workspaceMembers.set(member.id, member);
      return clone(member);
    },
    async listWorkspaceMembers(query = {}) {
      return [...workspaceMembers.values()]
        .filter((member) => !query.productId || member.productId === query.productId)
        .filter((member) => !query.workspaceId || member.workspaceId === query.workspaceId)
        .filter(
          (member) => !query.platformUserId || member.platformUserId === query.platformUserId
        )
        .filter((member) => !query.status || member.status === query.status)
        .map((member) => clone(member));
    },
    async updateWorkspaceMemberStatus(
      id: string,
      status: RuntimeStoreWorkspaceMemberStatus,
      metadata
    ) {
      const previous = readWorkspaceMember(id);
      const next: RuntimeStoreWorkspaceMember = {
        ...previous,
        status,
        metadata: { ...previous.metadata, ...(metadata ?? {}) },
        updatedAt: iso(now),
      };
      workspaceMembers.set(id, next);
      return clone(next);
    },
    async upsertWorkspaceInvite(input) {
      const timestamp = iso(now);
      const tokenHash = input.tokenHash.trim();
      if (!tokenHash) {
        throw new Error('RUNTIME_STORE_WORKSPACE_INVITE_TOKEN_HASH_REQUIRED');
      }
      const existingByToken = [...workspaceInvites.values()].find(
        (invite) => invite.tokenHash === tokenHash
      );
      if (existingByToken && input.id && existingByToken.id !== input.id) {
        throw new Error(`RUNTIME_STORE_WORKSPACE_INVITE_TOKEN_CONFLICT: ${input.id}`);
      }
      const id = existingByToken?.id ?? input.id ?? createId('workspace_invite');
      const previous = workspaceInvites.get(id) ?? existingByToken;
      const invite: RuntimeStoreWorkspaceInvite = {
        id,
        productId: input.productId,
        workspaceId: input.workspaceId,
        email: platformEmail(input.email),
        role: input.role,
        status: input.status ?? previous?.status ?? 'pending',
        tokenHash,
        invitedByPlatformUserId:
          input.invitedByPlatformUserId ?? previous?.invitedByPlatformUserId,
        acceptedByPlatformUserId:
          input.acceptedByPlatformUserId ?? previous?.acceptedByPlatformUserId,
        expiresAt: input.expiresAt,
        acceptedAt: input.acceptedAt ?? previous?.acceptedAt,
        revokedAt: input.revokedAt ?? previous?.revokedAt,
        metadata: { ...(previous?.metadata ?? {}), ...(input.metadata ?? {}) },
        createdAt: input.createdAt ?? previous?.createdAt ?? timestamp,
        updatedAt: input.updatedAt ?? timestamp,
      };
      workspaceInvites.set(invite.id, invite);
      return clone(invite);
    },
    async getWorkspaceInvite(id) {
      const invite = workspaceInvites.get(id);
      return invite ? clone(invite) : null;
    },
    async findWorkspaceInviteByTokenHash(tokenHash) {
      const invite =
        [...workspaceInvites.values()].find((record) => record.tokenHash === tokenHash) ?? null;
      return invite ? clone(invite) : null;
    },
    async listWorkspaceInvites(query = {}) {
      const email = query.email ? platformEmail(query.email) : null;
      return [...workspaceInvites.values()]
        .filter((invite) => !query.productId || invite.productId === query.productId)
        .filter((invite) => !query.workspaceId || invite.workspaceId === query.workspaceId)
        .filter((invite) => !query.status || invite.status === query.status)
        .filter((invite) => !email || invite.email === email)
        .map((invite) => clone(invite));
    },
    async updateWorkspaceInviteStatus(
      id: string,
      status: RuntimeStoreWorkspaceInviteStatus,
      patch = {}
    ) {
      const previous = readWorkspaceInvite(id);
      const next: RuntimeStoreWorkspaceInvite = {
        ...previous,
        status,
        acceptedByPlatformUserId:
          patch.acceptedByPlatformUserId ?? previous.acceptedByPlatformUserId,
        acceptedAt: patch.acceptedAt ?? previous.acceptedAt,
        revokedAt: patch.revokedAt ?? previous.revokedAt,
        metadata: { ...previous.metadata, ...(patch.metadata ?? {}) },
        updatedAt: iso(now),
      };
      workspaceInvites.set(id, next);
      return clone(next);
    },
    async createAuthSession(input) {
      const timestamp = iso(now);
      const id = input.id ?? createId('auth_session');
      if (authSessions.has(id)) {
        throw new Error(`RUNTIME_STORE_AUTH_SESSION_ALREADY_EXISTS: ${id}`);
      }
      const session: RuntimeStoreAuthSession = {
        id,
        productId: input.productId,
        environmentId: input.environmentId ?? null,
        workspaceId: input.workspaceId ?? null,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        deviceId: input.deviceId,
        sessionType: input.sessionType ?? 'browser',
        status: input.status ?? 'active',
        createdAt: timestamp,
        lastSeenAt: input.lastSeenAt ?? timestamp,
        expiresAt: input.expiresAt,
        revokedAt: input.revokedAt,
        revokedReason: input.revokedReason,
        metadata: input.metadata ?? {},
        updatedAt: timestamp,
      };
      authSessions.set(id, session);
      return clone(session);
    },
    async getAuthSession(id) {
      const session = authSessions.get(id);
      return session ? clone(session) : null;
    },
    async listAuthSessions(query = {}) {
      return [...authSessions.values()]
        .filter((session) => !query.productId || session.productId === query.productId)
        .filter(
          (session) =>
            query.environmentId === undefined ||
            (session.environmentId ?? null) === query.environmentId
        )
        .filter(
          (session) =>
            query.workspaceId === undefined || (session.workspaceId ?? null) === query.workspaceId
        )
        .filter((session) => !query.subjectType || session.subjectType === query.subjectType)
        .filter((session) => !query.subjectId || session.subjectId === query.subjectId)
        .filter((session) => !query.status || session.status === query.status)
        .filter((session) => !query.sessionType || session.sessionType === query.sessionType)
        .map((session) => clone(session));
    },
    async touchAuthSession(id, patch = {}) {
      const previous = readAuthSession(id);
      const next: RuntimeStoreAuthSession = {
        ...previous,
        lastSeenAt: patch.lastSeenAt ?? iso(now),
        metadata: { ...previous.metadata, ...(patch.metadata ?? {}) },
        updatedAt: iso(now),
      };
      authSessions.set(id, next);
      return clone(next);
    },
    async revokeAuthSession(id, patch = {}) {
      const previous = readAuthSession(id);
      const revokedAt = patch.revokedAt ?? iso(now);
      const next: RuntimeStoreAuthSession = {
        ...previous,
        status: 'revoked',
        revokedAt,
        revokedReason: patch.reason ?? previous.revokedReason,
        metadata: { ...previous.metadata, ...(patch.metadata ?? {}) },
        updatedAt: revokedAt,
      };
      authSessions.set(id, next);
      return clone(next);
    },
    async revokeAuthSessions(query) {
      const revokedAt = query.revokedAt ?? iso(now);
      const revoked: RuntimeStoreAuthSession[] = [];
      for (const session of authSessions.values()) {
        if (
          session.status !== 'active' ||
          (query.productId && session.productId !== query.productId) ||
          (query.environmentId !== undefined &&
            (session.environmentId ?? null) !== query.environmentId) ||
          (query.workspaceId !== undefined && (session.workspaceId ?? null) !== query.workspaceId) ||
          (query.subjectType && session.subjectType !== query.subjectType) ||
          (query.subjectId && session.subjectId !== query.subjectId) ||
          (query.excludeId && session.id === query.excludeId)
        ) {
          continue;
        }
        const next: RuntimeStoreAuthSession = {
          ...session,
          status: 'revoked',
          revokedAt,
          revokedReason: query.reason ?? session.revokedReason,
          updatedAt: revokedAt,
        };
        authSessions.set(session.id, next);
        revoked.push(clone(next));
      }
      return revoked;
    },
    async upsertUserIdentity(input) {
      const provider = normalizeProvider(input.provider);
      const providerKey = input.providerKey.trim();
      if (!provider || !providerKey) {
        throw new Error('RUNTIME_STORE_USER_IDENTITY_INVALID: provider and providerKey are required');
      }
      const timestamp = iso(now);
      const existingByScope = findIdentityByScope({
        productId: input.productId,
        environmentId: input.environmentId ?? null,
        provider,
        providerKey,
      });
      if (existingByScope && existingByScope.userId !== input.userId) {
        throw new Error(
          `RUNTIME_STORE_USER_IDENTITY_ALREADY_LINKED: ${provider}:${providerKey}`
        );
      }
      const id = existingByScope?.id ?? input.id ?? createId('user_identity');
      const existingById = userIdentities.get(id);
      if (
        existingById &&
        identityScopeKey(existingById) !==
          identityScopeKey({
            productId: input.productId,
            environmentId: input.environmentId ?? null,
            provider,
            providerKey,
          })
      ) {
        throw new Error(`RUNTIME_STORE_USER_IDENTITY_ID_CONFLICT: ${id}`);
      }
      const previous = existingByScope ?? existingById;
      const record: RuntimeStoreUserIdentity = {
        id,
        productId: input.productId,
        environmentId: input.environmentId ?? null,
        userId: input.userId,
        provider,
        providerKey,
        email: normalizeIdentityEmail(input.email) ?? previous?.email,
        status: input.status ?? previous?.status ?? 'active',
        metadata: { ...(previous?.metadata ?? {}), ...(input.metadata ?? {}) },
        lastUsedAt: input.lastUsedAt ?? previous?.lastUsedAt,
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      userIdentities.set(record.id, record);
      return clone(record);
    },
    async findUserIdentity(query) {
      const identity = findIdentityByScope(query);
      if (!identity || (query.status && identity.status !== query.status)) {
        return null;
      }
      return clone(identity);
    },
    async listUserIdentities(query = {}) {
      return [...userIdentities.values()]
        .filter((identity) => !query.productId || identity.productId === query.productId)
        .filter(
          (identity) =>
            query.environmentId === undefined ||
            (identity.environmentId ?? null) === query.environmentId
        )
        .filter((identity) => !query.userId || identity.userId === query.userId)
        .filter(
          (identity) =>
            !query.provider || identity.provider === normalizeProvider(query.provider)
        )
        .filter((identity) => !query.status || identity.status === query.status)
        .map((identity) => clone(identity));
    },
    async updateUserIdentityStatus(
      id: string,
      status: RuntimeStoreUserIdentityStatus,
      metadata
    ) {
      const previous = readUserIdentity(id);
      const next: RuntimeStoreUserIdentity = {
        ...previous,
        status,
        metadata: { ...previous.metadata, ...(metadata ?? {}) },
        updatedAt: iso(now),
      };
      userIdentities.set(id, next);
      return clone(next);
    },
  };
}
