import path from 'node:path';
import type { ModuleFilePurpose, ModuleFileVisibility } from '@ploykit/module-sdk';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import { createLocalModuleFileStorage } from '@/lib/module-capabilities/files/local-storage';
import { createMemoryModuleFileStorage } from '@/lib/module-capabilities/files/memory-storage';
import { createS3CompatibleHttpClient } from '@/lib/module-capabilities/files/s3-compatible-http-client';
import { createS3CompatibleModuleFileStorage } from '@/lib/module-capabilities/files/s3-storage';
import type { ModuleFileStorageAdapter } from '@/lib/module-capabilities/files/storage-adapter';
import {
  createStorageBackedModuleFileRuntime,
  type StorageBackedModuleFileRuntime,
} from '@/lib/module-capabilities/files/storage-file-runtime';
import type {
  RuntimeStore,
  RuntimeStoreFileRecord,
} from '@/lib/module-runtime/stores/runtime-store-types';
import { defaultProductId } from './default-scope';
import { getHostRuntimeStore } from './runtime-store';

export type HostFileStorageMode = 'memory' | 'local' | 's3';

export interface HostFileStorageConfig {
  mode: HostFileStorageMode;
  rootDir: string;
  publicBaseUrl?: string;
  s3Configured: boolean;
  s3?: {
    bucket: string;
    endpoint: string;
    publicEndpoint?: string;
    region: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

export interface HostFileStorageStatus {
  mode: HostFileStorageMode;
  durable: boolean;
  rootDir?: string;
  bucket?: string;
  endpoint?: string;
  region?: string;
  s3Configured: boolean;
}

export interface HostFileStorageHandle {
  storage: ModuleFileStorageAdapter;
  status: HostFileStorageStatus;
}

export interface HostFileUploadInput {
  moduleId?: string;
  name: string;
  purpose?: ModuleFilePurpose;
  contentType?: string;
  visibility?: ModuleFileVisibility;
  content: string | ArrayBuffer | Uint8Array;
  sizeBytes?: number;
}

export interface HostFileListQuery {
  moduleId?: string;
  purpose?: ModuleFilePurpose;
  status?: RuntimeStoreFileRecord['status'];
  q?: string;
}

export interface HostFileQuotaStatus {
  planId?: string;
  policySource: 'global' | 'plan';
  perUserBytes: number;
  perWorkspaceBytes: number;
  perModuleBytes: number;
  userBytes: number;
  workspaceBytes: number;
  moduleBytes: number;
}

type HostFileStorageEnv = Partial<
  Record<
    | 'PLOYKIT_FILE_STORAGE'
    | 'PLOYKIT_FILE_STORAGE_ROOT'
    | 'PLOYKIT_FILE_PUBLIC_BASE_URL'
    | 'S3_BUCKET'
    | 'S3_ENDPOINT'
    | 'S3_PUBLIC_ENDPOINT'
    | 'S3_REGION'
    | 'S3_ACCESS_KEY_ID'
    | 'S3_SESSION_TOKEN'
    | 'S3_SECRET_ACCESS_KEY'
    | 'S3_FORCE_PATH_STYLE'
    | 'PLOYKIT_FILE_USER_QUOTA_BYTES'
    | 'PLOYKIT_FILE_WORKSPACE_QUOTA_BYTES'
    | 'PLOYKIT_FILE_MODULE_QUOTA_BYTES'
    | 'PLOYKIT_FILE_PLAN_QUOTAS_JSON',
    string | undefined
  >
>;

type HostFileQuotaPolicy = Pick<
  HostFileQuotaStatus,
  'perUserBytes' | 'perWorkspaceBytes' | 'perModuleBytes' | 'planId' | 'policySource'
>;

type HostFilePlanQuota = Partial<
  Pick<HostFileQuotaStatus, 'perUserBytes' | 'perWorkspaceBytes' | 'perModuleBytes'>
>;

function normalizeMode(value: string | undefined): HostFileStorageMode {
  if (!value) {
    return 'local';
  }
  if (value === 'memory' || value === 'local' || value === 's3') {
    return value;
  }
  throw new Error(`PLOYKIT_FILE_STORAGE_INVALID: expected memory, local or s3, got ${value}`);
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readPlanQuotaValue(value: unknown, fallback: number, key: string): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`PLOYKIT_FILE_PLAN_QUOTAS_INVALID: ${key} must be a positive number.`);
  }
  return Math.floor(parsed);
}

function parsePlanQuotas(value: string | undefined): Record<string, HostFilePlanQuota> {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null') {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error('PLOYKIT_FILE_PLAN_QUOTAS_INVALID: expected valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('PLOYKIT_FILE_PLAN_QUOTAS_INVALID: expected a JSON object.');
  }
  return parsed as Record<string, HostFilePlanQuota>;
}

function sessionPlanIds(session: ModuleHostSession | undefined): string[] {
  return [
    session?.plan,
    ...(session?.plans ?? []),
  ].filter((planId, index, planIds): planId is string => Boolean(planId) && planIds.indexOf(planId) === index);
}

export function resolveHostFileQuotaPolicy(
  session?: ModuleHostSession,
  env: HostFileStorageEnv = process.env as HostFileStorageEnv
): HostFileQuotaPolicy {
  const globalPolicy = {
    perUserBytes: readPositiveInt(env.PLOYKIT_FILE_USER_QUOTA_BYTES, 50 * 1024 * 1024),
    perWorkspaceBytes: readPositiveInt(
      env.PLOYKIT_FILE_WORKSPACE_QUOTA_BYTES,
      250 * 1024 * 1024
    ),
    perModuleBytes: readPositiveInt(env.PLOYKIT_FILE_MODULE_QUOTA_BYTES, 100 * 1024 * 1024),
    policySource: 'global' as const,
  };
  const planQuotas = parsePlanQuotas(env.PLOYKIT_FILE_PLAN_QUOTAS_JSON);
  const planId = sessionPlanIds(session).find((candidate) => planQuotas[candidate]);
  const planQuota = planId ? planQuotas[planId] : undefined;
  if (!planId || !planQuota) {
    return globalPolicy;
  }
  return {
    planId,
    policySource: 'plan',
    perUserBytes: readPlanQuotaValue(planQuota.perUserBytes, globalPolicy.perUserBytes, `${planId}.perUserBytes`),
    perWorkspaceBytes: readPlanQuotaValue(
      planQuota.perWorkspaceBytes,
      globalPolicy.perWorkspaceBytes,
      `${planId}.perWorkspaceBytes`
    ),
    perModuleBytes: readPlanQuotaValue(
      planQuota.perModuleBytes,
      globalPolicy.perModuleBytes,
      `${planId}.perModuleBytes`
    ),
  };
}

export function resolveHostFileStorageConfig(env: HostFileStorageEnv): HostFileStorageConfig {
  const mode = normalizeMode(env.PLOYKIT_FILE_STORAGE);
  const s3Configured = Boolean(
    env.S3_BUCKET && env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
  );
  return {
    mode,
    rootDir: env.PLOYKIT_FILE_STORAGE_ROOT ?? path.join(process.cwd(), '.runtime', 'files'),
    publicBaseUrl: env.PLOYKIT_FILE_PUBLIC_BASE_URL,
    s3Configured,
    s3: s3Configured
      ? {
          bucket: env.S3_BUCKET!,
          endpoint: env.S3_ENDPOINT!,
          publicEndpoint: env.S3_PUBLIC_ENDPOINT ?? env.PLOYKIT_FILE_PUBLIC_BASE_URL,
          region: env.S3_REGION ?? 'us-east-1',
          forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
          accessKeyId: env.S3_ACCESS_KEY_ID!,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
          sessionToken: env.S3_SESSION_TOKEN,
        }
      : undefined,
  };
}

let storagePromise: Promise<HostFileStorageHandle> | null = null;

async function createStorageHandle(): Promise<HostFileStorageHandle> {
  const config = resolveHostFileStorageConfig({
    PLOYKIT_FILE_STORAGE: process.env.PLOYKIT_FILE_STORAGE,
    PLOYKIT_FILE_STORAGE_ROOT: process.env.PLOYKIT_FILE_STORAGE_ROOT,
    PLOYKIT_FILE_PUBLIC_BASE_URL: process.env.PLOYKIT_FILE_PUBLIC_BASE_URL,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT,
    S3_REGION: process.env.S3_REGION,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_SESSION_TOKEN: process.env.S3_SESSION_TOKEN,
    S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
  });

  if (config.mode === 'memory') {
    return {
      storage: createMemoryModuleFileStorage(),
      status: {
        mode: 'memory',
        durable: false,
        s3Configured: config.s3Configured,
      },
    };
  }

  if (config.mode === 's3') {
    if (!config.s3) {
      throw new Error(
        'HOST_FILE_STORAGE_S3_CONFIG_REQUIRED: S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required.'
      );
    }
    return {
      storage: createS3CompatibleModuleFileStorage({
        bucket: config.s3.bucket,
        client: createS3CompatibleHttpClient({
          endpoint: config.s3.endpoint,
          publicEndpoint: config.s3.publicEndpoint,
          region: config.s3.region,
          accessKeyId: config.s3.accessKeyId,
          secretAccessKey: config.s3.secretAccessKey,
          sessionToken: config.s3.sessionToken,
          forcePathStyle: config.s3.forcePathStyle,
        }),
      }),
      status: {
        mode: 's3',
        durable: true,
        bucket: config.s3.bucket,
        endpoint: config.s3.endpoint,
        region: config.s3.region,
        s3Configured: true,
      },
    };
  }

  return {
    storage: createLocalModuleFileStorage({
      rootDir: config.rootDir,
      publicBaseUrl: config.publicBaseUrl,
    }),
    status: {
      mode: 'local',
      durable: true,
      rootDir: config.rootDir,
      s3Configured: config.s3Configured,
    },
  };
}

export function getHostFileStorage(): Promise<HostFileStorageHandle> {
  storagePromise ??= createStorageHandle();
  return storagePromise;
}

export function createHostFileRuntimeFromParts(input: {
  store: RuntimeStore;
  storage: ModuleFileStorageAdapter;
  session: ModuleHostSession;
}): StorageBackedModuleFileRuntime {
  return createStorageBackedModuleFileRuntime({
    store: input.store,
    storage: input.storage,
    productId: defaultProductId(input.session.productId),
    workspaceId: input.session.workspaceId ?? null,
    ownerId: input.session.userId ?? input.session.user?.id ?? null,
    mediaSecret: process.env.PLOYKIT_MEDIA_SECRET,
    quota: resolveHostFileQuotaPolicy(input.session),
    uploadPolicy: {
      maxBytes: 10 * 1024 * 1024,
      allowedMimeTypes: [
        'text/plain',
        'application/json',
        'text/csv',
        'image/png',
        'image/jpeg',
        'application/octet-stream',
      ],
      defaultVisibility: 'private',
    },
  });
}

export async function getHostFileRuntime(
  session: ModuleHostSession
): Promise<StorageBackedModuleFileRuntime> {
  const [runtimeStore, fileStorage] = await Promise.all([
    getHostRuntimeStore(),
    getHostFileStorage(),
  ]);
  return createHostFileRuntimeFromParts({
    store: runtimeStore.store,
    storage: fileStorage.storage,
    session,
  });
}

export async function getHostFileStorageStatus(): Promise<HostFileStorageStatus> {
  return (await getHostFileStorage()).status;
}

export async function uploadHostUserFile(session: ModuleHostSession, input: HostFileUploadInput) {
  const files = await getHostFileRuntime(session);
  const moduleFiles = files.forModule(input.moduleId ?? 'web-shell');
  const upload = await moduleFiles.createUpload({
    name: input.name,
    purpose: input.purpose ?? 'source',
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    visibility: input.visibility,
  });
  const file = await moduleFiles.completeUpload(upload.file.id, {
    content: input.content,
    sizeBytes: input.sizeBytes,
  });
  return {
    file,
    signedUrl: await moduleFiles.createSignedUrl(file.id),
  };
}

export async function listHostUserFiles(session: ModuleHostSession, query: HostFileListQuery = {}) {
  const files = await getHostFileRuntime(session);
  const ownerFiles = await files.admin.list({
    moduleId: query.moduleId,
    ownerId: session.userId ?? session.user?.id,
    status: query.status,
    includeDeleted: false,
  });
  return ownerFiles
    .filter((file) => !query.purpose || file.purpose === query.purpose)
    .filter((file) => {
      const needle = query.q?.trim().toLowerCase();
      if (!needle) {
        return true;
      }
      return [file.id, file.name, file.moduleId, file.purpose, file.status, file.contentType ?? '']
        .some((value) => value.toLowerCase().includes(needle));
    });
}

function ensureUserCanAccessFile(session: ModuleHostSession, file: RuntimeStoreFileRecord): void {
  const userId = session.userId ?? session.user?.id;
  if (
    session.user?.role === 'admin' ||
    (userId && file.ownerId === userId && file.productId === (session.productId ?? file.productId))
  ) {
    return;
  }
  throw new Error('HOST_FILE_FORBIDDEN');
}

export async function getHostUserFile(session: ModuleHostSession, fileId: string) {
  const files = await getHostFileRuntime(session);
  const runtimeStore = await getHostRuntimeStore();
  const file = await runtimeStore.store.getFile(fileId);
  if (!file || file.status === 'deleted') {
    return null;
  }
  ensureUserCanAccessFile(session, file);
  return {
    file,
    signedUrl:
      file.status === 'ready' || file.status === 'published'
        ? await files.mediaGateway.createUrl(file)
        : null,
  };
}

export async function updateHostUserFileStatus(
  session: ModuleHostSession,
  fileId: string,
  action: 'archive' | 'delete' | 'publish' | 'restore'
) {
  const runtimeStore = await getHostRuntimeStore();
  const file = await runtimeStore.store.getFile(fileId);
  if (!file) {
    throw new Error('HOST_FILE_NOT_FOUND');
  }
  ensureUserCanAccessFile(session, file);

  const timestamp = new Date().toISOString();
  const patch =
    action === 'delete'
      ? { status: 'deleted' as const, deletedAt: timestamp }
      : action === 'archive'
        ? { status: 'archived' as const }
        : action === 'publish'
          ? { status: 'published' as const, visibility: 'public' as const, publishedAt: timestamp }
          : { status: 'ready' as const };
  const next = await runtimeStore.store.updateFile(fileId, patch);
  await runtimeStore.store.recordAudit({
    productId: next.productId,
    workspaceId: next.workspaceId,
    moduleId: next.moduleId,
    actorId: session.actorId ?? session.user?.id,
    type: `host.file.${action}`,
    metadata: { fileId },
  });
  return next;
}

export async function getHostFileQuotaStatus(
  session: ModuleHostSession,
  moduleId = 'web-shell'
): Promise<HostFileQuotaStatus> {
  const runtimeStore = await getHostRuntimeStore();
  const quota = resolveHostFileQuotaPolicy(session);
  const ownerId = session.userId ?? session.user?.id;
  const [userFiles, workspaceFiles, moduleFiles] = await Promise.all([
    ownerId
      ? runtimeStore.store.listFiles({
          productId: defaultProductId(session.productId),
          workspaceId: session.workspaceId ?? null,
          ownerId,
          includeDeleted: false,
        })
      : [],
    runtimeStore.store.listFiles({
      productId: defaultProductId(session.productId),
      workspaceId: session.workspaceId ?? null,
      includeDeleted: false,
    }),
    runtimeStore.store.listFiles({
      productId: defaultProductId(session.productId),
      workspaceId: session.workspaceId ?? null,
      moduleId,
      includeDeleted: false,
    }),
  ]);
  const sum = (files: readonly RuntimeStoreFileRecord[]) =>
    files.reduce((total, file) => total + file.sizeBytes, 0);
  return {
    ...quota,
    userBytes: sum(userFiles),
    workspaceBytes: sum(workspaceFiles),
    moduleBytes: sum(moduleFiles),
  };
}

export function resetHostFileStorageForTests(): void {
  storagePromise = null;
}
