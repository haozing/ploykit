import type { ModuleHostSession, RuntimeStoreHostUser } from '@/lib/module-runtime';
import {
  createHostPasswordHash,
  getHostAuthAdapter,
  getHostAuthPolicyForStore,
  verifyHostPassword,
} from './auth';
import { defaultProductId } from './default-scope';
import { getHostCapabilitiesForSession } from './rbac';
import { getHostRuntimeStore } from './runtime-store';

export interface HostUserProfile {
  id: string;
  email: string;
  role: RuntimeStoreHostUser['role'];
  status: RuntimeStoreHostUser['status'];
  productId: string;
  workspaceId: string;
  workspaceRole: RuntimeStoreHostUser['workspaceRole'];
  displayName?: string;
  avatarUrl?: string;
  language?: string;
  timezone?: string;
  preferences: HostUserPreferences;
}

export interface HostUserPreferences {
  notifications: {
    inApp: boolean;
    email: boolean;
    billing: boolean;
    files: boolean;
    admin: boolean;
  };
  search: {
    recentSearches: string[];
  };
}

const defaultPreferences: HostUserPreferences = {
  notifications: {
    inApp: true,
    email: false,
    billing: true,
    files: true,
    admin: true,
  },
  search: {
    recentSearches: [],
  },
};

function normalizeOptionalText(value: string | undefined, maxLength: number): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, maxLength);
}

function normalizeAvatarUrl(value: string | undefined): string | undefined {
  const trimmed = normalizeOptionalText(value, 500);
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith('/')) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:' ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeRecentSearch(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 120);
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readProfileMetadata(user: RuntimeStoreHostUser) {
  const profile = metadataRecord(user.metadata.profile);
  return {
    displayName: typeof profile.displayName === 'string' ? profile.displayName : undefined,
    avatarUrl: typeof profile.avatarUrl === 'string' ? profile.avatarUrl : undefined,
    language: typeof profile.language === 'string' ? profile.language : undefined,
    timezone: typeof profile.timezone === 'string' ? profile.timezone : undefined,
  };
}

function readPreferencesMetadata(user: RuntimeStoreHostUser): HostUserPreferences {
  const preferences = metadataRecord(user.metadata.preferences);
  const notifications = metadataRecord(preferences.notifications);
  const search = metadataRecord(preferences.search);
  const recentSearches = Array.isArray(search.recentSearches)
    ? search.recentSearches
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim())
        .slice(0, 12)
    : defaultPreferences.search.recentSearches;
  return {
    notifications: {
      inApp:
        typeof notifications.inApp === 'boolean'
          ? notifications.inApp
          : defaultPreferences.notifications.inApp,
      email:
        typeof notifications.email === 'boolean'
          ? notifications.email
          : defaultPreferences.notifications.email,
      billing:
        typeof notifications.billing === 'boolean'
          ? notifications.billing
          : defaultPreferences.notifications.billing,
      files:
        typeof notifications.files === 'boolean'
          ? notifications.files
          : defaultPreferences.notifications.files,
      admin:
        typeof notifications.admin === 'boolean'
          ? notifications.admin
          : defaultPreferences.notifications.admin,
    },
    search: {
      recentSearches,
    },
  };
}

function toPublicProfile(user: RuntimeStoreHostUser): HostUserProfile {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    productId: user.productId,
    workspaceId: user.workspaceId,
    workspaceRole: user.workspaceRole,
    ...readProfileMetadata(user),
    preferences: readPreferencesMetadata(user),
  };
}

async function currentUser(session: ModuleHostSession): Promise<RuntimeStoreHostUser> {
  const userId = session.userId ?? session.user?.id;
  if (!userId) {
    throw new Error('HOST_USER_REQUIRED');
  }
  const runtimeStore = await getHostRuntimeStore();
  const user = await runtimeStore.store.getHostUser(userId);
  if (!user) {
    throw new Error('HOST_USER_NOT_FOUND');
  }
  return user;
}

async function writeUser(
  user: RuntimeStoreHostUser,
  patch: Partial<RuntimeStoreHostUser> & { metadata?: Record<string, unknown> }
): Promise<RuntimeStoreHostUser> {
  const runtimeStore = await getHostRuntimeStore();
  return runtimeStore.store.upsertHostUser({
    ...user,
    ...patch,
    metadata: patch.metadata ?? user.metadata,
  });
}

async function auditUserChange(
  session: ModuleHostSession,
  type: string,
  metadata: Record<string, unknown>
) {
  const runtimeStore = await getHostRuntimeStore();
  await runtimeStore.store.recordAudit({
    productId: defaultProductId(session.productId),
    workspaceId: session.workspaceId ?? null,
    actorId: session.actorId ?? session.userId ?? session.user?.id,
    type,
    metadata,
  });
}

export async function getHostUserProfile(session: ModuleHostSession): Promise<HostUserProfile> {
  return toPublicProfile(await currentUser(session));
}

export async function updateHostUserProfile(
  session: ModuleHostSession,
  input: {
    displayName?: string;
    avatarUrl?: string;
    language?: string;
    timezone?: string;
  }
): Promise<HostUserProfile> {
  const user = await currentUser(session);
  const normalizedInput = {
    displayName: normalizeOptionalText(input.displayName, 80),
    avatarUrl: normalizeAvatarUrl(input.avatarUrl),
    language: normalizeOptionalText(input.language, 12),
    timezone: normalizeOptionalText(input.timezone, 80),
  };
  const profile = {
    ...readProfileMetadata(user),
    ...Object.fromEntries(
      Object.entries(normalizedInput).filter(([, value]) => value !== undefined)
    ),
  };
  const next = await writeUser(user, {
    metadata: {
      ...user.metadata,
      profile,
    },
  });
  await auditUserChange(session, 'host.user.profile.updated', {
    fields: Object.entries(normalizedInput)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key),
  });
  return toPublicProfile(next);
}

export async function updateHostUserPreferences(
  session: ModuleHostSession,
  input: Partial<HostUserPreferences['notifications']> & {
    searchRecent?: string[];
    recentSearches?: string[];
  }
): Promise<HostUserPreferences> {
  const user = await currentUser(session);
  const preferences = readPreferencesMetadata(user);
  const notificationPatch = Object.fromEntries(
    (['inApp', 'email', 'billing', 'files', 'admin'] as const)
      .map((key) => [key, input[key]] as const)
      .filter((entry): entry is [keyof HostUserPreferences['notifications'], boolean] => typeof entry[1] === 'boolean')
  );
  const recentInput = Array.isArray(input.searchRecent)
    ? input.searchRecent
    : Array.isArray(input.recentSearches)
      ? input.recentSearches
      : null;
  const recentSearches = recentInput
    ? Array.from(new Set(recentInput.map(normalizeRecentSearch).filter(Boolean))).slice(0, 12)
    : preferences.search.recentSearches;
  const nextPreferences: HostUserPreferences = {
    notifications: {
      ...preferences.notifications,
      ...notificationPatch,
    },
    search: {
      ...preferences.search,
      recentSearches,
    },
  };
  await writeUser(user, {
    metadata: {
      ...user.metadata,
      preferences: nextPreferences,
    },
  });
  await auditUserChange(session, 'host.user.preferences.updated', {
    fields: [
      ...Object.keys(notificationPatch),
      recentInput ? 'search.recentSearches' : null,
    ].filter(Boolean),
  });
  return nextPreferences;
}

export async function changeHostUserPassword(
  session: ModuleHostSession,
  input: { currentPassword: string; newPassword: string }
): Promise<void> {
  const user = await currentUser(session);
  if (!verifyHostPassword(input.currentPassword, user.passwordHash)) {
    throw new Error('CURRENT_PASSWORD_INVALID');
  }
  const runtimeStore = await getHostRuntimeStore();
  const policy = await getHostAuthPolicyForStore(runtimeStore.store);
  if (input.newPassword.length < policy.passwordMinLength) {
    throw new Error('NEW_PASSWORD_TOO_SHORT');
  }
  await writeUser(user, {
    passwordHash: createHostPasswordHash(input.newPassword),
  });
  const adapter = await getHostAuthAdapter();
  const activeSessions = await adapter.listSessions(user.id);
  const revokedSessionIds = activeSessions
    .filter((record) => record.id !== session.authSessionId)
    .map((record) => record.id);
  for (const sessionId of revokedSessionIds) {
    await adapter.revokeSession(user.id, sessionId);
  }
  await auditUserChange(session, 'host.user.password.changed', {
    revokedSessions: revokedSessionIds.length,
  });
}

export async function getHostUserRole(session: ModuleHostSession) {
  const user = await currentUser(session);
  return {
    userId: user.id,
    role: user.role,
    workspaceRole: user.workspaceRole,
    capabilities: getHostCapabilitiesForSession(session),
    permissions: user.permissions ?? session.permissions ?? [],
    productId: user.productId,
    workspaceId: user.workspaceId,
  };
}
