import { createHmac, randomBytes, randomUUID } from 'crypto';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import {
  Permission,
  PluginError,
  type PluginConnectorAuthProfile,
  type PluginConnectorCallResult,
  type PluginConnectorEgressPolicy,
  type PluginConnectorFileReference,
  type PluginConnectorRedactionPolicy,
  type PluginConnectorRecord,
  type PluginConnectorResolvedFile,
  type PluginConnectorRetryPolicy,
  type PluginConnectorSignedCallback,
  type PluginConnectors,
} from '@ploykit/plugin-sdk';
import { db, type Database } from '@/lib/db/client.server';
import {
  pluginConnectorCallLogs,
  pluginConnectors,
  type NewPluginConnectorCallLog,
  type PluginConnector,
} from '@/lib/db/schema/plugin-platform';
import {
  assertJsonSerializable,
  assertResourceScopeAccess,
  currentApiKeyId,
  denormalizeResourceScope,
  enforceCapabilityPermission,
  normalizeResourceScope,
  requireUser,
  type NormalizedPluginResourceScope,
  type PluginCapabilityScope,
} from './guards.server';
import { recordCapabilityAudit } from './audit-helper.server';
import type { AuditPort } from '@/lib/audit/audit-port.server';
import { env } from '@/lib/_core/env';
import type { UsageCategory, UsageLedger } from '@/lib/usage/usage-ledger.server';
import { getDefaultCreditMetric, type PluginCreditsHost } from './credits-capability.server';
import { getCurrentRuntimeProductId } from '@/lib/plugin-runtime/product-context.server';
import { createPluginFilesCapability } from './files-capability.server';
import { DbPluginSecretsRepository } from './secrets-capability.server';
import { assertSafeEgressTarget } from './egress-guard.server';

type TransactionDatabase = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Database | TransactionDatabase;

export interface PluginConnectorsScope {
  pluginId: string;
  userId: string;
  requestId: string;
}

export interface PluginConnectorsRepository {
  get(
    scope: PluginConnectorsScope,
    name: string,
    resourceScope?: NormalizedPluginResourceScope
  ): Promise<PluginConnector | null>;
  list(
    scope: PluginConnectorsScope,
    input: { resourceScope?: NormalizedPluginResourceScope; includeDisabled: boolean }
  ): Promise<PluginConnector[]>;
  upsert(
    scope: PluginConnectorsScope,
    input: {
      name: string;
      type: string;
      baseUrl: string;
      resourceScope?: NormalizedPluginResourceScope;
      auth: PluginConnectorAuthProfile;
      authType: string;
      secretName?: string;
      egress: PluginConnectorEgressPolicy;
      retry: PluginConnectorRetryPolicy;
      redaction: PluginConnectorRedactionPolicy;
      timeoutMs: number;
      retryCount: number;
      metadata: Record<string, unknown>;
    }
  ): Promise<PluginConnector>;
  setStatus(
    scope: PluginConnectorsScope,
    name: string,
    status: 'active' | 'disabled',
    resourceScope?: NormalizedPluginResourceScope
  ): Promise<PluginConnector>;
  delete(
    scope: PluginConnectorsScope,
    name: string,
    resourceScope?: NormalizedPluginResourceScope
  ): Promise<void>;
  recordCall(scope: PluginConnectorsScope, input: NewPluginConnectorCallLog): Promise<void>;
}

export interface PluginConnectorHttpHost {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

export interface PluginConnectorSecretHost {
  get(name: string): Promise<string | null>;
}

export interface PluginConnectorFilesHost {
  resolve(input: {
    scope: PluginCapabilityScope;
    connectorScope: PluginConnectorsScope;
    files: PluginConnectorFileReference[];
  }): Promise<PluginConnectorResolvedFile[]>;
}

export interface CreatePluginConnectorsOptions {
  repository?: PluginConnectorsRepository;
  httpHost?: PluginConnectorHttpHost;
  secretHost?: PluginConnectorSecretHost;
  filesHost?: PluginConnectorFilesHost;
  auditPort?: AuditPort;
  usageLedger?: UsageLedger;
  creditsHost?: Partial<PluginCreditsHost>;
  callbackBaseUrl?: string;
  callbackSecret?: string;
}

const MAX_CONNECTOR_FILE_REFERENCES = 20;
const DEFAULT_RETRY_BACKOFF_MS = 250;
const DEFAULT_RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];
const DEFAULT_REDACTED_FIELD_PATTERN = /token|secret|key|authorization|password|credential/i;

function resolveScope(scope: PluginCapabilityScope, capability: string): PluginConnectorsScope {
  const user = requireUser(scope, capability);
  return { pluginId: scope.contract.id, userId: user.id, requestId: scope.requestId };
}

function validateConnectorName(name: string): string {
  const normalized = name.trim();
  if (!/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_NAME_INVALID',
      message:
        'Connector name may only contain letters, numbers, dots, underscores, colons, and hyphens.',
      statusCode: 400,
    });
  }
  return normalized;
}

function validateConnectorType(type: string | undefined): string {
  const normalized = (type ?? 'http').trim();
  if (!/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_TYPE_INVALID',
      message:
        'Connector type may only contain letters, numbers, dots, underscores, colons, and hyphens.',
      statusCode: 400,
    });
  }
  return normalized;
}

function validateBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_BASE_URL_INVALID',
      message: 'Connector baseUrl must be a valid http or https URL.',
      statusCode: 400,
    });
  }
}

function normalizeTimeoutMs(value: number | undefined): number {
  if (value === undefined) return 30000;
  if (!Number.isInteger(value) || value < 100 || value > 300000) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_TIMEOUT_INVALID',
      message: 'Connector timeoutMs must be an integer between 100 and 300000.',
      statusCode: 400,
    });
  }
  return value;
}

function normalizeRetryCount(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0 || value > 5) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_RETRY_INVALID',
      message: 'Connector retryCount must be an integer between 0 and 5.',
      statusCode: 400,
    });
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown, label: string, max = 50): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_POLICY_INVALID',
      message: `${label} must be an array of strings.`,
      statusCode: 400,
    });
  }
  if (value.length > max) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_POLICY_INVALID',
      message: `${label} may include at most ${max} values.`,
      statusCode: 400,
    });
  }
  return value.map((item, index) => {
    const text = readString(item);
    if (!text) {
      throw new PluginError({
        code: 'PLUGIN_CONNECTOR_POLICY_INVALID',
        message: `${label} values must be non-empty strings.`,
        statusCode: 400,
        details: { index },
      });
    }
    return text;
  });
}

function readInteger(value: unknown, label: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_POLICY_INVALID',
      message: `${label} must be an integer between ${min} and ${max}.`,
      statusCode: 400,
    });
  }
  return value as number;
}

function readIntegerArray(value: unknown, label: string, max = 20): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_POLICY_INVALID',
      message: `${label} must be an array of integers.`,
      statusCode: 400,
    });
  }
  if (value.length > max) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_POLICY_INVALID',
      message: `${label} may include at most ${max} values.`,
      statusCode: 400,
    });
  }
  return value.map((item, index) => {
    if (!Number.isInteger(item)) {
      throw new PluginError({
        code: 'PLUGIN_CONNECTOR_POLICY_INVALID',
        message: `${label} values must be integers.`,
        statusCode: 400,
        details: { index },
      });
    }
    return item as number;
  });
}

function normalizeAuthProfile(
  inputAuth: PluginConnectorAuthProfile | undefined,
  authType: string | undefined,
  secretName: string | undefined
): PluginConnectorAuthProfile {
  const raw: Record<string, unknown> = (inputAuth as unknown as Record<string, unknown>) ?? {
    type: authType ?? 'none',
    ...(secretName ? { secretName } : {}),
  };

  if (!isRecord(raw)) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_AUTH_INVALID',
      message: 'Connector auth must be an object profile.',
      statusCode: 400,
    });
  }

  const type = readString(raw.type) ?? 'none';
  if (type === 'none') {
    return { type: 'none' };
  }

  const profileSecretName = readString(raw.secretName);
  if (!profileSecretName) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_AUTH_INVALID',
      message: `Connector auth profile "${type}" requires secretName.`,
      statusCode: 400,
    });
  }

  if (type === 'bearer' || type === 'basic') {
    return { type, secretName: profileSecretName };
  }

  if (type === 'apiKey') {
    const headerName = readString(raw.headerName);
    return { type, secretName: profileSecretName, ...(headerName ? { headerName } : {}) };
  }

  if (type === 'oauth2') {
    const scopes = readStringArray(raw.scopes, 'Connector OAuth scopes', 50);
    return {
      type,
      secretName: profileSecretName,
      authorizeUrl: readString(raw.authorizeUrl),
      tokenUrl: readString(raw.tokenUrl),
      ...(scopes ? { scopes } : {}),
    };
  }

  if (type === 'custom') {
    const headerName = readString(raw.headerName);
    if (!headerName) {
      throw new PluginError({
        code: 'PLUGIN_CONNECTOR_AUTH_INVALID',
        message: 'Connector custom auth requires headerName.',
        statusCode: 400,
      });
    }
    return { type, secretName: profileSecretName, headerName };
  }

  throw new PluginError({
    code: 'PLUGIN_CONNECTOR_AUTH_INVALID',
    message: `Connector auth type "${type}" is not supported.`,
    statusCode: 400,
  });
}

function normalizeConnectorEgress(input: PluginConnectorEgressPolicy | undefined) {
  const policy = input ?? {};
  if (!isRecord(policy)) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_POLICY_INVALID',
      message: 'Connector egress policy must be an object.',
      statusCode: 400,
    });
  }
  const allowedHosts = readStringArray(policy.allowedHosts, 'Connector allowedHosts')?.map((host) =>
    host.toLowerCase()
  );
  const allowedMethods = readStringArray(policy.allowedMethods, 'Connector allowedMethods')?.map(
    (method) => method.toUpperCase()
  );
  const maxBodyBytes = readInteger(
    policy.maxBodyBytes,
    'Connector maxBodyBytes',
    0,
    100 * 1024 * 1024
  );
  const maxResponseBytes = readInteger(
    policy.maxResponseBytes,
    'Connector maxResponseBytes',
    0,
    100 * 1024 * 1024
  );

  return {
    ...(allowedHosts ? { allowedHosts } : {}),
    ...(allowedMethods ? { allowedMethods } : {}),
    ...(maxBodyBytes !== undefined ? { maxBodyBytes } : {}),
    ...(maxResponseBytes !== undefined ? { maxResponseBytes } : {}),
  } satisfies PluginConnectorEgressPolicy;
}

function normalizeConnectorRetry(
  input: PluginConnectorRetryPolicy | undefined,
  legacyRetryCount?: number
): Required<Pick<PluginConnectorRetryPolicy, 'count' | 'backoffMs' | 'retryableStatusCodes'>> {
  const policy = input ?? {};
  if (!isRecord(policy)) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_POLICY_INVALID',
      message: 'Connector retry policy must be an object.',
      statusCode: 400,
    });
  }
  const count =
    readInteger(policy.count, 'Connector retry.count', 0, 5) ??
    normalizeRetryCount(legacyRetryCount);
  const backoffMs =
    readInteger(policy.backoffMs, 'Connector retry.backoffMs', 0, 60000) ??
    DEFAULT_RETRY_BACKOFF_MS;
  const retryableStatusCodes = (
    readIntegerArray(policy.retryableStatusCodes, 'Connector retry.retryableStatusCodes') ??
    DEFAULT_RETRYABLE_STATUS_CODES
  ).filter((status) => status >= 400 && status <= 599);

  return { count, backoffMs, retryableStatusCodes };
}

function normalizeConnectorRedaction(
  input: PluginConnectorRedactionPolicy | undefined
): PluginConnectorRedactionPolicy {
  const policy = input ?? {};
  if (!isRecord(policy)) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_POLICY_INVALID',
      message: 'Connector redaction policy must be an object.',
      statusCode: 400,
    });
  }
  return {
    requestHeaders: readStringArray(policy.requestHeaders, 'Connector redaction.requestHeaders'),
    responseHeaders: readStringArray(policy.responseHeaders, 'Connector redaction.responseHeaders'),
    bodyFields: readStringArray(policy.bodyFields, 'Connector redaction.bodyFields'),
  };
}

function legacyAuthType(auth: PluginConnectorAuthProfile): string {
  return auth.type;
}

function legacySecretName(auth: PluginConnectorAuthProfile): string | undefined {
  return auth.type === 'none' ? undefined : auth.secretName;
}

function toRecord(row: PluginConnector): PluginConnectorRecord {
  const auth = connectorAuthProfile(row);
  return {
    name: row.name,
    type: row.type,
    baseUrl: row.baseUrl,
    status: row.status === 'disabled' ? 'disabled' : 'active',
    auth,
    egress: connectorEgressPolicy(row),
    retry: connectorRetryPolicy(row),
    redaction: connectorRedactionPolicy(row),
    authType: row.authType,
    secretName: row.secretName ?? undefined,
    timeoutMs: row.timeoutMs,
    retryCount: row.retryCount,
    scope:
      row.scopeType && row.scopeId
        ? denormalizeResourceScope({
            type: row.scopeType as 'user' | 'workspace',
            id: row.scopeId,
          })
        : undefined,
    metadata: row.metadata,
  };
}

function connectorAuthProfile(row: PluginConnector): PluginConnectorAuthProfile {
  return isRecord(row.auth) && readString(row.auth.type)
    ? (row.auth as unknown as PluginConnectorAuthProfile)
    : normalizeAuthProfile(undefined, row.authType, row.secretName ?? undefined);
}

function connectorEgressPolicy(row: PluginConnector): PluginConnectorEgressPolicy {
  return isRecord(row.egress) ? (row.egress as PluginConnectorEgressPolicy) : {};
}

function connectorRetryPolicy(
  row: PluginConnector
): Required<Pick<PluginConnectorRetryPolicy, 'count' | 'backoffMs' | 'retryableStatusCodes'>> {
  return normalizeConnectorRetry(
    isRecord(row.retry) ? (row.retry as PluginConnectorRetryPolicy) : undefined,
    row.retryCount
  );
}

function connectorRedactionPolicy(row: PluginConnector): PluginConnectorRedactionPolicy {
  return isRecord(row.redaction) ? (row.redaction as PluginConnectorRedactionPolicy) : {};
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${base}${suffix}`);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_URL_INVALID',
      message: 'Connector calls only support http(s) URLs.',
      statusCode: 400,
    });
  }
  return url.toString();
}

function responseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

function maybeJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function redactValue(value: unknown, redactedKeys: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, redactedKeys));
  }
  if (!isRecord(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (DEFAULT_REDACTED_FIELD_PATTERN.test(key) || redactedKeys.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redactValue(item, redactedKeys);
    }
  }
  return result;
}

function sanitize(
  value: Record<string, unknown> | undefined,
  redactedKeys: readonly string[] = []
): Record<string, unknown> {
  if (!value) return {};
  return redactValue(value, new Set(redactedKeys.map((key) => key.toLowerCase()))) as Record<
    string,
    unknown
  >;
}

function requestJsonForLog(json: unknown): unknown {
  if (!isRecord(json)) {
    return json;
  }

  const { files: _files, ...rest } = json;
  return rest;
}

function byteLength(value: string | undefined): number {
  return value === undefined ? 0 : new TextEncoder().encode(value).byteLength;
}

async function assertEgressAllowed(
  scope: PluginCapabilityScope,
  connectorName: string,
  url: string,
  method: string,
  policy: PluginConnectorEgressPolicy,
  body: string | undefined
): Promise<void> {
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();
  const allowedHosts = policy.allowedHosts?.map((host) => host.toLowerCase());
  if (allowedHosts?.length && !allowedHosts.includes(hostname)) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_EGRESS_FORBIDDEN',
      message: `Connector "${connectorName}" is not allowed to call host "${hostname}".`,
      statusCode: 403,
      details: { connector: connectorName, host: hostname, allowedHosts },
    });
  }

  const allowedMethods = policy.allowedMethods?.map((item) => item.toUpperCase());
  if (allowedMethods?.length && !allowedMethods.includes(method)) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_METHOD_FORBIDDEN',
      message: `Connector "${connectorName}" is not allowed to use method "${method}".`,
      statusCode: 403,
      details: { connector: connectorName, method, allowedMethods },
    });
  }

  const bodyBytes = byteLength(body);
  if (policy.maxBodyBytes !== undefined && bodyBytes > policy.maxBodyBytes) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_BODY_TOO_LARGE',
      message: `Connector "${connectorName}" request body exceeds maxBodyBytes.`,
      statusCode: 413,
      details: { connector: connectorName, maxBodyBytes: policy.maxBodyBytes, bodyBytes },
    });
  }

  await assertSafeEgressTarget({
    pluginId: scope.contract.id,
    url: parsed,
    code: 'PLUGIN_CONNECTOR_SSRF_FORBIDDEN',
    messagePrefix: `Connector "${connectorName}" cannot call private or metadata host`,
    fix: 'Point the connector at a public service boundary and keep private-network work outside plugin runtime egress.',
    details: { connector: connectorName },
  });
}

async function waitForRetry(backoffMs: number, attempt: number): Promise<void> {
  if (backoffMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
}

async function applyConnectorAuth(
  headers: Record<string, string>,
  auth: PluginConnectorAuthProfile,
  secretHost: PluginConnectorSecretHost
): Promise<Record<string, string>> {
  if (auth.type === 'none') {
    return headers;
  }

  const secret = await secretHost.get(auth.secretName);
  if (!secret) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_SECRET_NOT_FOUND',
      message: `Connector auth secret "${auth.secretName}" was not found.`,
      statusCode: 400,
      details: { secretName: auth.secretName },
    });
  }

  if (auth.type === 'bearer' || auth.type === 'oauth2') {
    return { ...headers, authorization: `Bearer ${secret}` };
  }
  if (auth.type === 'basic') {
    return { ...headers, authorization: `Basic ${secret}` };
  }
  if (auth.type === 'apiKey') {
    return { ...headers, [auth.headerName ?? 'x-api-key']: secret };
  }
  if (auth.type === 'custom') {
    return { ...headers, [auth.headerName]: secret };
  }

  return headers;
}

async function fetchWithRetry(
  httpHost: PluginConnectorHttpHost,
  url: string,
  init: RequestInit,
  retry: Required<Pick<PluginConnectorRetryPolicy, 'count' | 'backoffMs' | 'retryableStatusCodes'>>
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retry.count; attempt += 1) {
    if (attempt > 0) {
      await waitForRetry(retry.backoffMs, attempt);
    }
    try {
      const response = await httpHost.fetch(url, init);
      if (attempt < retry.count && retry.retryableStatusCodes.includes(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= retry.count) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function readBoundedResponseText(
  response: Response,
  maxResponseBytes: number | undefined
): Promise<string> {
  const text = await response.text();
  const bytes = byteLength(text);
  if (maxResponseBytes !== undefined && bytes > maxResponseBytes) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_RESPONSE_TOO_LARGE',
      message: 'Connector response exceeds maxResponseBytes.',
      statusCode: 502,
      details: { maxResponseBytes, responseBytes: bytes },
    });
  }
  return text;
}

function normalizeConnectorFileReferences(
  files: PluginConnectorFileReference[] | undefined
): PluginConnectorFileReference[] {
  if (!files?.length) {
    return [];
  }

  if (files.length > MAX_CONNECTOR_FILE_REFERENCES) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_FILE_LIMIT_EXCEEDED',
      message: `Connector calls may reference at most ${MAX_CONNECTOR_FILE_REFERENCES} files.`,
      statusCode: 400,
      details: {
        maxFiles: MAX_CONNECTOR_FILE_REFERENCES,
        requestedFiles: files.length,
      },
    });
  }

  return files.map((file, index) => {
    const fileId = file.fileId?.trim();
    if (!fileId) {
      throw new PluginError({
        code: 'PLUGIN_CONNECTOR_FILE_INVALID',
        message: 'Connector file references must include a non-empty fileId.',
        statusCode: 400,
        details: { index },
      });
    }

    const name = file.name?.trim() || undefined;
    if (name && name.length > 100) {
      throw new PluginError({
        code: 'PLUGIN_CONNECTOR_FILE_INVALID',
        message: 'Connector file reference names must be at most 100 characters.',
        statusCode: 400,
        details: { index, fileId },
      });
    }

    return {
      fileId,
      name,
      expiresInSeconds: file.expiresInSeconds,
    };
  });
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeConnectorFilesIntoJson(
  json: unknown,
  files: PluginConnectorResolvedFile[]
): Record<string, unknown> {
  if (json === undefined) {
    return { files };
  }

  if (!isJsonObject(json)) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_FILE_JSON_UNSUPPORTED',
      message: 'Connector file references can only be injected into an object JSON payload.',
      statusCode: 400,
    });
  }

  const existingFiles = json.files;
  if (existingFiles !== undefined && !Array.isArray(existingFiles)) {
    throw new PluginError({
      code: 'PLUGIN_CONNECTOR_FILE_JSON_UNSUPPORTED',
      message: 'Connector JSON payload "files" must be an array when file references are used.',
      statusCode: 400,
    });
  }

  const payloadFiles = Array.isArray(existingFiles) ? existingFiles : [];
  return {
    ...json,
    files: [...payloadFiles, ...files],
  };
}

const defaultFilesHost: PluginConnectorFilesHost = {
  async resolve(input) {
    const files = createPluginFilesCapability(input.scope);
    return Promise.all(
      input.files.map(async (reference) => {
        const record = await files.get(reference.fileId);
        if (!record) {
          throw new PluginError({
            code: 'PLUGIN_CONNECTOR_FILE_NOT_FOUND',
            message: `Connector file "${reference.fileId}" was not found.`,
            statusCode: 404,
            details: {
              fileId: reference.fileId,
              pluginId: input.connectorScope.pluginId,
            },
          });
        }

        const downloadUrl = await files.createSignedDownloadUrl(reference.fileId, {
          expiresInSeconds: reference.expiresInSeconds ?? 600,
        });

        return {
          id: record.id,
          name: reference.name ?? record.fileName,
          scope: record.scope,
          fileName: record.fileName,
          contentType: record.contentType,
          size: record.size,
          hash: record.hash,
          purpose: record.purpose,
          runId: record.runId,
          downloadUrl,
        } satisfies PluginConnectorResolvedFile;
      })
    );
  },
};

export class DbPluginConnectorsRepository implements PluginConnectorsRepository {
  constructor(private readonly executor: Executor = db) {}

  private async inSystem<T>(fn: (executor: Executor) => Promise<T>): Promise<T> {
    if (this.executor !== db) return fn(this.executor);
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', 'system', true)`);
      return fn(tx);
    });
  }

  async get(
    scope: PluginConnectorsScope,
    name: string,
    resourceScope?: NormalizedPluginResourceScope
  ) {
    return this.inSystem(async (executor) => {
      const conditions: SQL[] = [
        eq(pluginConnectors.pluginId, scope.pluginId),
        eq(pluginConnectors.name, name),
      ];
      if (resourceScope) {
        conditions.push(eq(pluginConnectors.scopeType, resourceScope.type));
        conditions.push(eq(pluginConnectors.scopeId, resourceScope.id));
      }
      const [row] = await executor
        .select()
        .from(pluginConnectors)
        .where(and(...conditions))
        .limit(1);
      return row ?? null;
    });
  }

  async list(
    scope: PluginConnectorsScope,
    input: { resourceScope?: NormalizedPluginResourceScope; includeDisabled: boolean }
  ) {
    return this.inSystem(async (executor) => {
      const conditions: SQL[] = [eq(pluginConnectors.pluginId, scope.pluginId)];
      if (!input.includeDisabled) {
        conditions.push(eq(pluginConnectors.status, 'active'));
      }
      if (input.resourceScope) {
        conditions.push(eq(pluginConnectors.scopeType, input.resourceScope.type));
        conditions.push(eq(pluginConnectors.scopeId, input.resourceScope.id));
      }
      return executor
        .select()
        .from(pluginConnectors)
        .where(and(...conditions))
        .orderBy(asc(pluginConnectors.name));
    });
  }

  async upsert(
    scope: PluginConnectorsScope,
    input: {
      name: string;
      type: string;
      baseUrl: string;
      resourceScope?: NormalizedPluginResourceScope;
      auth: PluginConnectorAuthProfile;
      authType: string;
      secretName?: string;
      egress: PluginConnectorEgressPolicy;
      retry: PluginConnectorRetryPolicy;
      redaction: PluginConnectorRedactionPolicy;
      timeoutMs: number;
      retryCount: number;
      metadata: Record<string, unknown>;
    }
  ) {
    const now = new Date();
    return this.inSystem(async (executor) => {
      const [row] = await executor
        .insert(pluginConnectors)
        .values({
          id: randomUUID(),
          pluginId: scope.pluginId,
          name: input.name,
          type: input.type,
          scopeType: input.resourceScope?.type,
          scopeId: input.resourceScope?.id,
          baseUrl: input.baseUrl,
          auth: input.auth as unknown as Record<string, unknown>,
          authType: input.authType,
          secretName: input.secretName,
          egress: input.egress as Record<string, unknown>,
          retry: input.retry as Record<string, unknown>,
          redaction: input.redaction as Record<string, unknown>,
          status: 'active',
          timeoutMs: input.timeoutMs,
          retryCount: input.retryCount,
          metadata: input.metadata,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            pluginConnectors.pluginId,
            pluginConnectors.name,
            pluginConnectors.scopeType,
            pluginConnectors.scopeId,
          ],
          set: {
            type: input.type,
            baseUrl: input.baseUrl,
            auth: input.auth as unknown as Record<string, unknown>,
            authType: input.authType,
            secretName: input.secretName,
            egress: input.egress as Record<string, unknown>,
            retry: input.retry as Record<string, unknown>,
            redaction: input.redaction as Record<string, unknown>,
            status: 'active',
            timeoutMs: input.timeoutMs,
            retryCount: input.retryCount,
            metadata: input.metadata,
            updatedAt: now,
          },
        })
        .returning();
      return row;
    });
  }

  async setStatus(
    scope: PluginConnectorsScope,
    name: string,
    status: 'active' | 'disabled',
    resourceScope?: NormalizedPluginResourceScope
  ) {
    return this.inSystem(async (executor) => {
      const conditions: SQL[] = [
        eq(pluginConnectors.pluginId, scope.pluginId),
        eq(pluginConnectors.name, name),
      ];
      if (resourceScope) {
        conditions.push(eq(pluginConnectors.scopeType, resourceScope.type));
        conditions.push(eq(pluginConnectors.scopeId, resourceScope.id));
      }
      const [row] = await executor
        .update(pluginConnectors)
        .set({ status, updatedAt: new Date() })
        .where(and(...conditions))
        .returning();
      if (!row) {
        throw new PluginError({
          code: 'PLUGIN_CONNECTOR_NOT_FOUND',
          message: `Connector "${name}" was not found.`,
          statusCode: 404,
        });
      }
      return row;
    });
  }

  async delete(
    scope: PluginConnectorsScope,
    name: string,
    resourceScope?: NormalizedPluginResourceScope
  ) {
    await this.inSystem(async (executor) => {
      const conditions: SQL[] = [
        eq(pluginConnectors.pluginId, scope.pluginId),
        eq(pluginConnectors.name, name),
      ];
      if (resourceScope) {
        conditions.push(eq(pluginConnectors.scopeType, resourceScope.type));
        conditions.push(eq(pluginConnectors.scopeId, resourceScope.id));
      }
      await executor.delete(pluginConnectors).where(and(...conditions));
    });
  }

  async recordCall(_scope: PluginConnectorsScope, input: NewPluginConnectorCallLog) {
    await this.inSystem(async (executor) => {
      await executor.insert(pluginConnectorCallLogs).values(input);
    });
  }
}

export function createPluginConnectorsCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginConnectorsOptions = {}
): PluginConnectors {
  const repository = options.repository ?? new DbPluginConnectorsRepository();
  const httpHost = options.httpHost ?? { fetch };
  const defaultSecretsRepository = options.secretHost ? null : new DbPluginSecretsRepository();
  const secretHost =
    options.secretHost ??
    ({
      get(name: string) {
        return defaultSecretsRepository!.get(
          {
            pluginId: scope.contract.id,
            userId: scope.system ? '' : (scope.user?.id ?? ''),
            system: scope.system,
          },
          name
        );
      },
    } satisfies PluginConnectorSecretHost);
  const filesHost = options.filesHost ?? defaultFilesHost;

  return {
    async get(name) {
      enforceCapabilityPermission(scope, Permission.ConnectorsRead, 'ctx.connectors.get');
      const connectorScope = resolveScope(scope, 'ctx.connectors.get');
      const resourceScope = scope.apiKey?.scope;
      if (resourceScope) {
        await assertResourceScopeAccess(scope, resourceScope, 'read', 'ctx.connectors.get');
      }
      const row = await repository.get(connectorScope, validateConnectorName(name), resourceScope);
      return row ? toRecord(row) : null;
    },

    async list(input = {}) {
      enforceCapabilityPermission(scope, Permission.ConnectorsRead, 'ctx.connectors.list');
      const connectorScope = resolveScope(scope, 'ctx.connectors.list');
      const resourceScope = input.scope
        ? normalizeResourceScope(scope, input.scope, 'ctx.connectors.list')
        : scope.apiKey?.scope;
      if (resourceScope) {
        await assertResourceScopeAccess(scope, resourceScope, 'read', 'ctx.connectors.list');
      }
      const rows = await repository.list(connectorScope, {
        resourceScope,
        includeDisabled: Boolean(input.includeDisabled),
      });
      return rows.map(toRecord);
    },

    async upsert(input) {
      enforceCapabilityPermission(scope, Permission.ConnectorsManage, 'ctx.connectors.upsert');
      const connectorScope = resolveScope(scope, 'ctx.connectors.upsert');
      const metadata = input.metadata ?? {};
      assertJsonSerializable(metadata, 'Connector metadata');
      const auth = normalizeAuthProfile(input.auth, input.authType, input.secretName);
      const egress = normalizeConnectorEgress(input.egress);
      const retry = normalizeConnectorRetry(input.retry, input.retryCount);
      const redaction = normalizeConnectorRedaction(input.redaction);
      const resourceScope = input.scope
        ? normalizeResourceScope(scope, input.scope, 'ctx.connectors.upsert')
        : scope.apiKey?.scope;
      if (resourceScope) {
        await assertResourceScopeAccess(scope, resourceScope, 'manage', 'ctx.connectors.upsert');
      }
      const row = await repository.upsert(connectorScope, {
        name: validateConnectorName(input.name),
        type: validateConnectorType(input.type),
        baseUrl: validateBaseUrl(input.baseUrl),
        resourceScope,
        auth,
        authType: legacyAuthType(auth),
        secretName: legacySecretName(auth),
        egress,
        retry,
        redaction,
        timeoutMs: normalizeTimeoutMs(input.timeoutMs),
        retryCount: retry.count,
        metadata,
      });
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.connectors.upsert`,
        {
          connector: row.name,
          scope: row.scopeType ? { type: row.scopeType, id: row.scopeId } : undefined,
        },
        options.auditPort
      );
      return toRecord(row);
    },

    async setStatus(name, status, input = {}) {
      enforceCapabilityPermission(scope, Permission.ConnectorsManage, 'ctx.connectors.setStatus');
      const connectorScope = resolveScope(scope, 'ctx.connectors.setStatus');
      const connectorName = validateConnectorName(name);
      const requestedScope = input.scope
        ? normalizeResourceScope(scope, input.scope, 'ctx.connectors.setStatus')
        : scope.apiKey?.scope;
      const existing = await repository.get(connectorScope, connectorName, requestedScope);
      const resourceScope =
        requestedScope ??
        (existing?.scopeType && existing.scopeId
          ? ({
              type: existing.scopeType as 'user' | 'workspace',
              id: existing.scopeId,
            } satisfies NormalizedPluginResourceScope)
          : undefined);
      if (resourceScope) {
        await assertResourceScopeAccess(scope, resourceScope, 'manage', 'ctx.connectors.setStatus');
      }
      if (status !== 'active' && status !== 'disabled') {
        throw new PluginError({
          code: 'PLUGIN_CONNECTOR_STATUS_INVALID',
          message: 'Connector status must be "active" or "disabled".',
          statusCode: 400,
        });
      }
      const row = await repository.setStatus(connectorScope, connectorName, status, resourceScope);
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.connectors.setStatus`,
        { connector: connectorName, status },
        options.auditPort
      );
      return toRecord(row);
    },

    async delete(name, input = {}) {
      enforceCapabilityPermission(scope, Permission.ConnectorsManage, 'ctx.connectors.delete');
      const connectorScope = resolveScope(scope, 'ctx.connectors.delete');
      const connectorName = validateConnectorName(name);
      const requestedScope = input.scope
        ? normalizeResourceScope(scope, input.scope, 'ctx.connectors.delete')
        : scope.apiKey?.scope;
      const existing = await repository.get(connectorScope, connectorName, requestedScope);
      const resourceScope =
        requestedScope ??
        (existing?.scopeType && existing.scopeId
          ? ({
              type: existing.scopeType as 'user' | 'workspace',
              id: existing.scopeId,
            } satisfies NormalizedPluginResourceScope)
          : undefined);
      if (resourceScope) {
        await assertResourceScopeAccess(scope, resourceScope, 'manage', 'ctx.connectors.delete');
      }
      await repository.delete(connectorScope, connectorName, resourceScope);
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.connectors.delete`,
        { connector: connectorName },
        options.auditPort
      );
    },

    async call(name, request) {
      enforceCapabilityPermission(scope, Permission.ConnectorsInvoke, 'ctx.connectors.call');
      const connectorScope = resolveScope(scope, 'ctx.connectors.call');
      const connectorName = validateConnectorName(name);
      let resourceScope = request.scope
        ? normalizeResourceScope(scope, request.scope, 'ctx.connectors.call')
        : scope.apiKey?.scope;
      if (resourceScope) {
        await assertResourceScopeAccess(scope, resourceScope, 'read', 'ctx.connectors.call');
      }
      const connector = await repository.get(connectorScope, connectorName, resourceScope);
      if (!connector || connector.status !== 'active') {
        throw new PluginError({
          code: 'PLUGIN_CONNECTOR_UNAVAILABLE',
          message: `Connector "${connectorName}" is not available.`,
          statusCode: 404,
        });
      }
      resourceScope =
        resourceScope ??
        (connector.scopeType && connector.scopeId
          ? ({
              type: connector.scopeType as 'user' | 'workspace',
              id: connector.scopeId,
            } satisfies NormalizedPluginResourceScope)
          : undefined);
      if (resourceScope) {
        await assertResourceScopeAccess(scope, resourceScope, 'read', 'ctx.connectors.call');
      }

      const metadata = request.metadata ?? {};
      assertJsonSerializable(metadata, 'Connector call metadata');
      const fileReferences = normalizeConnectorFileReferences(request.files);
      if (fileReferences.length > 0) {
        enforceCapabilityPermission(scope, Permission.FilesRead, 'ctx.connectors.call(files)');
      }

      const method = (request.method ?? 'POST').toUpperCase();
      const url = joinUrl(connector.baseUrl, request.path);
      const auth = connectorAuthProfile(connector);
      const egress = connectorEgressPolicy(connector);
      const retry = connectorRetryPolicy(connector);
      const redaction = connectorRedactionPolicy(connector);
      const redactedRequestKeys = [
        ...(redaction.requestHeaders ?? []),
        ...(redaction.bodyFields ?? []),
      ];
      const redactedResponseKeys = [
        ...(redaction.responseHeaders ?? []),
        ...(redaction.bodyFields ?? []),
      ];
      let headers = { ...(request.headers ?? {}) };
      let body = request.body;
      let json = request.json;
      let resolvedFiles: PluginConnectorResolvedFile[] = [];
      if (fileReferences.length > 0) {
        if (request.body !== undefined && request.json === undefined) {
          throw new PluginError({
            code: 'PLUGIN_CONNECTOR_FILE_BODY_UNSUPPORTED',
            message: 'Connector file references require a JSON payload, not a raw body.',
            statusCode: 400,
          });
        }

        resolvedFiles = await filesHost.resolve({
          scope,
          connectorScope,
          files: fileReferences,
        });
        json = mergeConnectorFilesIntoJson(json, resolvedFiles);
      }

      if (json !== undefined) {
        headers['content-type'] = headers['content-type'] ?? 'application/json';
        body = JSON.stringify(json);
      }
      await assertEgressAllowed(scope, connectorName, url, method, egress, body);
      headers = await applyConnectorAuth(headers, auth, secretHost);

      const started = Date.now();
      let response: Response | null = null;
      let text = '';
      let error: unknown;

      try {
        response = await fetchWithRetry(
          httpHost,
          url,
          {
            method,
            headers,
            body,
            signal: AbortSignal.timeout(connector.timeoutMs),
          },
          retry
        );
        text = await readBoundedResponseText(response, egress.maxResponseBytes);
      } catch (caught) {
        error = caught;
      }

      const durationMs = Date.now() - started;
      const callId = randomUUID();
      await repository.recordCall(connectorScope, {
        id: callId,
        pluginId: scope.contract.id,
        connectorName,
        userId: connectorScope.userId,
        runId: request.runId,
        method,
        url,
        status: response?.status,
        ok: response?.ok ? 'true' : 'false',
        durationMs,
        meter: request.meter,
        creditsConsumed: request.creditAmount ?? 0,
        requestMetadata: sanitize(
          {
            apiKeyId: currentApiKeyId(scope),
            path: request.path,
            headers,
            egress: {
              host: new URL(url).hostname,
              method,
            },
            retry: {
              count: retry.count,
              retryableStatusCodes: retry.retryableStatusCodes,
            },
            fileIds: fileReferences.map((file) => file.fileId),
            metadata,
            json: requestJsonForLog(json),
          },
          redactedRequestKeys
        ),
        responseMetadata: sanitize(
          {
            headers: response ? responseHeaders(response) : undefined,
          },
          redactedResponseKeys
        ),
        error: error instanceof Error ? { message: error.message, name: error.name } : undefined,
      });

      if (request.meter) {
        await options.usageLedger?.record({
          id: randomUUID(),
          idempotencyKey: request.idempotencyKey ?? `${scope.requestId}:connector:${callId}:usage`,
          userId: connectorScope.userId,
          category: 'api_quota' satisfies UsageCategory,
          amount: 1,
          unit: 'call',
          metadata: {
            pluginId: scope.contract.id,
            meter: request.meter,
            connector: connectorName,
            runId: request.runId,
            apiKeyId: currentApiKeyId(scope),
          },
          timestamp: new Date(),
        });
      }

      if (request.creditAmount && options.creditsHost?.consume) {
        await options.creditsHost.consume(
          {
            pluginId: scope.contract.id,
            userId: connectorScope.userId,
            requestId: scope.requestId,
            productId: getCurrentRuntimeProductId(),
            system: Boolean(scope.system),
          },
          {
            meter: request.meter ?? `${scope.contract.id}.connector.${connectorName}`,
            metric: getDefaultCreditMetric(),
            accountScope: { type: 'user', id: connectorScope.userId },
            amount: request.creditAmount,
            userId: connectorScope.userId,
            idempotencyKey: request.idempotencyKey ?? `${scope.requestId}:connector:${callId}`,
            metadata: {
              connector: connectorName,
              runId: request.runId,
              apiKeyId: currentApiKeyId(scope),
            },
          }
        );
      }

      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.connectors.call`,
        {
          connector: connectorName,
          runId: request.runId,
          fileIds: fileReferences.map((file) => file.fileId),
          status: response?.status,
          ok: Boolean(response?.ok),
        },
        options.auditPort
      );

      if (error) {
        if (error instanceof PluginError) {
          throw error;
        }
        throw new PluginError({
          code: 'PLUGIN_CONNECTOR_CALL_FAILED',
          message: error instanceof Error ? error.message : 'Connector call failed.',
          statusCode: 502,
        });
      }

      return {
        status: response?.status ?? 0,
        ok: Boolean(response?.ok),
        headers: response ? responseHeaders(response) : {},
        text,
        json: maybeJson(text),
        callId,
      } satisfies PluginConnectorCallResult;
    },

    async createSignedCallback(input) {
      enforceCapabilityPermission(
        scope,
        Permission.ConnectorsInvoke,
        'ctx.connectors.createSignedCallback'
      );
      validateConnectorName(input.connector);
      const resourceScope = input.scope
        ? normalizeResourceScope(scope, input.scope, 'ctx.connectors.createSignedCallback')
        : scope.apiKey?.scope;
      if (resourceScope) {
        await assertResourceScopeAccess(
          scope,
          resourceScope,
          'read',
          'ctx.connectors.createSignedCallback'
        );
      }
      const expiresAt = new Date(Date.now() + (input.expiresInSeconds ?? 3600) * 1000);
      const nonce = randomBytes(16).toString('base64url');
      const payload = `${scope.contract.id}:${input.connector}:${input.runId ?? ''}:${expiresAt.toISOString()}:${nonce}`;
      const secret =
        options.callbackSecret ?? env.PLUGIN_CONNECTOR_CALLBACK_SECRET ?? 'dev-callback-secret';
      const token = createHmac('sha256', secret).update(payload).digest('base64url');
      const baseUrl = options.callbackBaseUrl ?? '/api/plugins';
      return {
        url: `${baseUrl}/${scope.contract.id}/connectors/${input.connector}/callback?runId=${encodeURIComponent(input.runId ?? '')}&expires=${encodeURIComponent(expiresAt.toISOString())}&nonce=${encodeURIComponent(nonce)}&signature=${encodeURIComponent(token)}`,
        token,
        expiresAt,
      } satisfies PluginConnectorSignedCallback;
    },
  };
}
