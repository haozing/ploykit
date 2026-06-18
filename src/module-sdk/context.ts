import type { ModuleDataApi } from './data';
import type { ModuleHttpMethod, ModuleWorkspaceRole } from './types';

export interface ModuleUser {
  id: string;
  role: 'admin' | 'user';
  email?: string;
}

export type ModuleProductScopeProfile = 'hidden-default' | 'explicit-workspace' | 'domain-alias';

export type ModuleScopeResource = 'user' | 'workspace' | 'product' | 'public-read' | 'system';

export interface ModuleScopeContext {
  profile: ModuleProductScopeProfile;
  resource: ModuleScopeResource;
  productId: string | null;
  environmentId: string | null;
  workspaceId: string | null;
  userId: string | null;
  actorId: string | null;
  workspaceRole: ModuleWorkspaceRole | null;
}

export interface ModuleProductContext {
  id: string | null;
  profile: ModuleProductScopeProfile;
}

export interface ModuleWorkspaceContext {
  id: string | null;
  role: ModuleWorkspaceRole | null;
}

export interface ModuleAuthContext {
  actorId: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
}

export type CommercialSubjectType = 'user' | 'workspace' | 'organization' | 'apiKey';

export interface CommercialSubject {
  type: CommercialSubjectType;
  id: string;
}

export type CommercialSubjectSource = 'actor' | 'workspace' | 'apiKeyOwner';

export function userCommercialSubject(userId: string): CommercialSubject {
  return { type: 'user', id: userId };
}

export interface ModuleRequest {
  id: string;
  correlationId: string;
  method: string;
  url: string;
  path: string;
  headers: Headers;
  params: Record<string, string>;
  query: URLSearchParams;
  json<T = unknown>(): Promise<T>;
  text(): Promise<string>;
  formData(): Promise<FormData>;
}

export interface ModuleResponseFactory {
  json(data: unknown, init?: ResponseInit): Response;
  redirect(url: string, status?: number): Response;
  stream(body: ReadableStream, init?: ResponseInit): Response;
}

export interface ModuleConfigApi {
  get<T = unknown>(key: string): Promise<T | null>;
  require<T = unknown>(key: string): Promise<T>;
}

export interface ModuleSecretsApi {
  get(name: string): Promise<string | null>;
  require(name: string): Promise<string>;
}

export interface ModuleServiceInvokeOptions {
  correlationId?: string;
}

export interface ModuleServicesApi {
  invoke<TInput = unknown, TResult = unknown>(
    name: string,
    input: TInput,
    options?: ModuleServiceInvokeOptions
  ): Promise<TResult>;
  invoke<TInput = unknown, TResult = unknown>(
    name: string,
    operation: string,
    input: TInput,
    options?: ModuleServiceInvokeOptions
  ): Promise<TResult>;
}

export interface ModuleConnectorsApi {
  get<TConfig = unknown>(name: string): Promise<TConfig | null>;
  invoke<TInput = unknown, TResult = unknown>(
    name: string,
    operation: string,
    input: TInput
  ): Promise<TResult>;
}

export interface ModuleResourceBindingsApi {
  get<TBinding = unknown>(name: string): Promise<TBinding | null>;
  list<TBinding = unknown>(kind?: string): Promise<TBinding[]>;
  upsert?<TBinding = unknown>(
    name: string,
    value: TBinding,
    options?: {
      kind?: string;
      status?: 'active' | 'disabled';
      metadata?: Record<string, unknown>;
    }
  ): Promise<TBinding>;
}

export type ModuleAuditActorKind =
  | 'platform_user'
  | 'api_key'
  | 'hosted_user'
  | 'system'
  | 'webhook';

export type ModuleAuditDecision = 'allow' | 'deny' | 'success' | 'failure' | 'noop';

export interface ModuleAuditRecordInput {
  actorKind: ModuleAuditActorKind;
  actorId?: string;
  action: string;
  category: string;
  targetKind?: string;
  targetId?: string;
  decision: ModuleAuditDecision;
  reasonCode?: string;
  requestId?: string;
  traceId?: string;
  beforeHash?: string;
  afterHash?: string;
  metadata?: Record<string, unknown>;
  sync?: boolean;
}

export interface ModuleAuditApi {
  record(input: ModuleAuditRecordInput | string, metadata?: Record<string, unknown>): Promise<void>;
}

export interface ModuleHttpApi {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export interface ModuleUsageRecordInput {
  meter: string;
  quantity?: number;
  unit?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface ModuleUsageRecord {
  id: string;
  moduleId: string;
  meter: string;
  quantity: number;
  unit?: string;
  idempotencyKey?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ModuleUsageApi {
  record(input: ModuleUsageRecordInput): Promise<ModuleUsageRecord>;
  increment(input: ModuleUsageRecordInput): Promise<ModuleUsageRecord>;
}

export interface ModuleMeteringAuthorization {
  id: string;
  moduleId: string;
  meter: string;
  quantity: number;
  unit?: string;
  status: 'authorized' | 'committed' | 'refunded' | 'voided';
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModuleMeteringCharge {
  id: string;
  moduleId: string;
  subject: CommercialSubject;
  meter: string;
  quantity: number;
  unit?: string;
  credits?: {
    amount: number;
    unit: string;
  };
  usageId: string;
  meteringId: string;
  balance?: ModuleCreditsBalance;
  idempotencyKey?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ModuleMeteringApi {
  authorize(input: {
    meter: string;
    quantity?: number;
    unit?: string;
    idempotencyKey?: string;
  }): Promise<ModuleMeteringAuthorization>;
  commit(authorizationId: string): Promise<ModuleMeteringAuthorization>;
  refund(authorizationId: string): Promise<ModuleMeteringAuthorization>;
  void(authorizationId: string): Promise<ModuleMeteringAuthorization>;
  reconcile(): Promise<{ checked: number }>;
  charge(input: {
    subject: CommercialSubject;
    meter: string;
    quantity?: number;
    unit?: string;
    credits?: {
      amount: number;
      unit?: string;
    };
    reservationId?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ModuleMeteringCharge>;
}

export interface ModuleCreditsBalance {
  subject?: CommercialSubject;
  userId?: string;
  unit: string;
  balance: number;
}

export type ModuleCreditsLedgerDirection = 'grant' | 'consume' | 'reserve' | 'release' | 'refund' | 'adjust' | 'revoke';
export type ModuleCreditsLedgerStatus = 'pending' | 'available' | 'reserved' | 'committed' | 'released' | 'expired' | 'void';

export interface ModuleCreditsLedgerEntry {
  id: string;
  subject: CommercialSubject;
  amount: number;
  unit: string;
  direction: ModuleCreditsLedgerDirection;
  status: ModuleCreditsLedgerStatus;
  reason: string;
  source?: string;
  sourceId?: string;
  reservationId?: string;
  idempotencyKey?: string;
  expiresAt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type ModuleCreditsAmountInput = number | bigint | string;

export interface ModuleCreditsReservation {
  id: string;
  subject: CommercialSubject;
  amountReserved: number;
  amountCommitted: number;
  unit: string;
  status: 'reserved' | 'committed' | 'released';
  source?: string;
  sourceId?: string;
  idempotencyKey?: string;
  expiresAt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ModuleCreditsMutationInput {
  subject?: CommercialSubject;
  userId?: string;
  amount: ModuleCreditsAmountInput;
  unit?: string;
  reason?: string;
  source?: string;
  sourceId?: string;
  idempotencyKey?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ModuleCreditsApi {
  balance(
    input: string | { subject: CommercialSubject; unit?: string },
    unit?: string
  ): Promise<ModuleCreditsBalance>;
  grant(input: ModuleCreditsMutationInput): Promise<ModuleCreditsBalance>;
  consume(input: ModuleCreditsMutationInput): Promise<ModuleCreditsBalance>;
  adjust(input: ModuleCreditsMutationInput): Promise<ModuleCreditsBalance>;
  refund(input: ModuleCreditsMutationInput): Promise<ModuleCreditsBalance>;
  reserve(input: ModuleCreditsMutationInput): Promise<ModuleCreditsReservation>;
  commitReservation(input: {
    reservationId: string;
    finalAmount?: ModuleCreditsAmountInput;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ModuleCreditsBalance>;
  releaseReservation(input: {
    reservationId: string;
    reason?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ModuleCreditsBalance>;
  revokeBySource(input: {
    source: string;
    sourceId: string;
    reason?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ revoked: number }>;
  refundRevoke(input: {
    grantLedgerId?: string;
    source?: string;
    sourceId?: string;
    subject?: CommercialSubject;
    userId?: string;
    amount?: ModuleCreditsAmountInput;
    unit?: string;
    reason?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{
    revoked: number;
    unrecovered: number;
    balance: ModuleCreditsBalance;
    relatedLedgerIds: readonly string[];
  }>;
  listLedger(input?: {
    subject?: CommercialSubject;
    userId?: string;
    unit?: string;
    source?: string;
    sourceId?: string;
    status?: ModuleCreditsLedgerStatus;
  }): Promise<ModuleCreditsLedgerEntry[]>;
}

export interface ModuleBillingPlan {
  id: string;
  name: string;
  entitlements: readonly string[];
}

export interface ModuleBillingApi {
  getPlan(userId: string): Promise<ModuleBillingPlan | null>;
  getCurrentPlan(userId: string): Promise<ModuleBillingPlan | null>;
  hasEntitlement(userId: string, entitlement: string): Promise<boolean>;
  redeemCode(code: string, userId: string): Promise<{ ok: boolean; entitlement?: string }>;
}

export interface ModuleEntitlementGrant {
  id: string;
  subject: CommercialSubject;
  userId?: string;
  entitlement: string;
  planId?: string;
  source: string;
  sourceId?: string;
  status: 'active' | 'revoked' | 'expired';
  idempotencyKey?: string;
  expiresAt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ModuleEntitlementsApi {
  has(
    input: string | { subject: CommercialSubject; entitlement: string },
    entitlement?: string
  ): Promise<boolean>;
  list(input?: {
    subject?: CommercialSubject;
    userId?: string;
    entitlement?: string;
    status?: ModuleEntitlementGrant['status'];
  }): Promise<ModuleEntitlementGrant[]>;
  grant(input: {
    subject?: CommercialSubject;
    userId?: string;
    entitlement: string;
    planId?: string;
    source: string;
    sourceId?: string;
    expiresAt?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ModuleEntitlementGrant>;
  revoke(input: {
    id: string;
    reason?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ModuleEntitlementGrant>;
  override(input: {
    id: string;
    status: ModuleEntitlementGrant['status'];
    expiresAt?: string | null;
    metadata?: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<ModuleEntitlementGrant>;
  expire(input?: { before?: string; limit?: number }): Promise<{ expired: number }>;
}

export interface ModuleCommerceCheckout {
  id: string;
  userId?: string;
  buyer?: CommercialSubject;
  beneficiary?: CommercialSubject;
  sku: string;
  amount: number;
  currency: string;
  status: 'created' | 'paid' | 'failed' | 'refunded' | 'canceled';
  idempotencyKey?: string;
  createdAt: string;
}

export interface ModuleCommerceApi {
  createCheckout(input: {
    userId?: string;
    buyer?: CommercialSubject;
    beneficiary?: CommercialSubject;
    sku: string;
    amount: number;
    currency: string;
    idempotencyKey?: string;
  }): Promise<ModuleCommerceCheckout>;
  getOrder(id: string): Promise<ModuleCommerceCheckout | null>;
  applyCheckoutPaid(input: {
    provider: string;
    providerRef: string;
    orderId?: string;
    userId?: string;
    buyer?: CommercialSubject;
    beneficiary?: CommercialSubject;
    sku: string;
    amount: number;
    currency: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{
    order: ModuleCommerceCheckout;
    credits: ModuleCreditsLedgerEntry[];
    entitlements: ModuleEntitlementGrant[];
  }>;
  applyRefund(input: {
    provider: string;
    providerRef: string;
    orderId?: string;
    amount?: number;
    currency?: string;
    reason?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{
    order: ModuleCommerceCheckout;
    credits: ModuleCreditsLedgerEntry[];
    revokedEntitlements: ModuleEntitlementGrant[];
  }>;
  recordSubscriptionEvent(input: {
    provider?: string | null;
    providerRef?: string | null;
    subject?: CommercialSubject;
    userId?: string;
    subscriptionId?: string;
    planId: string;
    type: 'created' | 'trial_started' | 'renewed' | 'past_due' | 'paused' | 'canceled';
    status?: 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused';
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    trialEnd?: string | null;
    cancelAtPeriodEnd?: boolean;
    effectiveAt?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string; subject: CommercialSubject; planId: string; type: string; status: string }>;
  reconcilePaidOrderBenefits(input?: { provider?: string; from?: string; to?: string }): Promise<{
    checked: number;
    repaired: number;
  }>;
}

export interface ModuleRedeemCodeRecord {
  id: string;
  batchId?: string;
  code?: string;
  prefix?: string;
  maskedCode?: string;
  entitlement?: string;
  credits?: { amount: number; unit?: string };
  maxRedemptions: number;
  status: 'active' | 'frozen' | 'revoked' | 'expired';
  expiresAt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ModuleRedeemCodeRedemption {
  id: string;
  codeId?: string;
  code?: string;
  subject: CommercialSubject;
  entitlement?: string;
  credits?: { amount: number; unit?: string };
  idempotencyKey?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ModuleRedeemCodesApi {
  createBatch(input: {
    count: number;
    prefix?: string;
    entitlement?: string;
    credits?: { amount: number; unit?: string };
    maxRedemptions: number;
    expiresAt?: string;
    bind?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<{ batchId: string; codes: ModuleRedeemCodeRecord[] }>;
  redeem(input: {
    code: string;
    subject?: CommercialSubject;
    userId?: string;
    email?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{
    ok: boolean;
    entitlement?: string;
    credits?: { amount: number; unit?: string };
    redemption?: ModuleRedeemCodeRedemption;
  }>;
  freeze(input: { batchId: string; reason?: string }): Promise<{ frozen: number }>;
  revoke(input: { codeId: string; reason?: string }): Promise<ModuleRedeemCodeRecord>;
  list(input?: { batchId?: string; status?: ModuleRedeemCodeRecord['status'] }): Promise<ModuleRedeemCodeRecord[]>;
  listRedemptions(input?: { codeId?: string; subject?: CommercialSubject; userId?: string }): Promise<ModuleRedeemCodeRedemption[]>;
}

export interface ModuleRiskEvent {
  id: string;
  subject?: CommercialSubject;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'acknowledged' | 'resolved' | 'ignored';
  source?: string;
  sourceId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
}

export interface ModuleRiskApi {
  record(input: {
    subject?: CommercialSubject;
    type: string;
    severity?: ModuleRiskEvent['severity'];
    status?: ModuleRiskEvent['status'];
    source?: string;
    sourceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ModuleRiskEvent>;
  block(input: {
    subject: CommercialSubject;
    scope?: string;
    reason: string;
    expiresAt?: string;
    idempotencyKey?: string;
  }): Promise<{ blocked: true }>;
  check(input: { subject?: CommercialSubject; scope?: string }): Promise<{ ok: boolean; reason?: string }>;
}

export interface ModuleAiTextResult {
  text: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface ModuleAiEmbeddingResult {
  embedding: number[];
  model: string;
  usage: {
    inputTokens: number;
  };
}

export interface ModuleAiApi {
  generateText(input: {
    prompt: string;
    model?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ModuleAiTextResult>;
  streamText(input: {
    prompt: string;
    model?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): AsyncIterable<string>;
  embedText(input: {
    text: string;
    model?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ModuleAiEmbeddingResult>;
}

export interface ModuleRagDocument {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
}

export interface ModuleRagSearchResult extends ModuleRagDocument {
  score: number;
}

export interface ModuleRagApi {
  index(input: {
    id?: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<ModuleRagDocument>;
  search(input: { query: string; limit?: number }): Promise<ModuleRagSearchResult[]>;
  contextPack(input: {
    query: string;
    limit?: number;
  }): Promise<{ context: string; documents: ModuleRagSearchResult[] }>;
  buildContextPack(input: {
    query: string;
    limit?: number;
  }): Promise<{ context: string; documents: ModuleRagSearchResult[] }>;
  delete(id: string): Promise<void>;
}

export type ModuleFilePurpose = 'source' | 'result' | 'temp' | 'media';
export type ModuleFileStatus =
  | 'pending'
  | 'uploading'
  | 'ready'
  | 'published'
  | 'archived'
  | 'deleted'
  | 'quarantined';
export type ModuleFileVisibility = 'private' | 'public';

export interface ModuleFileRecord {
  id: string;
  productId?: string;
  workspaceId?: string | null;
  moduleId: string;
  ownerId?: string | null;
  name: string;
  purpose: ModuleFilePurpose;
  status: ModuleFileStatus;
  visibility?: ModuleFileVisibility;
  contentType?: string;
  sizeBytes: number;
  checksum?: string;
  storageKey?: string;
  runId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  publishedAt?: string;
  deletedAt?: string;
  quarantinedAt?: string;
}

export interface ModuleFileCreateUploadInput {
  name: string;
  purpose: ModuleFilePurpose;
  contentType?: string;
  sizeBytes?: number;
  visibility?: ModuleFileVisibility;
  runId?: string;
  metadata?: Record<string, unknown>;
  expiresAt?: Date | string;
}

export interface ModuleFileCompleteUploadInput {
  content?: string | ArrayBuffer | Uint8Array;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
}

export interface ModuleFileListQuery {
  purpose?: ModuleFilePurpose;
  status?: ModuleFileStatus;
  runId?: string;
}

export interface ModuleFileSignedUrlOptions {
  expiresInSeconds?: number;
  disposition?: 'inline' | 'attachment';
}

export interface ModuleFilesApi {
  createUpload(input: ModuleFileCreateUploadInput): Promise<{
    file: ModuleFileRecord;
    uploadUrl: string;
  }>;
  createSignedUploadUrl(input: ModuleFileCreateUploadInput): Promise<{
    file: ModuleFileRecord;
    uploadUrl: string;
  }>;
  completeUpload(id: string, input?: ModuleFileCompleteUploadInput): Promise<ModuleFileRecord>;
  read(id: string): Promise<ModuleFileRecord | null>;
  get(id: string): Promise<ModuleFileRecord | null>;
  list(query?: ModuleFileListQuery): Promise<ModuleFileRecord[]>;
  createSignedUrl(id: string, options?: ModuleFileSignedUrlOptions): Promise<string>;
  createSignedDownloadUrl(id: string, options?: ModuleFileSignedUrlOptions): Promise<string>;
  publish(id: string): Promise<ModuleFileRecord>;
  unpublish(id: string): Promise<ModuleFileRecord>;
  archive(id: string): Promise<ModuleFileRecord>;
  delete(id: string): Promise<void>;
}

export type ModuleArtifactKind = 'text' | 'markdown' | 'json';

export interface ModuleArtifactRecord<TContent = unknown> {
  id: string;
  moduleId: string;
  name: string;
  kind: ModuleArtifactKind;
  path: string;
  content: TContent;
  runId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ModuleArtifactWriteInput<TContent = unknown> {
  name: string;
  kind: ModuleArtifactKind;
  content: TContent;
  path?: string;
  runId?: string;
  metadata?: Record<string, unknown>;
}

export interface ModuleArtifactListQuery {
  runId?: string;
  kind?: ModuleArtifactKind;
  pathPrefix?: string;
}

export interface ModuleArtifactTreeNode {
  name: string;
  path: string;
  type: 'directory' | 'artifact';
  artifactId?: string;
  children?: ModuleArtifactTreeNode[];
}

export interface ModuleArtifactsApi {
  write<TContent = unknown>(
    input: ModuleArtifactWriteInput<TContent>
  ): Promise<ModuleArtifactRecord<TContent>>;
  writeText(input: Omit<ModuleArtifactWriteInput<string>, 'kind'>): Promise<ModuleArtifactRecord<string>>;
  read<TContent = unknown>(id: string): Promise<ModuleArtifactRecord<TContent> | null>;
  readText(id: string): Promise<string | null>;
  updateMetadata(id: string, metadata: Record<string, unknown>): Promise<ModuleArtifactRecord>;
  list(query?: ModuleArtifactListQuery): Promise<ModuleArtifactRecord[]>;
  tree(query?: Pick<ModuleArtifactListQuery, 'pathPrefix'>): Promise<ModuleArtifactTreeNode[]>;
  delete(id: string): Promise<void>;
}

export type ModuleRunKind = 'manual' | 'job' | 'event' | 'webhook' | 'lifecycle';

export type ModuleRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancel_requested'
  | 'canceled';

export interface ModuleRunLogEntry {
  at: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ModuleRunError {
  code: string;
  message: string;
  stack?: string;
}

export interface ModuleRunRecord<TInput = unknown, TResult = unknown> {
  id: string;
  productId?: string;
  workspaceId?: string | null;
  moduleId: string;
  kind: ModuleRunKind;
  name: string;
  status: ModuleRunStatus;
  progress: number;
  attempt: number;
  maxAttempts: number;
  input?: TInput;
  result?: TResult;
  error?: ModuleRunError;
  costRef?: string;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelRequestedAt?: string;
  canceledAt?: string;
  logs: ModuleRunLogEntry[];
}

export interface ModuleRunsApi {
  create<TInput = unknown>(input: {
    kind: ModuleRunKind;
    name: string;
    input?: TInput;
    maxAttempts?: number;
    costRef?: string;
    idempotencyKey?: string;
  }): Promise<ModuleRunRecord<TInput>>;
  get<TResult = unknown>(id: string): Promise<ModuleRunRecord<unknown, TResult> | null>;
  list(query?: {
    kind?: ModuleRunKind;
    name?: string;
    status?: ModuleRunStatus;
    idempotencyKey?: string;
  }): Promise<ModuleRunRecord[]>;
  updateProgress(id: string, progress: number): Promise<ModuleRunRecord>;
  appendLog(
    id: string,
    level: ModuleRunLogEntry['level'],
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<ModuleRunRecord>;
  succeed<TResult = unknown>(id: string, result?: TResult): Promise<ModuleRunRecord<unknown, TResult>>;
  fail(id: string, error: ModuleRunError | Error | string): Promise<ModuleRunRecord>;
  requestCancel(id: string): Promise<ModuleRunRecord>;
  cancel(id: string, reason?: string): Promise<ModuleRunRecord>;
}

export interface ModuleJobSummary {
  moduleId: string;
  name: string;
  schedule?: string;
  timeoutMs?: number;
  retries?: number;
}

export interface ModuleJobsApi {
  list(): Promise<ModuleJobSummary[]>;
  run<TInput = unknown, TResult = unknown>(
    name: string,
    input?: TInput,
    options?: { idempotencyKey?: string }
  ): Promise<{ run: ModuleRunRecord<unknown, TResult>; result?: TResult }>;
}

export interface ModuleEventPublishResult<TPayload = unknown> {
  id: string;
  name: string;
  payload: TPayload;
  metadata: Record<string, unknown>;
  status: 'queued' | 'processing' | 'processed' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface ModuleEventsApi {
  publish<TPayload = unknown>(
    name: string,
    payload: TPayload,
    options?: {
      correlationId?: string;
      causationId?: string;
      idempotencyKey?: string;
    }
  ): Promise<ModuleEventPublishResult<TPayload>>;
}

export interface ModuleWebhookRegistration {
  name: string;
  path: string;
  methods: readonly ModuleHttpMethod[];
  signature: 'none' | 'hmac-sha256' | 'stripe' | 'github';
}

export interface ModuleWebhookReceiptSummary {
  id: string;
  webhookName: string;
  status: string;
  createdAt: string;
  processedAt?: string;
  error?: string;
}

export interface ModuleWebhooksApi {
  list(): Promise<ModuleWebhookRegistration[]>;
  getReceipt(id: string): Promise<ModuleWebhookReceiptSummary | null>;
}

export interface ModuleApiKeyVerificationResult {
  ok: boolean;
  user?: ModuleUser | null;
  productId?: string;
  environmentId?: string;
  workspaceId?: string;
  apiKeyId?: string;
  subject?: CommercialSubject;
  permissions?: readonly string[];
}

export interface ModuleApiKeysApi {
  create(input: {
    name: string;
    owner?: CommercialSubject;
    scope?: {
      productId?: string;
      environmentId?: string | null;
      workspaceId?: string | null;
      moduleId?: string;
    };
    permissions?: readonly string[];
    expiresAt?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{
    id: string;
    key: string;
    prefix: string;
    owner?: CommercialSubject;
    expiresAt?: string;
  }>;
  rotate(input: { id: string }): Promise<{ id: string; key: string; prefix: string }>;
  revoke(input: { id: string; reason?: string }): Promise<{ id: string; revoked: true }>;
  list(input?: {
    owner?: CommercialSubject;
    status?: 'active' | 'rotating' | 'revoked' | 'expired';
  }): Promise<
    {
      id: string;
      name: string;
      prefix: string;
      owner?: CommercialSubject;
      status: 'active' | 'rotating' | 'revoked' | 'expired';
      lastUsedAt?: string;
      expiresAt?: string;
      metadata: Record<string, unknown>;
    }[]
  >;
  verify(apiKey: string): Promise<ModuleApiKeyVerificationResult>;
  require(apiKey: string): Promise<ModuleApiKeyVerificationResult & { ok: true }>;
}

export interface ModuleRateLimitCheckInput {
  bucket: string;
  cost?: number;
  limit: number;
  windowMs: number;
}

export interface ModuleRateLimitCheckResult {
  ok: boolean;
  remaining: number;
  resetAt: string;
}

export interface ModuleRateLimitApi {
  check(input: ModuleRateLimitCheckInput): Promise<ModuleRateLimitCheckResult>;
}

export interface ModuleCacheApi {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T, options?: { ttlSeconds?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  remember<T = unknown>(
    key: string,
    factory: () => T | Promise<T>,
    options?: { ttlSeconds?: number }
  ): Promise<T>;
}

export type ModuleNotificationChannel = 'inApp' | 'email';
export type ModuleNotificationStatus = 'unread' | 'read';

export interface ModuleNotificationRecord {
  id: string;
  moduleId: string;
  userId: string;
  channel: ModuleNotificationChannel;
  title: string;
  body?: string;
  actionUrl?: string;
  runId?: string;
  status: ModuleNotificationStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  readAt?: string;
}

export interface ModuleNotificationSendInput {
  userId: string;
  channel?: ModuleNotificationChannel;
  title: string;
  body?: string;
  actionUrl?: string;
  runId?: string;
  metadata?: Record<string, unknown>;
}

export interface ModuleNotificationListQuery {
  userId?: string;
  status?: ModuleNotificationStatus;
  channel?: ModuleNotificationChannel;
  runId?: string;
}

export interface ModuleNotificationsApi {
  send(input: ModuleNotificationSendInput): Promise<ModuleNotificationRecord>;
  list(query?: ModuleNotificationListQuery): Promise<ModuleNotificationRecord[]>;
  markRead(id: string): Promise<ModuleNotificationRecord>;
}

export interface ModuleContext {
  module: {
    id: string;
    version: string;
  };
  product: ModuleProductContext;
  user: ModuleUser | null;
  auth: ModuleAuthContext;
  scope: ModuleScopeContext;
  workspace: ModuleWorkspaceContext;
  request: ModuleRequest;
  response: ModuleResponseFactory;
  data: ModuleDataApi;
  config: ModuleConfigApi;
  secrets: ModuleSecretsApi;
  services: ModuleServicesApi;
  connectors: ModuleConnectorsApi;
  resourceBindings: ModuleResourceBindingsApi;
  http: ModuleHttpApi;
  files: ModuleFilesApi;
  artifacts: ModuleArtifactsApi;
  notifications: ModuleNotificationsApi;
  runs: ModuleRunsApi;
  jobs: ModuleJobsApi;
  events: ModuleEventsApi;
  webhooks: ModuleWebhooksApi;
  usage: ModuleUsageApi;
  metering: ModuleMeteringApi;
  credits: ModuleCreditsApi;
  billing: ModuleBillingApi;
  entitlements: ModuleEntitlementsApi;
  commerce: ModuleCommerceApi;
  redeemCodes: ModuleRedeemCodesApi;
  ai: ModuleAiApi;
  rag: ModuleRagApi;
  apiKeys: ModuleApiKeysApi;
  rateLimit: ModuleRateLimitApi;
  risk: ModuleRiskApi;
  cache: ModuleCacheApi;
  audit: ModuleAuditApi;
  extensions: Readonly<Record<string, unknown>>;
  json(data: unknown, init?: ResponseInit): Response;
}
