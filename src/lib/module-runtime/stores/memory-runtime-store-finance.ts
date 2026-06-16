import type {
  RuntimeStore,
  RuntimeStoreRevenueBucket,
  RuntimeStoreSettlementBatch,
  RuntimeStoreTaxProfileRecord,
} from './runtime-store-types';

type InMemoryFinanceRuntimeStore = Pick<
  RuntimeStore,
  | 'upsertTaxProfile'
  | 'getTaxProfile'
  | 'upsertRevenueBucket'
  | 'listRevenueBuckets'
  | 'upsertSettlementBatch'
  | 'listSettlementBatches'
>;

interface CreateInMemoryFinanceRuntimeStoreInput {
  now: () => Date;
  createId: (prefix: string) => string;
}

function iso(now: () => Date): string {
  return now().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createInMemoryFinanceRuntimeStore({
  now,
  createId,
}: CreateInMemoryFinanceRuntimeStoreInput): InMemoryFinanceRuntimeStore {
  const taxProfiles = new Map<string, RuntimeStoreTaxProfileRecord>();
  const revenueBuckets = new Map<string, RuntimeStoreRevenueBucket>();
  const settlementBatches = new Map<string, RuntimeStoreSettlementBatch>();

  return {
    async upsertTaxProfile(input) {
      const key = `${input.productId}:${input.workspaceId ?? ''}:${input.userId}`;
      const existing = taxProfiles.get(key);
      const timestamp = iso(now);
      const profile: RuntimeStoreTaxProfileRecord = {
        id: existing?.id ?? createId('tax_profile'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        userId: input.userId,
        status: input.status ?? existing?.status ?? 'draft',
        jurisdiction: input.jurisdiction ?? existing?.jurisdiction ?? null,
        validationStatus: input.validationStatus ?? existing?.validationStatus ?? 'unverified',
        profile: { ...(existing?.profile ?? {}), ...(input.profile ?? {}) },
        evidence: { ...(existing?.evidence ?? {}), ...(input.evidence ?? {}) },
        metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      taxProfiles.set(key, profile);
      return clone(profile);
    },
    async getTaxProfile(productId, userId, workspaceId) {
      const profile = taxProfiles.get(`${productId}:${workspaceId ?? ''}:${userId}`);
      return profile ? clone(profile) : null;
    },
    async upsertRevenueBucket(input) {
      const key = `${input.productId}:${input.workspaceId ?? ''}:${input.bucketDate}:${input.currency}`;
      const existing = revenueBuckets.get(key);
      const timestamp = iso(now);
      const bucket: RuntimeStoreRevenueBucket = {
        id: existing?.id ?? createId('revenue_bucket'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        bucketDate: input.bucketDate,
        currency: input.currency,
        gross: input.gross ?? existing?.gross ?? 0,
        discount: input.discount ?? existing?.discount ?? 0,
        tax: input.tax ?? existing?.tax ?? 0,
        refund: input.refund ?? existing?.refund ?? 0,
        fee: input.fee ?? existing?.fee ?? 0,
        net: input.net ?? existing?.net ?? 0,
        orders: input.orders ?? existing?.orders ?? 0,
        provider: input.provider ?? existing?.provider ?? null,
        metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      revenueBuckets.set(key, bucket);
      return clone(bucket);
    },
    async listRevenueBuckets(query = {}) {
      return [...revenueBuckets.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.currency || record.currency === query.currency)
        .filter((record) => !query.from || record.bucketDate >= query.from)
        .filter((record) => !query.to || record.bucketDate <= query.to)
        .sort((left, right) => left.bucketDate.localeCompare(right.bucketDate))
        .map((record) => clone(record));
    },
    async upsertSettlementBatch(input) {
      const id =
        input.id ??
        `${input.productId}:${input.workspaceId ?? ''}:${input.provider}:${input.currency}:${input.periodStart}:${input.periodEnd}`;
      const existing = settlementBatches.get(id);
      const timestamp = iso(now);
      const gross = input.gross ?? existing?.gross ?? 0;
      const refund = input.refund ?? existing?.refund ?? 0;
      const fee = input.fee ?? existing?.fee ?? 0;
      const batch: RuntimeStoreSettlementBatch = {
        id,
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        provider: input.provider,
        currency: input.currency,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        status: input.status ?? existing?.status ?? 'draft',
        gross,
        refund,
        fee,
        net: input.net ?? gross - refund - fee,
        orderCount: input.orderCount ?? existing?.orderCount ?? 0,
        invoiceCount: input.invoiceCount ?? existing?.invoiceCount ?? 0,
        creditNoteCount: input.creditNoteCount ?? existing?.creditNoteCount ?? 0,
        metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      settlementBatches.set(id, batch);
      return clone(batch);
    },
    async listSettlementBatches(query = {}) {
      return [...settlementBatches.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.provider || record.provider === query.provider)
        .filter((record) => !query.currency || record.currency === query.currency)
        .filter((record) => !query.status || record.status === query.status)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((record) => clone(record));
    },
  };
}
