import type { z } from 'zod';
import type { PluginStorage } from './storage';
import type { PluginResourceBindingCardinality } from './types';

export interface PluginUser {
  id: string;
  role: 'admin' | 'user';
  email?: string;
}

export type PluginResourceScope =
  | {
      type: 'user';
      id?: string;
    }
  | {
      type: 'workspace';
      id: string;
    };

export interface PluginWorkspace {
  id: string;
  name: string;
  slug?: string;
  ownerUserId: string;
  status: 'active' | 'disabled';
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type PluginWorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface PluginWorkspaceMember {
  workspaceId: string;
  userId: string;
  role: PluginWorkspaceRole;
  status: 'active' | 'invited' | 'disabled';
  email?: string;
  joinedAt?: Date;
}

export interface PluginWorkspaceCreateInput {
  name: string;
  slug?: string;
  metadata?: Record<string, unknown>;
}

export interface PluginWorkspaceInviteInput {
  workspaceId: string;
  email: string;
  role: Exclude<PluginWorkspaceRole, 'owner'>;
}

export interface PluginWorkspaceInvitation {
  id: string;
  workspaceId: string;
  email: string;
  role: Exclude<PluginWorkspaceRole, 'owner'>;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt?: Date;
  createdAt: Date;
}

export interface PluginWorkspaceApi {
  current(): Promise<PluginWorkspace | null>;
  list(): Promise<PluginWorkspace[]>;
  create(input: PluginWorkspaceCreateInput): Promise<PluginWorkspace>;
  members(workspaceId?: string): Promise<PluginWorkspaceMember[]>;
  hasRole(
    roles: PluginWorkspaceRole | PluginWorkspaceRole[],
    workspaceId?: string
  ): Promise<boolean>;
  invite(input: PluginWorkspaceInviteInput): Promise<PluginWorkspaceInvitation>;
}

export interface PluginRequest {
  method: string;
  url: string;
  headers: Headers;
  params: Record<string, string>;
  query: URLSearchParams;
  json<TSchema extends z.ZodTypeAny>(schema: TSchema): Promise<z.infer<TSchema>>;
  text(): Promise<string>;
  formData(): Promise<FormData>;
}

export interface PluginResponseFactory {
  json(data: unknown, init?: ResponseInit): Response;
  redirect(url: string, status?: number): Response;
  stream(body: ReadableStream, init?: ResponseInit): Response;
}

export interface PluginUi {
  toast: {
    success(message: string): Promise<void>;
    error(message: string): Promise<void>;
    info(message: string): Promise<void>;
  };
}

export interface PluginEvents {
  emit(event: string, payload?: Record<string, unknown>): Promise<void>;
  on?(
    event: string,
    handler: (
      payload: unknown,
      context: {
        event: string;
        emitterId: string;
        timestamp: Date;
        eventId: string;
        correlationId: string;
        causationId?: string;
        idempotencyKey?: string;
      }
    ) => void | Promise<void>
  ): void;
  off?(event: string): void;
}

export interface PluginJobs {
  enqueue(name: string, payload?: Record<string, unknown>): Promise<{ id: string }>;
  register?(
    name: string,
    handler: (payload?: Record<string, unknown>) => void | Promise<void>,
    options?: { schedule?: string; timeoutMs?: number; retries?: number }
  ): void;
}

export type PluginFilePurpose = 'source' | 'result' | 'temp';
export type PluginFileStatus = 'pending_upload' | 'ready' | 'archived' | 'deleted';

export interface PluginFileRecord {
  id: string;
  scope: PluginResourceScope;
  fileName: string;
  contentType: string;
  size: number;
  hash?: string;
  purpose: PluginFilePurpose;
  status: PluginFileStatus;
  runId?: string;
  metadata: Record<string, unknown>;
  expiresAt?: Date;
  uploadedAt?: Date;
  archivedAt?: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PluginRunFiles {
  inputs: PluginFileRecord[];
  outputs: PluginFileRecord[];
  temp: PluginFileRecord[];
}

export interface PluginFileCreateUploadInput {
  scope: PluginResourceScope;
  fileName: string;
  contentType: string;
  size: number;
  purpose: PluginFilePurpose;
  body?: Buffer | Uint8Array | ReadableStream;
  runId?: string;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface PluginFileCreateUploadResult {
  id: string;
  scope: PluginResourceScope;
  fileName: string;
  contentType: string;
  size: number;
  purpose: PluginFilePurpose;
  status: PluginFileStatus;
  storageRef: string;
  uploadUrl?: string;
  metadata: Record<string, unknown>;
  expiresAt?: Date;
  createdAt: Date;
}

export interface PluginFileCompleteUploadInput {
  fileId: string;
  storageRef?: string;
  size: number;
  hash?: string;
  contentType?: string;
  metadata?: Record<string, unknown>;
}

export interface PluginFileListInput {
  scope: PluginResourceScope;
  purpose?: PluginFilePurpose;
  status?: PluginFileStatus;
  runId?: string;
  limit?: number;
  offset?: number;
}

export interface PluginFileSignedUrlOptions {
  expiresInSeconds?: number;
}

export interface PluginFiles {
  createUpload(input: PluginFileCreateUploadInput): Promise<PluginFileCreateUploadResult>;
  completeUpload(input: PluginFileCompleteUploadInput): Promise<PluginFileRecord>;
  read(id: string): Promise<{ record: PluginFileRecord; body: ReadableStream | Buffer }>;
  get(id: string): Promise<PluginFileRecord | null>;
  list(input: PluginFileListInput): Promise<PluginFileRecord[]>;
  createSignedUploadUrl(id: string, options?: PluginFileSignedUrlOptions): Promise<string>;
  createSignedDownloadUrl(id: string, options?: PluginFileSignedUrlOptions): Promise<string>;
  archive(id: string): Promise<PluginFileRecord>;
  delete(id: string): Promise<void>;
}

export type PluginArtifactContentType =
  | 'text/markdown'
  | 'text/plain'
  | 'application/json'
  | string;

export interface PluginArtifactMetadata {
  [key: string]: unknown;
}

export interface PluginArtifactRecord {
  id: string;
  scope: PluginResourceScope;
  path: string;
  contentType: PluginArtifactContentType;
  content: string;
  metadata: PluginArtifactMetadata;
  version: number;
  size: number;
  hash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PluginArtifactSummary {
  id: string;
  scope: PluginResourceScope;
  path: string;
  contentType: PluginArtifactContentType;
  metadata: PluginArtifactMetadata;
  version: number;
  size: number;
  hash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PluginArtifactTreeEntry extends PluginArtifactSummary {
  name: string;
  parentPath: string;
}

export interface PluginArtifactWriteInput {
  scope: PluginResourceScope;
  path: string;
  content: string;
  contentType?: PluginArtifactContentType;
  metadata?: PluginArtifactMetadata;
}

export interface PluginArtifactListOptions {
  scope: PluginResourceScope;
  prefix?: string;
  limit?: number;
  offset?: number;
}

export interface PluginArtifactReadInput {
  scope: PluginResourceScope;
  path: string;
}

export interface PluginArtifactDeleteInput {
  scope: PluginResourceScope;
  path: string;
}

export interface PluginArtifactMetadataInput {
  scope: PluginResourceScope;
  path: string;
  metadata: PluginArtifactMetadata;
  merge?: boolean;
}

export interface PluginArtifacts {
  writeText(input: PluginArtifactWriteInput): Promise<PluginArtifactRecord>;
  readText(input: PluginArtifactReadInput): Promise<PluginArtifactRecord | null>;
  list(input: PluginArtifactListOptions): Promise<PluginArtifactSummary[]>;
  tree(input: PluginArtifactListOptions): Promise<PluginArtifactTreeEntry[]>;
  updateMetadata(input: PluginArtifactMetadataInput): Promise<PluginArtifactSummary>;
  delete(input: PluginArtifactDeleteInput): Promise<void>;
}

export interface PluginRagSourceInput {
  scope: PluginResourceScope;
  artifactId?: string;
  path?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface PluginRagIndexInput {
  scope: PluginResourceScope;
  artifactId?: string;
  path?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface PluginRagIndexResult {
  scope: PluginResourceScope;
  sourceId: string;
  sourcePath?: string;
  sourceHash: string;
  chunkCount: number;
  indexedAt: Date;
}

export interface PluginRagSearchInput {
  scope: PluginResourceScope;
  query: string;
  topK?: number;
  sourceIds?: string[];
  pathPrefix?: string;
  metadata?: Record<string, unknown>;
}

export interface PluginRagSearchResult {
  id: string;
  scope: PluginResourceScope;
  sourceId: string;
  sourcePath?: string;
  chunkIndex: number;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface PluginRagContextPackInput extends PluginRagSearchInput {
  maxCharacters?: number;
  separator?: string;
}

export interface PluginRagContextPack {
  scope: PluginResourceScope;
  query: string;
  content: string;
  sources: PluginRagSearchResult[];
  characterCount: number;
}

export interface PluginRagDeleteInput {
  scope: PluginResourceScope;
  sourceId?: string;
  path?: string;
}

export interface PluginRag {
  index(input: PluginRagIndexInput): Promise<PluginRagIndexResult>;
  search(input: PluginRagSearchInput): Promise<PluginRagSearchResult[]>;
  buildContextPack(input: PluginRagContextPackInput): Promise<PluginRagContextPack>;
  delete(input: PluginRagDeleteInput): Promise<void>;
}

export type PluginAiRole = 'system' | 'user' | 'assistant' | 'tool';

export interface PluginAiMessage {
  role: PluginAiRole;
  content: string;
  name?: string;
}

export interface PluginAiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  unit?: string;
  creditsConsumed?: number;
}

export interface PluginAiGenerateTextInput {
  prompt?: string;
  messages?: PluginAiMessage[];
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  meter?: string;
  creditAmount?: number;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface PluginAiGenerateTextResult {
  text: string;
  model: string;
  provider?: string;
  finishReason?: string;
  usage?: PluginAiUsage;
  metadata?: Record<string, unknown>;
}

export interface PluginAiStreamTextEvent {
  type: 'text-delta' | 'done' | 'error';
  text?: string;
  result?: PluginAiGenerateTextResult;
  error?: string;
}

export interface PluginAiEmbedTextInput {
  input: string | string[];
  model?: string;
  meter?: string;
  creditAmount?: number;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface PluginAiEmbedding {
  embedding: number[];
  index: number;
}

export interface PluginAiEmbedTextResult {
  embeddings: PluginAiEmbedding[];
  model: string;
  provider?: string;
  usage?: PluginAiUsage;
  metadata?: Record<string, unknown>;
}

export interface PluginAi {
  generateText(input: PluginAiGenerateTextInput): Promise<PluginAiGenerateTextResult>;
  streamText(input: PluginAiGenerateTextInput): AsyncIterable<PluginAiStreamTextEvent>;
  embedText(input: PluginAiEmbedTextInput): Promise<PluginAiEmbedTextResult>;
}

export interface PluginSecrets {
  get(name: string): Promise<string | null>;
  set?(name: string, value: string): Promise<void>;
  delete?(name: string): Promise<void>;
}

export interface PluginConfig {
  get<T = unknown>(key: string): Promise<T | null>;
  set?<T = unknown>(key: string, value: T): Promise<void>;
  delete?(key: string): Promise<void>;
}

export interface PluginAudit {
  record(action: string, details?: Record<string, unknown>): Promise<void>;
}

export interface PluginUsage {
  increment(
    metric: string,
    amount?: number,
    options?: { idempotencyKey?: string; unit?: string; metadata?: Record<string, unknown> }
  ): Promise<void>;
}

export interface PluginCreditBalance {
  balance: number;
  metric: string;
  userId: string;
  unlimited?: boolean;
  metadata?: Record<string, unknown>;
}

export interface PluginCreditConsumeInput {
  meter: string;
  amount?: number;
  userId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface PluginCreditConsumeResult {
  consumed: boolean;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  meter: string;
  userId: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface PluginCredits {
  getBalance(metric?: string): Promise<PluginCreditBalance>;
  consume(input: PluginCreditConsumeInput): Promise<PluginCreditConsumeResult>;
}

export interface PluginMeteringActionInput {
  meter: string;
  amount?: number;
  scope?: PluginResourceScope;
  runId?: string;
  apiKeyId?: string;
  connectorCallId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface PluginMeteringAuthorizeResult {
  authorized: true;
  meter: string;
  amount: number;
  unit: string;
  billable: boolean;
  creditCost: number;
  userId: string;
  idempotencyKey: string;
}

export interface PluginMeteringCommitResult extends PluginMeteringAuthorizeResult {
  usageId: string;
  credits?: PluginCreditConsumeResult;
}

export interface PluginMeteringAdjustmentResult {
  adjusted: true;
  meter: string;
  amount: number;
  unit: string;
  userId: string;
  idempotencyKey: string;
}

export interface PluginMeteringReconcileResult {
  meter?: string;
  userId: string;
  usageAmount: number;
  unit?: string;
}

export interface PluginMetering {
  authorize(input: PluginMeteringActionInput): Promise<PluginMeteringAuthorizeResult>;
  commit(input: PluginMeteringActionInput): Promise<PluginMeteringCommitResult>;
  refund(input: PluginMeteringActionInput): Promise<PluginMeteringAdjustmentResult>;
  void(input: PluginMeteringActionInput): Promise<PluginMeteringAdjustmentResult>;
  reconcile(input?: { meter?: string; userId?: string }): Promise<PluginMeteringReconcileResult>;
}

export interface PluginBillingPlan {
  id: string;
  name?: string;
  interval?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface PluginBillingGrantPlanInput {
  planId: string;
  userId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface PluginBillingGrantPlanResult {
  entitlementId: string;
  userId: string;
  planId: string;
  status: string;
  metadata?: Record<string, unknown>;
}

export interface PluginBillingRedeemCodeInput {
  code: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface PluginBillingRedeemCodeResult {
  redeemed: boolean;
  redemptionId?: string;
  entitlement?: PluginBillingGrantPlanResult;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface PluginBilling {
  getCurrentPlan(): Promise<PluginBillingPlan | null>;
  hasEntitlement(feature: string): Promise<boolean>;
  grantPlan(input: PluginBillingGrantPlanInput): Promise<PluginBillingGrantPlanResult>;
  redeemCode(input: PluginBillingRedeemCodeInput): Promise<PluginBillingRedeemCodeResult>;
}

export type PluginRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_external'
  | 'cancel_requested'
  | 'cancelled'
  | 'succeeded'
  | 'failed';

export type PluginRunVisibility = 'user-visible' | 'internal' | 'admin-only';
export type PluginRunReferenceType =
  | 'file'
  | 'artifact'
  | 'storage'
  | 'download'
  | 'external'
  | string;

export interface PluginRunReference {
  type: PluginRunReferenceType;
  ref: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface PluginRunCostReference {
  meter?: string;
  usageId?: string;
  creditId?: string;
  connectorCallId?: string;
  amount?: number;
  unit?: string;
  metadata?: Record<string, unknown>;
}

export interface PluginRunRetryPolicy {
  allowed?: boolean;
  maxAttempts?: number;
  retryAfterSeconds?: number;
}

export interface PluginRunRecord {
  id: string;
  scope: PluginResourceScope;
  title: string;
  visibility: PluginRunVisibility;
  status: PluginRunStatus;
  progress: number;
  inputs: PluginRunReference[];
  results: PluginRunReference[];
  costs: PluginRunCostReference[];
  retry?: PluginRunRetryPolicy;
  cancelReason?: string;
  cancelRequestedAt?: Date;
  metadata: Record<string, unknown>;
  files?: PluginRunFiles;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
}

export interface PluginRunCreateInput {
  scope: PluginResourceScope;
  title: string;
  visibility?: PluginRunVisibility;
  inputs?: PluginRunReference[];
  costs?: PluginRunCostReference[];
  retry?: PluginRunRetryPolicy;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface PluginRunUpdateInput {
  status?: PluginRunStatus;
  progress?: number;
  metadata?: Record<string, unknown>;
}

export interface PluginRunLogInput {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface PluginRunResultInput {
  type: 'artifact' | 'file' | 'storage' | 'external' | string;
  ref: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface PluginRunLogRecord extends PluginRunLogInput {
  id: string;
  runId: string;
  createdAt: Date;
}

export interface PluginRunResultRecord extends PluginRunResultInput {
  id: string;
  runId: string;
  createdAt: Date;
}

export interface PluginRuns {
  create(input: PluginRunCreateInput): Promise<PluginRunRecord>;
  update(id: string, input: PluginRunUpdateInput): Promise<PluginRunRecord>;
  appendLog(id: string, input: PluginRunLogInput): Promise<PluginRunLogRecord>;
  addResult(id: string, input: PluginRunResultInput): Promise<PluginRunResultRecord>;
  complete(id: string, metadata?: Record<string, unknown>): Promise<PluginRunRecord>;
  fail(
    id: string,
    error: { code?: string; message: string; metadata?: Record<string, unknown> }
  ): Promise<PluginRunRecord>;
  requestCancel(id: string, reason?: string): Promise<PluginRunRecord>;
  get(id: string): Promise<PluginRunRecord | null>;
  list(input?: {
    scope?: PluginResourceScope;
    status?: PluginRunStatus;
    limit?: number;
    offset?: number;
  }): Promise<PluginRunRecord[]>;
}

export type PluginConnectorAuthProfile =
  | { type: 'none' }
  | { type: 'bearer'; secretName: string }
  | { type: 'basic'; secretName: string }
  | { type: 'apiKey'; secretName: string; headerName?: string }
  | {
      type: 'oauth2';
      secretName: string;
      authorizeUrl?: string;
      tokenUrl?: string;
      scopes?: string[];
    }
  | { type: 'custom'; secretName: string; headerName: string };

export interface PluginConnectorEgressPolicy {
  allowedHosts?: string[];
  allowedMethods?: string[];
  maxBodyBytes?: number;
  maxResponseBytes?: number;
}

export interface PluginConnectorRetryPolicy {
  count?: number;
  backoffMs?: number;
  retryableStatusCodes?: number[];
}

export interface PluginConnectorRedactionPolicy {
  requestHeaders?: string[];
  responseHeaders?: string[];
  bodyFields?: string[];
}

export interface PluginConnectorRecord {
  name: string;
  type: string;
  baseUrl: string;
  status: 'active' | 'disabled';
  scope?: PluginResourceScope;
  auth?: PluginConnectorAuthProfile;
  egress?: PluginConnectorEgressPolicy;
  retry?: PluginConnectorRetryPolicy;
  redaction?: PluginConnectorRedactionPolicy;
  authType?: 'none' | 'bearer' | 'basic' | 'custom' | string;
  secretName?: string;
  timeoutMs?: number;
  retryCount?: number;
  metadata?: Record<string, unknown>;
}

export interface PluginConnectorUpsertInput {
  name: string;
  type?: string;
  baseUrl: string;
  scope?: PluginResourceScope;
  auth?: PluginConnectorAuthProfile;
  egress?: PluginConnectorEgressPolicy;
  retry?: PluginConnectorRetryPolicy;
  redaction?: PluginConnectorRedactionPolicy;
  authType?: 'none' | 'bearer' | 'basic' | 'custom' | string;
  secretName?: string;
  timeoutMs?: number;
  retryCount?: number;
  metadata?: Record<string, unknown>;
}

export interface PluginConnectorListInput {
  scope?: PluginResourceScope;
  includeDisabled?: boolean;
}

export interface PluginConnectorFileReference {
  fileId: string;
  name?: string;
  expiresInSeconds?: number;
}

export interface PluginConnectorResolvedFile {
  id: string;
  name: string;
  scope: PluginResourceScope;
  fileName: string;
  contentType: string;
  size: number;
  hash?: string;
  purpose: PluginFilePurpose;
  runId?: string;
  downloadUrl: string;
}

export interface PluginConnectorCallInput {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  json?: unknown;
  body?: string;
  files?: PluginConnectorFileReference[];
  runId?: string;
  meter?: string;
  creditAmount?: number;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  scope?: PluginResourceScope;
}

export interface PluginConnectorCallResult {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  text: string;
  json?: unknown;
  callId: string;
}

export interface PluginConnectorSignedCallbackInput {
  connector: string;
  runId?: string;
  expiresInSeconds?: number;
  metadata?: Record<string, unknown>;
  scope?: PluginResourceScope;
}

export interface PluginConnectorSignedCallback {
  url: string;
  token: string;
  expiresAt: Date;
}

export interface PluginConnectors {
  get(name: string): Promise<PluginConnectorRecord | null>;
  list(input?: PluginConnectorListInput): Promise<PluginConnectorRecord[]>;
  upsert(input: PluginConnectorUpsertInput): Promise<PluginConnectorRecord>;
  setStatus(
    name: string,
    status: 'active' | 'disabled',
    input?: { scope?: PluginResourceScope }
  ): Promise<PluginConnectorRecord>;
  delete(name: string, input?: { scope?: PluginResourceScope }): Promise<void>;
  call(name: string, request: PluginConnectorCallInput): Promise<PluginConnectorCallResult>;
  createSignedCallback(
    input: PluginConnectorSignedCallbackInput
  ): Promise<PluginConnectorSignedCallback>;
}

export interface PluginApiKeyCreateInput {
  name: string;
  scope: PluginResourceScope;
  permissions?: string[];
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface PluginApiKeyCreateResult {
  id: string;
  key: string;
  name: string;
  scope: PluginResourceScope;
  permissions: string[];
  expiresAt?: Date;
  createdAt: Date;
}

export interface PluginApiKeyRecord {
  id: string;
  name: string;
  scope: PluginResourceScope;
  permissions: string[];
  revokedAt?: Date;
  expiresAt?: Date;
  lastUsedAt?: Date;
  createdAt: Date;
}

export interface PluginApiKeys {
  create(input: PluginApiKeyCreateInput): Promise<PluginApiKeyCreateResult>;
  list(input?: { scope?: PluginResourceScope }): Promise<PluginApiKeyRecord[]>;
  revoke(id: string): Promise<void>;
}

export interface PluginRateLimitCheckInput {
  bucket: string;
  limit: number;
  window: string;
  cost?: number;
}

export interface PluginRateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds?: number;
}

export interface PluginRateLimit {
  check(input: PluginRateLimitCheckInput): Promise<PluginRateLimitCheckResult>;
}

export type PluginNotificationChannel = 'in-app' | 'email';

export interface PluginNotificationInput {
  recipientUserId?: string;
  channel?: PluginNotificationChannel;
  subject?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface PluginNotificationResult {
  id: string;
  queued: boolean;
}

export interface PluginNotifications {
  send(input: PluginNotificationInput): Promise<PluginNotificationResult>;
}

export interface PluginWebhooks {
  verify(policy?: string): Promise<unknown>;
  respondAccepted(): Response;
}

export interface PluginHttp {
  fetch(url: string | URL, init?: RequestInit): Promise<Response>;
}

export type PluginResourceBindingStatus = 'active' | 'archived' | 'disabled';

export interface PluginResourceBindingRecord {
  id: string;
  scope: PluginResourceScope;
  resourceType: string;
  resourceId: string;
  cardinality?: PluginResourceBindingCardinality;
  displayName?: string;
  status: PluginResourceBindingStatus;
  metadata: Record<string, unknown>;
  createdByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date;
}

export interface PluginResourceBindingLookupInput {
  scope: PluginResourceScope;
  resourceType: string;
  resourceId?: string;
  status?: PluginResourceBindingStatus;
}

export interface PluginResourceBindingListInput {
  scope: PluginResourceScope;
  resourceType?: string;
  status?: PluginResourceBindingStatus;
  limit?: number;
  offset?: number;
}

export interface PluginResourceBindingUpsertInput {
  scope: PluginResourceScope;
  resourceType: string;
  resourceId: string;
  displayName?: string;
  metadata?: Record<string, unknown>;
  status?: Extract<PluginResourceBindingStatus, 'active' | 'disabled'>;
}

export interface PluginResourceBindings {
  get(input: PluginResourceBindingLookupInput): Promise<PluginResourceBindingRecord | null>;
  list(input: PluginResourceBindingListInput): Promise<PluginResourceBindingRecord[]>;
  upsert(input: PluginResourceBindingUpsertInput): Promise<PluginResourceBindingRecord>;
  archive(id: string): Promise<PluginResourceBindingRecord>;
}

export type PluginServiceQuery =
  | URLSearchParams
  | Record<string, string | number | boolean | null | undefined>;

export interface PluginServiceRequestInit {
  method?: string;
  headers?: HeadersInit;
  query?: PluginServiceQuery;
  body?: BodyInit | Record<string, unknown> | unknown[];
  json?: unknown;
  scope?: PluginResourceScope;
  signal?: AbortSignal;
}

export interface PluginServiceObjectRequest extends PluginServiceRequestInit {
  path?: string;
  template?: string;
  params?: Record<string, string | number | boolean | null | undefined>;
  errorMode?: 'throw' | 'preserve';
}

export type PluginServiceRequest = string | PluginServiceObjectRequest;

export type PluginServiceJsonResult<T = unknown> =
  | { ok: true; status: number; data: T; headers: Headers }
  | { ok: false; status: number; error: unknown; headers: Headers };

export interface PluginServices {
  fetch(service: string, path: string, init?: PluginServiceRequestInit): Promise<Response>;
  fetch(service: string, request: PluginServiceObjectRequest): Promise<Response>;
  json<T = unknown>(service: string, path: string, init?: PluginServiceRequestInit): Promise<T>;
  json<T = unknown>(service: string, request: PluginServiceObjectRequest): Promise<T>;
  requestJson<T = unknown>(
    service: string,
    request: PluginServiceObjectRequest
  ): Promise<PluginServiceJsonResult<T>>;
}

export interface PluginAuthContext {
  apiKey?: {
    id: string;
    scope: PluginResourceScope;
    permissions: string[];
  };
}

export interface PluginContext {
  plugin: {
    id: string;
    version: string;
    kind: string;
  };
  user: PluginUser | null;
  auth?: PluginAuthContext;
  request: PluginRequest;
  response: PluginResponseFactory;
  storage: PluginStorage;
  workspace: PluginWorkspaceApi;
  ui: PluginUi;
  events: PluginEvents;
  jobs: PluginJobs;
  files: PluginFiles;
  artifacts: PluginArtifacts;
  rag: PluginRag;
  ai: PluginAi;
  secrets: PluginSecrets;
  config: PluginConfig;
  resourceBindings: PluginResourceBindings;
  audit: PluginAudit;
  usage: PluginUsage;
  credits: PluginCredits;
  metering: PluginMetering;
  billing: PluginBilling;
  runs: PluginRuns;
  connectors: PluginConnectors;
  apiKeys: PluginApiKeys;
  rateLimit: PluginRateLimit;
  notifications: PluginNotifications;
  webhooks: PluginWebhooks;
  http: PluginHttp;
  services: PluginServices;
  json(data: unknown, init?: ResponseInit): Response;
}
