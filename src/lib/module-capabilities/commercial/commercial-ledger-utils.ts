import { createHash } from 'node:crypto';
import type {
  CommercialSubject,
  ModuleBillingPlan,
  ModuleCommerceCheckout,
  ModuleCreditsBalance,
  ModuleCreditsLedgerEntry,
  ModuleCreditsReservation,
  ModuleEntitlementGrant,
  ModuleMeteringAuthorization,
  ModuleRedeemCodeRecord,
  ModuleRedeemCodeRedemption,
  ModuleUsageRecord,
} from '@ploykit/module-sdk';
import type { ModuleRuntimeAccessSession } from '../../module-runtime/security';
import type {
  RuntimeStore,
  RuntimeStoreCommercialOrder,
  RuntimeStoreCreditLedgerEntry,
  RuntimeStoreCreditReservation,
  RuntimeStoreEntitlementGrant,
  RuntimeStoreEntitlementStatus,
  RuntimeStoreInvoiceRecord,
  RuntimeStoreRedeemCode,
  RuntimeStoreRedeemRedemption,
  RuntimeStoreSubscriptionEventType,
  RuntimeStoreSubscriptionStatus,
  RuntimeStoreTaxProfileRecord,
} from '../../module-runtime/stores';
import type { CommercialSkuDefinition } from './commercial-ledger-types';

export function toUsageRecord(
  record: Awaited<ReturnType<RuntimeStore['recordUsage']>>
): ModuleUsageRecord {
  return {
    id: record.id,
    moduleId: record.moduleId,
    meter: record.meter,
    quantity: record.quantity,
    unit: record.unit,
    idempotencyKey: record.idempotencyKey,
    metadata: record.metadata,
    createdAt: record.createdAt,
  };
}

export function toMeteringAuthorization(
  record: Awaited<ReturnType<RuntimeStore['recordMetering']>>
): ModuleMeteringAuthorization {
  return {
    id: record.id,
    moduleId: record.moduleId,
    meter: record.meter,
    quantity: record.quantity,
    unit: record.unit,
    status: record.status,
    idempotencyKey: record.idempotencyKey,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function toCheckout(order: RuntimeStoreCommercialOrder): ModuleCommerceCheckout {
  const subject = subjectFromStoredUserId(order.userId);
  return {
    id: order.id,
    userId: order.userId,
    buyer: subject,
    beneficiary: subject,
    sku: order.sku,
    amount: order.amount,
    currency: order.currency,
    status: order.status,
    idempotencyKey: order.idempotencyKey,
    createdAt: order.createdAt,
  };
}

export function userSubject(userId: string): CommercialSubject {
  return { type: 'user', id: userId };
}

export function subjectToStoredUserId(subject: CommercialSubject): string {
  return subject.type === 'user' ? subject.id : `${subject.type}:${subject.id}`;
}

export function subjectFromStoredUserId(userId: string): CommercialSubject {
  const [type, ...idParts] = userId.split(':');
  if (
    (type === 'workspace' || type === 'organization' || type === 'apiKey') &&
    idParts.length > 0
  ) {
    return { type, id: idParts.join(':') };
  }

  return userSubject(userId);
}

export function subjectFromCommercialInput(input: {
  subject?: CommercialSubject;
  userId?: string;
}): CommercialSubject {
  return input.subject ?? userSubject(input.userId ?? 'anonymous');
}

export function toCreditBalance(balance: {
  userId: string;
  unit: string;
  balance: number;
}): ModuleCreditsBalance {
  const subject = subjectFromStoredUserId(balance.userId);
  return {
    subject,
    userId: subject.type === 'user' ? subject.id : balance.userId,
    unit: balance.unit,
    balance: balance.balance,
  };
}

export function creditLedgerDirection(
  record: RuntimeStoreCreditLedgerEntry
): ModuleCreditsLedgerEntry['direction'] {
  if (record.reason.includes('refund_revoke')) {
    return 'revoke';
  }
  if (record.reason.includes('expired')) {
    return 'release';
  }
  if (record.reason.includes('release')) {
    return 'release';
  }
  if (record.reason.includes('overage')) {
    return record.amount < 0 ? 'consume' : 'grant';
  }
  if (record.reason.includes('refund')) {
    return 'refund';
  }
  if (record.reason.includes('adjust')) {
    return 'adjust';
  }
  if (record.reason.includes('revoke')) {
    return 'revoke';
  }
  if (record.reason.includes('reserve')) {
    return 'reserve';
  }
  return record.amount < 0 ? 'consume' : 'grant';
}

export function creditLedgerStatus(
  record: RuntimeStoreCreditLedgerEntry
): ModuleCreditsLedgerEntry['status'] {
  if (record.status === 'pending') {
    return 'pending';
  }
  if (record.status === 'expired') {
    return 'expired';
  }
  if (record.status === 'void') {
    return 'void';
  }
  return 'available';
}

export function toCreditLedgerEntry(
  record: RuntimeStoreCreditLedgerEntry
): ModuleCreditsLedgerEntry {
  const subject = subjectFromStoredUserId(record.userId);
  return {
    id: record.id,
    subject,
    amount: record.amount,
    unit: record.unit,
    direction: creditLedgerDirection(record),
    status: creditLedgerStatus(record),
    reason: record.reason,
    source: typeof record.metadata.source === 'string' ? record.metadata.source : undefined,
    sourceId: typeof record.metadata.sourceId === 'string' ? record.metadata.sourceId : undefined,
    reservationId:
      typeof record.metadata.reservationId === 'string' ? record.metadata.reservationId : undefined,
    idempotencyKey: record.idempotencyKey,
    expiresAt: record.expiresAt,
    metadata: record.metadata,
    createdAt: record.createdAt,
  };
}

export function toCreditsReservation(
  record: RuntimeStoreCreditReservation
): ModuleCreditsReservation {
  return {
    id: record.id,
    subject: subjectFromStoredUserId(record.userId),
    amountReserved: record.amountReserved,
    amountCommitted: record.amountCommitted,
    unit: record.unit,
    status: record.status,
    source: record.source,
    sourceId: record.sourceId,
    idempotencyKey: record.idempotencyKey,
    expiresAt: record.expiresAt,
    metadata: record.metadata,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function toEntitlementGrant(record: RuntimeStoreEntitlementGrant): ModuleEntitlementGrant {
  const subject = subjectFromStoredUserId(record.userId);
  return {
    id: record.id,
    subject,
    userId: subject.type === 'user' ? subject.id : record.userId,
    entitlement: record.entitlement,
    planId: record.planId,
    source: record.source,
    status: record.status,
    idempotencyKey: record.idempotencyKey,
    expiresAt: record.expiresAt,
    metadata: record.metadata,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function toRedeemCodeRecord(
  record: RuntimeStoreRedeemCode,
  now: () => Date = () => new Date()
): ModuleRedeemCodeRecord {
  const storedStatus =
    typeof record.metadata.status === 'string'
      ? (record.metadata.status as ModuleRedeemCodeRecord['status'])
      : undefined;
  const status =
    storedStatus === 'frozen' || storedStatus === 'revoked'
      ? storedStatus
      : isExpired(record.expiresAt, now)
        ? 'expired'
        : (storedStatus ?? 'active');
  return {
    id: `${record.productId}:${record.code}`,
    maskedCode:
      typeof record.metadata.maskedCode === 'string'
        ? record.metadata.maskedCode
        : maskRedeemCode(record.code),
    prefix:
      typeof record.metadata.prefix === 'string'
        ? record.metadata.prefix
        : record.code.includes('_')
          ? record.code.split('_')[0]
          : undefined,
    entitlement: record.entitlement,
    credits: record.creditsAmount
      ? { amount: record.creditsAmount, unit: record.creditsUnit }
      : undefined,
    maxRedemptions: record.maxRedemptions,
    status,
    expiresAt: record.expiresAt,
    metadata: record.metadata,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function toRedeemCodeRedemption(
  record: RuntimeStoreRedeemRedemption
): ModuleRedeemCodeRedemption {
  const subject = subjectFromStoredUserId(record.userId);
  return {
    id: record.id,
    code: record.code,
    subject,
    entitlement: record.entitlement,
    credits: record.creditsAmount
      ? { amount: record.creditsAmount, unit: record.creditsUnit }
      : undefined,
    idempotencyKey: record.idempotencyKey,
    metadata: record.metadata,
    createdAt: record.createdAt,
  };
}

export function maskRedeemCode(code: string): string {
  if (code.length <= 8) {
    return `${code.slice(0, 2)}****`;
  }
  return `${code.slice(0, 4)}****${code.slice(-4)}`;
}

export function hashRedeemCode(code: string): string {
  return createHash('sha256').update(code.trim()).digest('hex');
}

export function normalizedEmail(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined;
}

export function maskedEmail(value: string): string {
  const [local = '', domain = ''] = value.split('@');
  if (!domain) {
    return '***';
  }
  return `${local.slice(0, 1)}***@${domain}`;
}

export function redeemAttemptEmailMetadata(email: unknown): Record<string, string> {
  const normalized = normalizedEmail(email);
  if (!normalized) {
    return {};
  }
  return {
    contactHash: createHash('sha256').update(normalized).digest('hex'),
    contactMasked: maskedEmail(normalized),
  };
}

export function assertAdmin(session: ModuleRuntimeAccessSession): void {
  if (session.system || session.user?.role === 'admin') {
    return;
  }
  throw new Error('MODULE_COMMERCIAL_ADMIN_REQUIRED');
}

export function isExpired(expiresAt: string | undefined, now: () => Date): boolean {
  return Boolean(expiresAt && new Date(expiresAt).getTime() <= now().getTime());
}

export function normalizeRuntimeStoreEntitlementGrant(
  grant: RuntimeStoreEntitlementGrant,
  now: () => Date = () => new Date()
): RuntimeStoreEntitlementGrant {
  if (grant.status !== 'active' || !isExpired(grant.expiresAt, now)) {
    return grant;
  }
  return { ...grant, status: 'expired' };
}

export function assertPositive(amount: number, operation: string): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`MODULE_COMMERCIAL_INVALID_AMOUNT: ${operation}`);
  }
}

export function assertNonNegative(amount: number, operation: string): void {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`MODULE_COMMERCIAL_INVALID_AMOUNT: ${operation}`);
  }
}

export function assertIntegerAmount(amount: number, operation: string): void {
  if (!Number.isSafeInteger(amount)) {
    throw new Error(`MODULE_COMMERCIAL_INVALID_AMOUNT: ${operation} must be a safe integer`);
  }
}

export function assertPositiveIntegerAmount(amount: number, operation: string): void {
  assertPositive(amount, operation);
  assertIntegerAmount(amount, operation);
}

export function assertNonNegativeIntegerAmount(amount: number, operation: string): void {
  assertNonNegative(amount, operation);
  assertIntegerAmount(amount, operation);
}

export function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function isRedeemSensitiveMetadataKey(key: string): boolean {
  const normalized = key.replace(/[\s_-]/g, '').toLowerCase();
  return (
    [
      'bind',
      'rawcode',
      'codehash',
      'contacthash',
      'email',
      'phone',
      'apikey',
      'secret',
      'token',
      'password',
      'authorization',
      'signature',
    ].includes(normalized) ||
    normalized.endsWith('email') ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('token')
  );
}

export function redeemRedemptionMetadata(value: unknown): Record<string, unknown> {
  const redact = (item: unknown): unknown => {
    if (Array.isArray(item)) {
      return item.map(redact);
    }
    if (!item || typeof item !== 'object') {
      return item;
    }
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>).map(([key, nested]) => [
        key,
        isRedeemSensitiveMetadataKey(key) ? '[REDACTED]' : redact(nested),
      ])
    );
  };
  return metadataObject(redact(value));
}

export function sameSubject(left: CommercialSubject, right: CommercialSubject): boolean {
  return left.type === right.type && left.id === right.id;
}

export function subjectFromMetadata(value: unknown): CommercialSubject | null {
  const record = metadataObject(value);
  const type = record.type;
  const id = record.id;
  if (
    (type === 'user' || type === 'workspace' || type === 'organization' || type === 'apiKey') &&
    typeof id === 'string' &&
    id.length > 0
  ) {
    return { type, id };
  }
  return null;
}

export function redeemBindStatus(
  bind: unknown,
  input: { subject: CommercialSubject; email?: string }
): { ok: true } | { ok: false; reason: string } {
  const record = metadataObject(bind);
  const expectedEmail = normalizedEmail(record.email);
  if (expectedEmail && normalizedEmail(input.email) !== expectedEmail) {
    return { ok: false, reason: 'email_binding_mismatch' };
  }

  const expectedSubject = subjectFromMetadata(record.subject);
  if (expectedSubject && !sameSubject(expectedSubject, input.subject)) {
    return { ok: false, reason: 'subject_binding_mismatch' };
  }

  const subjectType = record.subjectType;
  const subjectId = record.subjectId;
  if (
    (subjectType === 'user' ||
      subjectType === 'workspace' ||
      subjectType === 'organization' ||
      subjectType === 'apiKey') &&
    typeof subjectId === 'string' &&
    !sameSubject({ type: subjectType, id: subjectId }, input.subject)
  ) {
    return { ok: false, reason: 'subject_binding_mismatch' };
  }

  if (
    typeof record.userId === 'string' &&
    (input.subject.type !== 'user' || input.subject.id !== record.userId)
  ) {
    return { ok: false, reason: 'user_binding_mismatch' };
  }
  if (
    typeof record.workspaceId === 'string' &&
    (input.subject.type !== 'workspace' || input.subject.id !== record.workspaceId)
  ) {
    return { ok: false, reason: 'workspace_binding_mismatch' };
  }
  if (
    typeof record.organizationId === 'string' &&
    (input.subject.type !== 'organization' || input.subject.id !== record.organizationId)
  ) {
    return { ok: false, reason: 'organization_binding_mismatch' };
  }

  return { ok: true };
}

export function uniqueEntitlements(
  sku: CommercialSkuDefinition | undefined,
  planCatalog: readonly ModuleBillingPlan[]
): string[] {
  const entitlements = new Set<string>();
  if (sku?.entitlement) {
    entitlements.add(sku.entitlement);
  }
  for (const entitlement of sku?.entitlements ?? []) {
    entitlements.add(entitlement);
  }
  const plan = sku?.planId ? planCatalog.find((candidate) => candidate.id === sku.planId) : null;
  for (const entitlement of plan?.entitlements ?? []) {
    entitlements.add(entitlement);
  }
  return [...entitlements];
}

export function bucketDate(value: string): string {
  return value.slice(0, 10);
}

export function orderInvoiceNumber(order: RuntimeStoreCommercialOrder): string {
  return `PK-${order.createdAt.slice(0, 10).replaceAll('-', '')}-${order.id.slice(-6)}`;
}

export function isWithinPeriod(value: string, start: string, end: string): boolean {
  const time = new Date(value).getTime();
  return time >= new Date(start).getTime() && time <= new Date(end).getTime();
}

export function isRevenueInvoice(invoice: RuntimeStoreInvoiceRecord): boolean {
  return Boolean(invoice.paidAt) && (invoice.status === 'paid' || invoice.status === 'refunded');
}

export function aggregateProvider(values: readonly (string | null | undefined)[]): string | null {
  const providers = new Set(values.filter((value): value is string => Boolean(value)));
  if (providers.size === 0) {
    return null;
  }
  if (providers.size === 1) {
    return providers.values().next().value ?? null;
  }
  return 'mixed';
}

export function subscriptionStatusForEvent(
  type: RuntimeStoreSubscriptionEventType,
  override: RuntimeStoreSubscriptionStatus | undefined
): RuntimeStoreSubscriptionStatus {
  if (override) {
    return override;
  }
  if (type === 'trial_started') {
    return 'trialing';
  }
  if (type === 'past_due') {
    return 'past_due';
  }
  if (type === 'paused') {
    return 'paused';
  }
  if (type === 'canceled') {
    return 'canceled';
  }
  return 'active';
}

export function timestampToMillis(value?: string | null): number | null {
  if (!value) {
    return null;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function normalizeJurisdiction(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{2}(-[A-Z0-9]{1,8})?$/.test(normalized)) {
    throw new Error(`MODULE_COMMERCIAL_TAX_JURISDICTION_INVALID: ${value}`);
  }
  return normalized;
}

export function taxValidationStatus(
  profile: Record<string, unknown> | undefined
): 'valid' | 'invalid' {
  const taxId = profile?.taxId ?? profile?.vatId ?? profile?.businessId;
  if (typeof taxId === 'string' && taxId.trim().length >= 4) {
    return 'valid';
  }
  return 'invalid';
}

export function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function stringMetadata(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function maskTaxIdentifier(value: unknown): string | undefined {
  const normalized = stringMetadata(value)?.replace(/\s+/g, '');
  return normalized ? `***${normalized.slice(-4)}` : undefined;
}

export function createInvoiceTaxSnapshot(input: {
  taxProfile: RuntimeStoreTaxProfileRecord | null;
  hostUserMetadata?: Record<string, unknown>;
  capturedAt: string;
}): Record<string, unknown> {
  const hostTaxProfile = metadataRecord(metadataRecord(input.hostUserMetadata?.billing).taxProfile);
  const runtimeTaxProfile = metadataRecord(input.taxProfile?.profile);
  const profile = { ...hostTaxProfile, ...runtimeTaxProfile };
  const taxId =
    profile.taxId ??
    profile.vatId ??
    profile.businessId ??
    input.taxProfile?.metadata.taxId ??
    input.taxProfile?.metadata.vatId;
  const snapshot: Record<string, unknown> = {
    source: input.taxProfile
      ? 'runtime-store'
      : Object.keys(profile).length > 0
        ? 'host-user-metadata'
        : 'none',
    capturedAt: input.capturedAt,
    status: input.taxProfile?.status ?? 'draft',
    validationStatus: input.taxProfile?.validationStatus ?? 'unverified',
  };
  if (input.taxProfile?.id) {
    snapshot.taxProfileId = input.taxProfile.id;
  }
  if (input.taxProfile?.jurisdiction) {
    snapshot.jurisdiction = input.taxProfile.jurisdiction;
  }
  const company = stringMetadata(profile.company);
  if (company) {
    snapshot.company = company;
  }
  const country = stringMetadata(profile.country);
  if (country) {
    snapshot.country = country;
  }
  const taxIdMasked = maskTaxIdentifier(taxId);
  if (taxIdMasked) {
    snapshot.taxIdMasked = taxIdMasked;
  }
  if (input.taxProfile?.updatedAt) {
    snapshot.taxProfileUpdatedAt = input.taxProfile.updatedAt;
  }
  return snapshot;
}
