import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ModuleUser, PermissionValue } from '@ploykit/module-sdk';
import {
  createAnonymousModuleHostSession,
  type ModuleHostSession,
} from '@/lib/module-runtime/host/session';
import type {
  RuntimeStore,
  RuntimeStoreAuthSession,
  RuntimeStoreHostUser,
  RuntimeStoreHostUserStatus,
} from '@/lib/module-runtime/stores/runtime-store-types';
import { DEFAULT_LANGUAGE, localizedDashboardPath, localizedPath, type SupportedLanguage } from './i18n';
import { requireCapability, USER_MODULE_PERMISSIONS } from './rbac';
import { getHostRuntimeStore } from './runtime-store';
import {
  DEFAULT_HOST_PRODUCT_ID,
  DEFAULT_HOST_PRODUCT_SCOPE_PROFILE,
  DEFAULT_HOST_ENVIRONMENT_ID,
  DEFAULT_HOST_WORKSPACE_ID,
} from './default-scope';
import { readHostSettingsView } from './host-settings';

export const HOST_AUTH_COOKIE = 'ploykit_session';

const DEV_AUTH_SECRET_KEY = Symbol.for('ploykit.host.auth.devSecret');
const DEFAULT_PRODUCT_ID = DEFAULT_HOST_PRODUCT_ID;
const DEFAULT_WORKSPACE_ID = DEFAULT_HOST_WORKSPACE_ID;
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_TTL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEMO_MODULES_ENTITLEMENT = 'ploykit.demo_modules';
const DEMO_USERS_PRODUCTION_ERROR = 'PLOYKIT_DEMO_USERS_PRODUCTION_FORBIDDEN';
const BOOTSTRAP_ADMIN_INCOMPLETE_ERROR = 'PLOYKIT_BOOTSTRAP_ADMIN_INCOMPLETE';
const CURRENT_AUTH_TOKEN_FORMAT = 'current';

interface SeedHostUser {
  id: string;
  email: string;
  password: string;
  role: ModuleUser['role'];
  workspaceRole: ModuleHostSession['workspaceRole'];
  permissions?: readonly PermissionValue[];
}

const USER_PERMISSIONS = USER_MODULE_PERMISSIONS;

const SEEDED_HOST_USERS: readonly SeedHostUser[] = [
  {
    id: 'demo-admin',
    email: 'admin@example.com',
    password: 'Admin@123456',
    role: 'admin',
    workspaceRole: 'owner',
  },
  {
    id: 'demo-user',
    email: 'user@example.com',
    password: 'User@123456',
    role: 'user',
    workspaceRole: 'editor',
    permissions: USER_PERMISSIONS,
  },
];

type HostIdentitySeedKind = 'none' | 'demo' | 'bootstrap';

interface HostIdentitySeedPlan {
  kind: HostIdentitySeedKind;
  users: readonly SeedHostUser[];
}

const seedPromises = new WeakMap<RuntimeStore, Map<string, Promise<void>>>();

export interface HostAuthSessionRecord {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  userAgent?: string;
}

interface HostAuthTokenRecord {
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  email?: string;
}

interface HostAuthMailLogRecord {
  id: string;
  type: 'password-reset' | 'email-verification';
  email: string;
  createdAt: string;
  tokenPreview: string;
}

interface HostAuthMetadata {
  sessions: HostAuthSessionRecord[];
  passwordResetTokens: HostAuthTokenRecord[];
  emailVerificationTokens: HostAuthTokenRecord[];
  emailVerifiedAt?: string;
  mailLog: HostAuthMailLogRecord[];
}

interface DecodedHostSessionCookie {
  userId: string;
  sessionId?: string;
  expiresAt?: string;
}

export interface HostAuthPolicy {
  requireEmailVerification: boolean;
  sessionTtlMs: number;
  passwordMinLength: number;
}

export interface HostAuthAdapter {
  authenticate(email: string, password: string): Promise<RuntimeStoreHostUser | null>;
  createSession(
    user: RuntimeStoreHostUser,
    input?: { userAgent?: string }
  ): Promise<{ session: HostAuthSessionRecord; cookie: string }>;
  revokeSession(userId: string, sessionId: string): Promise<void>;
  resolveSession(cookieHeader: string | null): Promise<ModuleHostSession>;
  register(input: {
    email: string;
    password: string;
    displayName?: string;
  }): Promise<{ user: RuntimeStoreHostUser; emailVerificationToken: string }>;
  requestPasswordReset(email: string): Promise<{ sent: boolean; resetToken?: string }>;
  resetPassword(token: string, newPassword: string): Promise<RuntimeStoreHostUser>;
  verifyEmail(token: string): Promise<RuntimeStoreHostUser>;
  listSessions(userId: string): Promise<HostAuthSessionRecord[]>;
}

function parseCookieHeader(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName || rawValue.length === 0) {
      continue;
    }

    cookies.set(rawName, decodeURIComponent(rawValue.join('=')));
  }

  return cookies;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value === 'true' || value === '1' || value === 'yes';
  }
  return fallback;
}

function envFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

function numberSetting(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), min), max) : fallback;
}

function envAuthPolicy(): HostAuthPolicy {
  return {
    requireEmailVerification: booleanSetting(process.env.PLOYKIT_REQUIRE_EMAIL_VERIFICATION, true),
    sessionTtlMs:
      numberSetting(
        process.env.PLOYKIT_SESSION_MAX_AGE_DAYS,
        Math.round(DEFAULT_SESSION_TTL_MS / DAY_MS),
        1,
        365
      ) * DAY_MS,
    passwordMinLength: numberSetting(process.env.PLOYKIT_PASSWORD_MIN_LENGTH, 8, 8, 128),
  };
}

function demoModuleEntitlements(): readonly string[] {
  return envFlag(process.env.PLOYKIT_ENABLE_DEMO_MODULES) ? [DEMO_MODULES_ENTITLEMENT] : [];
}

interface HostAuthSigningKey {
  kid: string;
  secret: string;
  source: string;
  verifyOnly?: boolean;
}

interface HostAuthKeyRing {
  active: HostAuthSigningKey;
  keys: HostAuthSigningKey[];
  configured: boolean;
}

type HostAuthDevSecretGlobal = typeof globalThis & {
  [DEV_AUTH_SECRET_KEY]?: string;
};

export async function getHostAuthPolicyForStore(store: RuntimeStore): Promise<HostAuthPolicy> {
  const base = envAuthPolicy();
  const settings = await readHostSettingsView(store, DEFAULT_PRODUCT_ID);
  return {
    requireEmailVerification: settings.requireEmailVerification ?? base.requireEmailVerification,
    sessionTtlMs: Math.round(settings.sessionMaxAgeDays * DAY_MS),
    passwordMinLength: settings.passwordMinLength ?? base.passwordMinLength,
  };
}

function productionProfile(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production' || env.PLOYKIT_PROFILE === 'production';
}

function validateKid(kid: string): string {
  const normalized = kid.trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(normalized)) {
    throw new Error(`PLOYKIT_AUTH_KEY_ID_INVALID: ${kid}`);
  }
  return normalized;
}

function parseKeyRefList(value: string | undefined): { kid: string; ref: string }[] {
  return (value ?? '')
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf('=');
      if (separator <= 0 || separator === entry.length - 1) {
        throw new Error(`PLOYKIT_AUTH_KEY_REF_INVALID: ${entry}`);
      }
      return {
        kid: validateKid(entry.slice(0, separator)),
        ref: entry.slice(separator + 1).trim(),
      };
    });
}

function resolveSecretRef(ref: string, env: NodeJS.ProcessEnv): { secret: string; source: string } {
  const [scheme, ...rest] = ref.split(':');
  const body = rest.join(':').trim();
  if (scheme === 'env') {
    const value = env[body];
    if (!body || !value) {
      throw new Error(`PLOYKIT_AUTH_SECRET_REF_MISSING: ${ref}`);
    }
    return { secret: value, source: `env:${body}` };
  }
  if (scheme === 'raw') {
    if (!body) {
      throw new Error(`PLOYKIT_AUTH_SECRET_REF_MISSING: ${ref}`);
    }
    return { secret: body, source: 'raw' };
  }
  throw new Error(`PLOYKIT_AUTH_SECRET_REF_UNSUPPORTED: ${ref}`);
}

function devAuthSecret(): string {
  const state = globalThis as HostAuthDevSecretGlobal;
  state[DEV_AUTH_SECRET_KEY] ??= randomBytes(32).toString('base64url');
  return state[DEV_AUTH_SECRET_KEY]!;
}

export function hasHostAuthKeyRingConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.PLOYKIT_AUTH_KEY_REFS?.trim() || env.PLOYKIT_AUTH_SECRET_REF?.trim());
}

export function resolveHostAuthKeyRing(env: NodeJS.ProcessEnv = process.env): HostAuthKeyRing {
  const activeRefs = parseKeyRefList(
    env.PLOYKIT_AUTH_KEY_REFS ??
      (env.PLOYKIT_AUTH_SECRET_REF
        ? `${validateKid(env.PLOYKIT_AUTH_KEY_ID ?? 'auth-current')}=${env.PLOYKIT_AUTH_SECRET_REF}`
        : undefined)
  );
  const verifyRefs = parseKeyRefList(env.PLOYKIT_AUTH_VERIFY_SECRET_REFS);
  const keys: HostAuthSigningKey[] = [
    ...activeRefs.map((entry) => ({
      kid: entry.kid,
      ...resolveSecretRef(entry.ref, env),
    })),
    ...verifyRefs.map((entry) => ({
      kid: entry.kid,
      ...resolveSecretRef(entry.ref, env),
      verifyOnly: true,
    })),
  ];
  const active = keys.find((key) => !key.verifyOnly);
  if (active) {
    return { active, keys, configured: true };
  }
  if (productionProfile(env) || env.PLOYKIT_AUTH_ALLOW_DEV_SECRET === '0') {
    throw new Error('PLOYKIT_AUTH_KEY_RING_REQUIRED');
  }
  const devKey: HostAuthSigningKey = {
    kid: 'dev',
    secret: devAuthSecret(),
    source: 'volatile-dev',
  };
  return { active: devKey, keys: [devKey], configured: false };
}

function signWithSecret(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function signSessionPayload(payload: string): { kid: string; signature: string } {
  const key = resolveHostAuthKeyRing().active;
  return {
    kid: key.kid,
    signature: signWithSecret(key.secret, payload),
  };
}

function verifySessionPayload(
  kid: string | undefined,
  payload: string,
  signature: string
): boolean {
  const ring = resolveHostAuthKeyRing();
  const keys = kid ? ring.keys.filter((key) => key.kid === kid) : ring.keys;
  return keys.some((key) => safeEqual(signature, signWithSecret(key.secret, payload)));
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function encodeSessionCookieValue(userId: string, sessionId?: string, expiresAt?: string): string {
  const payload = Buffer.from(JSON.stringify({ userId, sessionId, expiresAt }), 'utf8').toString('base64url');
  const signed = signSessionPayload(payload);
  return `${CURRENT_AUTH_TOKEN_FORMAT}.${signed.kid}.${payload}.${signed.signature}`;
}

function decodeSessionCookieValue(value: string | undefined): DecodedHostSessionCookie | undefined {
  const [format, kid, payload, signature, ...rest] = (value ?? '').split('.');
  if (
    format !== CURRENT_AUTH_TOKEN_FORMAT ||
    !kid ||
    !payload ||
    !signature ||
    rest.length > 0
  ) {
    return undefined;
  }
  if (!verifySessionPayload(kid, payload, signature)) {
    return undefined;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      userId?: unknown;
      sessionId?: unknown;
      expiresAt?: unknown;
    };
    return typeof decoded.userId === 'string'
      ? {
          userId: decoded.userId,
          sessionId: typeof decoded.sessionId === 'string' ? decoded.sessionId : undefined,
          expiresAt: typeof decoded.expiresAt === 'string' ? decoded.expiresAt : undefined,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function tokenHash(token: string): string {
  const key = resolveHostAuthKeyRing().active;
  return `${CURRENT_AUTH_TOKEN_FORMAT}.${key.kid}.${signWithSecret(key.secret, token)}`;
}

function createToken(): string {
  return randomBytes(24).toString('base64url');
}

function nowIso(): string {
  return new Date().toISOString();
}

function expiresIso(ttlMs: number): string {
  return new Date(Date.now() + ttlMs).toISOString();
}

function isFuture(value: string): boolean {
  return new Date(value).getTime() > Date.now();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function readHostIdentitySeedPlan(env = process.env): HostIdentitySeedPlan {
  const demoUsersEnabled = envFlag(env.PLOYKIT_ENABLE_DEMO_USERS);
  if (demoUsersEnabled) {
    if (env.NODE_ENV === 'production') {
      throw new Error(DEMO_USERS_PRODUCTION_ERROR);
    }
    return { kind: 'demo', users: SEEDED_HOST_USERS };
  }

  const bootstrapEmail = env.PLOYKIT_BOOTSTRAP_ADMIN_EMAIL?.trim();
  const bootstrapPassword = env.PLOYKIT_BOOTSTRAP_ADMIN_PASSWORD;
  if (bootstrapEmail || bootstrapPassword) {
    if (!bootstrapEmail || !bootstrapPassword) {
      throw new Error(BOOTSTRAP_ADMIN_INCOMPLETE_ERROR);
    }
    if (!bootstrapEmail.includes('@')) {
      throw new Error('PLOYKIT_BOOTSTRAP_ADMIN_EMAIL_INVALID');
    }
    if (bootstrapPassword.length < envAuthPolicy().passwordMinLength) {
      throw new Error('PLOYKIT_BOOTSTRAP_ADMIN_PASSWORD_TOO_SHORT');
    }
    return {
      kind: 'bootstrap',
      users: [
        {
          id: 'bootstrap-admin',
          email: normalizeEmail(bootstrapEmail),
          password: bootstrapPassword,
          role: 'admin',
          workspaceRole: 'owner',
        },
      ],
    };
  }

  return { kind: 'none', users: [] };
}

function hostIdentitySeedPlanKey(plan: HostIdentitySeedPlan): string {
  return [
    plan.kind,
    ...plan.users.map((user) => `${user.id}:${normalizeEmail(user.email)}:${user.role}`),
  ].join('|');
}

function tokenRecord(value: unknown): HostAuthTokenRecord | null {
  const item = record(value);
  return typeof item.tokenHash === 'string' &&
    typeof item.createdAt === 'string' &&
    typeof item.expiresAt === 'string'
    ? {
        tokenHash: item.tokenHash,
        createdAt: item.createdAt,
        expiresAt: item.expiresAt,
        usedAt: typeof item.usedAt === 'string' ? item.usedAt : undefined,
        email: typeof item.email === 'string' ? item.email : undefined,
      }
    : null;
}

function sessionRecord(value: unknown): HostAuthSessionRecord | null {
  const item = record(value);
  return typeof item.id === 'string' &&
    typeof item.userId === 'string' &&
    typeof item.createdAt === 'string' &&
    typeof item.expiresAt === 'string'
    ? {
        id: item.id,
        userId: item.userId,
        createdAt: item.createdAt,
        expiresAt: item.expiresAt,
        revokedAt: typeof item.revokedAt === 'string' ? item.revokedAt : undefined,
        userAgent: typeof item.userAgent === 'string' ? item.userAgent : undefined,
      }
    : null;
}

function mailLogRecord(value: unknown): HostAuthMailLogRecord | null {
  const item = record(value);
  return typeof item.id === 'string' &&
    (item.type === 'password-reset' || item.type === 'email-verification') &&
    typeof item.email === 'string' &&
    typeof item.createdAt === 'string' &&
    typeof item.tokenPreview === 'string'
    ? {
        id: item.id,
        type: item.type,
        email: item.email,
        createdAt: item.createdAt,
        tokenPreview: item.tokenPreview,
      }
    : null;
}

function readAuthMetadata(user: RuntimeStoreHostUser): HostAuthMetadata {
  const auth = record(user.metadata.auth);
  return {
    sessions: Array.isArray(auth.sessions)
      ? auth.sessions.map(sessionRecord).filter((item): item is HostAuthSessionRecord => Boolean(item))
      : [],
    passwordResetTokens: Array.isArray(auth.passwordResetTokens)
      ? auth.passwordResetTokens.map(tokenRecord).filter((item): item is HostAuthTokenRecord => Boolean(item))
      : [],
    emailVerificationTokens: Array.isArray(auth.emailVerificationTokens)
      ? auth.emailVerificationTokens.map(tokenRecord).filter((item): item is HostAuthTokenRecord => Boolean(item))
      : [],
    emailVerifiedAt: typeof auth.emailVerifiedAt === 'string' ? auth.emailVerifiedAt : undefined,
    mailLog: Array.isArray(auth.mailLog)
      ? auth.mailLog.map(mailLogRecord).filter((item): item is HostAuthMailLogRecord => Boolean(item))
      : [],
  };
}

function withAuthMetadata(
  user: RuntimeStoreHostUser,
  auth: HostAuthMetadata
): RuntimeStoreHostUser {
  return {
    ...user,
    metadata: {
      ...user.metadata,
      auth,
    },
  };
}

function authSessionToHostRecord(session: RuntimeStoreAuthSession): HostAuthSessionRecord {
  return {
    id: session.id,
    userId: session.subjectId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt ?? session.createdAt,
    revokedAt: session.revokedAt,
    userAgent: typeof session.metadata.userAgent === 'string' ? session.metadata.userAgent : undefined,
  };
}

function isStoredAuthSessionActive(session: RuntimeStoreAuthSession): boolean {
  return session.status === 'active' && (!session.expiresAt || isFuture(session.expiresAt));
}

async function isSessionActive(
  store: RuntimeStore,
  user: RuntimeStoreHostUser,
  sessionId: string | undefined
): Promise<boolean> {
  if (!sessionId) {
    return process.env.NODE_ENV !== 'production';
  }
  const session = await store.getAuthSession(sessionId);
  if (
    session &&
    session.productId === user.productId &&
    session.subjectType === 'hosted_user' &&
    session.subjectId === user.id &&
    isStoredAuthSessionActive(session)
  ) {
    await store.touchAuthSession(session.id).catch(() => undefined);
    return true;
  }
  return !session && process.env.NODE_ENV !== 'production';
}

export function createHostPasswordHash(
  password: string,
  salt = randomBytes(16).toString('base64url')
): string {
  const key = scryptSync(password, salt, 32).toString('base64url');
  return `scrypt-v1.${salt}.${key}`;
}

export function verifyHostPassword(password: string, passwordHash: string): boolean {
  const [version, salt, expected, ...rest] = passwordHash.split('.');
  if (version !== 'scrypt-v1' || !salt || !expected || rest.length > 0) {
    return false;
  }
  const actual = scryptSync(password, salt, 32).toString('base64url');
  return safeEqual(actual, expected);
}

async function seedHostIdentity(store: RuntimeStore, plan: HostIdentitySeedPlan): Promise<void> {
  const seededUserIds: string[] = [];
  for (const user of plan.users) {
    const existing = await store.getHostUser(user.id);
    const existingByEmail = existing ? null : await store.findHostUserByEmail(normalizeEmail(user.email));
    if (plan.kind === 'bootstrap' && existingByEmail && existingByEmail.role !== 'admin') {
      throw new Error('PLOYKIT_BOOTSTRAP_ADMIN_EMAIL_CONFLICT');
    }
    if (!existing) {
      if (!existingByEmail) {
        await store.upsertHostUser({
          id: user.id,
          email: normalizeEmail(user.email),
          passwordHash: createHostPasswordHash(
            user.password,
            plan.kind === 'demo' ? `seed-${user.id}` : undefined
          ),
          role: user.role,
          status: 'active',
          productId: DEFAULT_PRODUCT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
          workspaceRole: user.workspaceRole ?? 'viewer',
          permissions: user.permissions,
          metadata: {
            seed: true,
            seedKind: plan.kind,
          },
        });
        seededUserIds.push(user.id);
      }
    }

    const membershipUserId = existing?.id ?? existingByEmail?.id ?? user.id;
    if (plan.kind === 'demo' || !existingByEmail || existingByEmail.role === 'admin') {
      await store.upsertMembership({
        productId: DEFAULT_PRODUCT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        userId: membershipUserId,
        role: user.workspaceRole ?? 'viewer',
        status: 'active',
      });
    }
  }

  const existingAudit = await store.listAudit({
    productId: DEFAULT_PRODUCT_ID,
    type: `host.identity.${plan.kind}.seeded`,
  });
  if (existingAudit.length === 0) {
    await store.recordAudit({
      productId: DEFAULT_PRODUCT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      actorId: 'system',
      type: `host.identity.${plan.kind}.seeded`,
      metadata: {
        users: plan.users.map((user) => user.id),
        createdUsers: seededUserIds,
      },
    });
  }
}

export async function ensureHostIdentitySeeded(store: RuntimeStore): Promise<void> {
  const plan = readHostIdentitySeedPlan();
  if (plan.kind === 'none') {
    return;
  }

  let storePromises = seedPromises.get(store);
  if (!storePromises) {
    storePromises = new Map();
    seedPromises.set(store, storePromises);
  }
  const planKey = hostIdentitySeedPlanKey(plan);
  let promise = storePromises.get(planKey);
  if (!promise) {
    promise = seedHostIdentity(store, plan).catch((error) => {
      storePromises.delete(planKey);
      throw error;
    });
    storePromises.set(planKey, promise);
  }

  await promise;
}

async function getHostIdentityStore(): Promise<RuntimeStore> {
  const runtimeStore = await getHostRuntimeStore();
  await ensureHostIdentitySeeded(runtimeStore.store);
  return runtimeStore.store;
}

function tokenMailLog(
  type: HostAuthMailLogRecord['type'],
  email: string,
  token: string
): HostAuthMailLogRecord {
  return {
    id: `${type}-${randomBytes(8).toString('hex')}`,
    type,
    email,
    createdAt: nowIso(),
    tokenPreview: `${token.slice(0, 6)}...${token.slice(-4)}`,
  };
}

function tokenHashMatches(storedHash: string, token: string): boolean {
  const [format, kid, digest, ...rest] = storedHash.split('.');
  if (format !== CURRENT_AUTH_TOKEN_FORMAT || !kid || !digest || rest.length > 0) {
    return false;
  }
  const key = resolveHostAuthKeyRing().keys.find((candidate) => candidate.kid === kid);
  return Boolean(key && safeEqual(digest, signWithSecret(key.secret, token)));
}

function hasUsableToken(tokens: readonly HostAuthTokenRecord[], token: string): boolean {
  return tokens.some(
    (item) => tokenHashMatches(item.tokenHash, token) && !item.usedAt && isFuture(item.expiresAt)
  );
}

function markTokenUsed(tokens: readonly HostAuthTokenRecord[], token: string): HostAuthTokenRecord[] {
  return tokens.map((item) =>
    tokenHashMatches(item.tokenHash, token) && !item.usedAt
      ? {
          ...item,
          usedAt: nowIso(),
        }
      : item
  );
}

async function recordAuthAudit(
  store: RuntimeStore,
  user: RuntimeStoreHostUser,
  type: string,
  metadata: Record<string, unknown>
) {
  await store.recordAudit({
    productId: user.productId,
    workspaceId: user.workspaceId,
    actorId: user.id,
    type,
    metadata,
  });
}

async function findUserByToken(
  store: RuntimeStore,
  selector: (auth: HostAuthMetadata) => readonly HostAuthTokenRecord[],
  token: string
): Promise<RuntimeStoreHostUser | null> {
  const users = await store.listHostUsers({ productId: DEFAULT_PRODUCT_ID });
  return (
    users.find((user) => hasUsableToken(selector(readAuthMetadata(user)), token)) ?? null
  );
}

export function createRuntimeStoreHostAuthAdapter(store: RuntimeStore): HostAuthAdapter {
  return {
    async authenticate(email, password) {
      const user = await store.findHostUserByEmail(normalizeEmail(email));
      if (!user || user.status !== 'active') {
        return null;
      }
      return verifyHostPassword(password, user.passwordHash) ? user : null;
    },

    async createSession(user, input = {}) {
      const policy = await getHostAuthPolicyForStore(store);
      const expiresAt = expiresIso(policy.sessionTtlMs);
      const session: HostAuthSessionRecord = {
        id: `session-${randomBytes(12).toString('hex')}`,
        userId: user.id,
        createdAt: nowIso(),
        expiresAt,
        userAgent: input.userAgent,
      };
      await store.createAuthSession({
        id: session.id,
        productId: user.productId,
        environmentId: DEFAULT_HOST_ENVIRONMENT_ID,
        workspaceId: user.workspaceId,
        subjectType: 'hosted_user',
        subjectId: user.id,
        sessionType: 'browser',
        expiresAt,
        metadata: {
          userAgent: input.userAgent,
        },
      });
      await recordAuthAudit(store, user, 'host.auth.session.created', {
        sessionId: session.id,
      });
      return {
        session,
        cookie: createHostSessionCookieForSession(user.id, session.id, policy.sessionTtlMs),
      };
    },

    async revokeSession(userId, sessionId) {
      const user = await store.getHostUser(userId);
      if (!user) {
        return;
      }
      const session = await store.getAuthSession(sessionId);
      if (
        session?.subjectType === 'hosted_user' &&
        session.subjectId === user.id &&
        session.productId === user.productId
      ) {
        await store
          .revokeAuthSession(sessionId, { reason: 'user_requested' })
          .catch(() => undefined);
      }
      await recordAuthAudit(store, user, 'host.auth.session.revoked', {
        sessionId,
      });
    },

    async resolveSession(cookieHeader) {
      const decoded = readHostSessionCookie(cookieHeader);
      if (!decoded) {
        return createAnonymousHostSession();
      }
      const user = await store.getHostUser(decoded.userId);
      return user &&
        user.status === 'active' &&
        (await isSessionActive(store, user, decoded.sessionId))
        ? createHostSessionForUser(user, { authSessionId: decoded.sessionId })
        : createAnonymousHostSession();
    },

    async register(input) {
      const policy = await getHostAuthPolicyForStore(store);
      const email = normalizeEmail(input.email);
      if (!email.includes('@')) {
        throw new Error('AUTH_EMAIL_INVALID');
      }
      if (input.password.length < policy.passwordMinLength) {
        throw new Error('AUTH_PASSWORD_TOO_SHORT');
      }
      const existing = await store.findHostUserByEmail(email);
      if (existing) {
        throw new Error('AUTH_EMAIL_EXISTS');
      }

      const token = createToken();
      const createdAt = nowIso();
      const user = await store.upsertHostUser({
        id: `host-user-${randomBytes(8).toString('hex')}`,
        email,
        passwordHash: createHostPasswordHash(input.password),
        role: 'user',
        status: policy.requireEmailVerification ? 'pending-verification' : 'active',
        productId: DEFAULT_PRODUCT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        workspaceRole: 'editor',
        permissions: USER_PERMISSIONS,
        metadata: {
          profile: {
            displayName: input.displayName,
          },
          auth: {
            sessions: [],
            passwordResetTokens: [],
            emailVerificationTokens: policy.requireEmailVerification
              ? [
                  {
                    tokenHash: tokenHash(token),
                    createdAt,
                    expiresAt: expiresIso(24 * TOKEN_TTL_MS),
                    email,
                  },
                ]
              : [],
            mailLog: policy.requireEmailVerification
              ? [tokenMailLog('email-verification', email, token)]
              : [],
          } satisfies HostAuthMetadata,
        },
      });
      await store.upsertMembership({
        productId: DEFAULT_PRODUCT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        userId: user.id,
        role: 'editor',
        status: 'active',
      });
      await recordAuthAudit(store, user, 'host.auth.user.registered', {
        status: user.status,
      });
      return { user, emailVerificationToken: token };
    },

    async requestPasswordReset(emailInput) {
      const email = normalizeEmail(emailInput);
      const user = await store.findHostUserByEmail(email);
      if (!user || user.status === 'deleted') {
        return { sent: true };
      }
      const token = createToken();
      const auth = readAuthMetadata(user);
      const saved = await store.upsertHostUser(
        withAuthMetadata(user, {
          ...auth,
          passwordResetTokens: [
            ...auth.passwordResetTokens.filter((item) => !item.usedAt && isFuture(item.expiresAt)),
            {
              tokenHash: tokenHash(token),
              createdAt: nowIso(),
              expiresAt: expiresIso(TOKEN_TTL_MS),
              email,
            },
          ],
          mailLog: [...auth.mailLog, tokenMailLog('password-reset', email, token)].slice(-20),
        })
      );
      await recordAuthAudit(store, saved, 'host.auth.password_reset.requested', {});
      return { sent: true, resetToken: token };
    },

    async resetPassword(token, newPassword) {
      const policy = await getHostAuthPolicyForStore(store);
      if (newPassword.length < policy.passwordMinLength) {
        throw new Error('AUTH_PASSWORD_TOO_SHORT');
      }
      const user = await findUserByToken(store, (auth) => auth.passwordResetTokens, token);
      if (!user) {
        throw new Error('AUTH_PASSWORD_RESET_TOKEN_INVALID');
      }
      const auth = readAuthMetadata(user);
      const saved = await store.upsertHostUser(
        withAuthMetadata(
          {
            ...user,
            passwordHash: createHostPasswordHash(newPassword),
          },
          {
            ...auth,
            passwordResetTokens: markTokenUsed(auth.passwordResetTokens, token),
          }
        )
      );
      await store.revokeAuthSessions({
        productId: saved.productId,
        subjectType: 'hosted_user',
        subjectId: saved.id,
        reason: 'password_reset',
      });
      await recordAuthAudit(store, saved, 'host.auth.password_reset.completed', {});
      return saved;
    },

    async verifyEmail(token) {
      const user = await findUserByToken(store, (auth) => auth.emailVerificationTokens, token);
      if (!user) {
        throw new Error('AUTH_EMAIL_VERIFICATION_TOKEN_INVALID');
      }
      const auth = readAuthMetadata(user);
      const saved = await store.upsertHostUser(
        withAuthMetadata(
          {
            ...user,
            status: 'active' as RuntimeStoreHostUserStatus,
          },
          {
            ...auth,
            emailVerificationTokens: markTokenUsed(auth.emailVerificationTokens, token),
            emailVerifiedAt: nowIso(),
          }
        )
      );
      await recordAuthAudit(store, saved, 'host.auth.email.verified', {});
      return saved;
    },

    async listSessions(userId) {
      const user = await store.getHostUser(userId);
      if (!user) {
        return [];
      }
      const sessions = await store.listAuthSessions({
        productId: user.productId,
        subjectType: 'hosted_user',
        subjectId: user.id,
        status: 'active',
      });
      return sessions.filter(isStoredAuthSessionActive).map(authSessionToHostRecord);
    },
  };
}

export async function getHostAuthAdapter(): Promise<HostAuthAdapter> {
  return createRuntimeStoreHostAuthAdapter(await getHostIdentityStore());
}

export async function authenticateHostUser(
  email: string,
  password: string
): Promise<RuntimeStoreHostUser | null> {
  return (await getHostAuthAdapter()).authenticate(email, password);
}

export function createHostSessionCookie(userId: string): string {
  const maxAgeSeconds = Math.floor(envAuthPolicy().sessionTtlMs / 1000);
  const cookie = [
    `${HOST_AUTH_COOKIE}=${encodeURIComponent(encodeSessionCookieValue(userId))}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (process.env.NODE_ENV === 'production') {
    cookie.push('Secure');
  }
  return cookie.join('; ');
}

export function createHostSessionCookieForSession(
  userId: string,
  sessionId: string,
  ttlMs = envAuthPolicy().sessionTtlMs
): string {
  const expiresAt = expiresIso(ttlMs);
  const maxAgeSeconds = Math.floor(ttlMs / 1000);
  const cookie = [
    `${HOST_AUTH_COOKIE}=${encodeURIComponent(encodeSessionCookieValue(userId, sessionId, expiresAt))}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (process.env.NODE_ENV === 'production') {
    cookie.push('Secure');
  }
  return cookie.join('; ');
}

export function clearHostSessionCookie(): string {
  return `${HOST_AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function createHostSessionForUser(
  user: Pick<
    RuntimeStoreHostUser,
    'id' | 'email' | 'role' | 'productId' | 'workspaceId' | 'workspaceRole'
  > & {
    permissions?: readonly PermissionValue[];
  },
  options: { authSessionId?: string } = {}
): ModuleHostSession {
  return {
    user: {
      id: user.id,
      role: user.role,
      email: user.email,
    },
    userId: user.id,
    actorId: user.id,
    authSessionId: options.authSessionId,
    productId: user.productId,
    environmentId: DEFAULT_HOST_ENVIRONMENT_ID,
    workspaceId: user.workspaceId,
    workspaceRole: user.workspaceRole,
    productScopeProfile: DEFAULT_HOST_PRODUCT_SCOPE_PROFILE,
    permissions: user.role === 'admin' ? undefined : (user.permissions ?? USER_PERMISSIONS),
    entitlements: ['demo.entitlement', ...demoModuleEntitlements()],
    plans: ['demo'],
    plan: 'demo',
    creditsBalance: user.role === 'admin' ? 1000 : 120,
    data: null,
  };
}

export function createAnonymousHostSession(): ModuleHostSession {
  return {
    ...createAnonymousModuleHostSession(),
    productId: DEFAULT_PRODUCT_ID,
    environmentId: DEFAULT_HOST_ENVIRONMENT_ID,
    workspaceId: DEFAULT_WORKSPACE_ID,
    productScopeProfile: DEFAULT_HOST_PRODUCT_SCOPE_PROFILE,
    data: null,
  };
}

export async function resolveHostSessionFromCookieHeader(
  cookieHeader: string | null
): Promise<ModuleHostSession> {
  return (await getHostAuthAdapter()).resolveSession(cookieHeader);
}

export function decodeHostSessionUserIdFromCookieHeader(
  cookieHeader: string | null
): string | undefined {
  return readHostSessionCookie(cookieHeader)?.userId;
}

export function readHostSessionCookie(cookieHeader: string | null): DecodedHostSessionCookie | undefined {
  return decodeSessionCookieValue(parseCookieHeader(cookieHeader).get(HOST_AUTH_COOKIE));
}

export async function revokeHostSessionFromCookieHeader(cookieHeader: string | null): Promise<void> {
  const decoded = readHostSessionCookie(cookieHeader);
  if (decoded?.sessionId) {
    await (await getHostAuthAdapter()).revokeSession(decoded.userId, decoded.sessionId);
  }
}

export function resolveHostSessionFromRequest(request: Request): Promise<ModuleHostSession> {
  return resolveHostSessionFromCookieHeader(request.headers.get('cookie'));
}

export async function getCurrentHostSession(): Promise<ModuleHostSession> {
  const requestHeaders = await headers();
  return resolveHostSessionFromCookieHeader(requestHeaders.get('cookie'));
}

function loginHref(lang: SupportedLanguage, nextPath: string): string {
  const loginPath = localizedPath(lang, '/login');
  return `${loginPath}?next=${encodeURIComponent(nextPath)}`;
}

export async function requireHostUser(
  lang: SupportedLanguage,
  nextPath: string
): Promise<ModuleHostSession> {
  const session = await getCurrentHostSession();
  if (!session.user) {
    redirect(loginHref(lang, nextPath));
  }

  return session;
}

export async function requireAdminUser(
  lang: SupportedLanguage,
  nextPath: string
): Promise<ModuleHostSession> {
  const session = await requireHostUser(lang, nextPath);
  try {
    requireCapability(session, 'admin.access');
  } catch {
    redirect(localizedPath(lang, '/dashboard'));
  }

  return session;
}

export function safeRedirectPath(
  value: FormDataEntryValue | string | null,
  fallback = localizedDashboardPath(DEFAULT_LANGUAGE)
): string {
  const path = typeof value === 'string' && value.startsWith('/') ? value : fallback;
  if (path.startsWith('//') || path.includes('://')) {
    return fallback;
  }

  return path;
}
