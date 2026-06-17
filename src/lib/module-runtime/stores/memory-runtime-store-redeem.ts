import type {
  RuntimeStore,
  RuntimeStoreRedeemCode,
  RuntimeStoreRedeemRedemption,
} from './runtime-store-types';

type InMemoryRedeemRuntimeStore = Pick<
  RuntimeStore,
  | 'upsertRedeemCode'
  | 'getRedeemCode'
  | 'updateRedeemCodeStatus'
  | 'listRedeemCodes'
  | 'recordRedeemRedemption'
  | 'listRedeemRedemptions'
>;

interface CreateInMemoryRedeemRuntimeStoreInput {
  now: () => Date;
  createId: (prefix: string) => string;
}

function iso(now: () => Date): string {
  return now().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createInMemoryRedeemRuntimeStore({
  now,
  createId,
}: CreateInMemoryRedeemRuntimeStoreInput): InMemoryRedeemRuntimeStore {
  const redeemCodes = new Map<string, RuntimeStoreRedeemCode>();
  const redemptions = new Map<string, RuntimeStoreRedeemRedemption>();
  const redemptionIdempotency = new Map<string, string>();

  return {
    async upsertRedeemCode(input) {
      const timestamp = iso(now);
      const existing = redeemCodes.get(`${input.productId}:${input.code}`);
      const code: RuntimeStoreRedeemCode = {
        productId: input.productId,
        code: input.code,
        entitlement: input.entitlement,
        creditsAmount: input.creditsAmount,
        creditsUnit: input.creditsUnit,
        maxRedemptions: input.maxRedemptions,
        expiresAt: input.expiresAt,
        metadata: input.metadata ?? {},
        createdAt: input.createdAt ?? existing?.createdAt ?? timestamp,
        updatedAt: input.updatedAt ?? timestamp,
      };
      redeemCodes.set(`${code.productId}:${code.code}`, code);
      return clone(code);
    },
    async getRedeemCode(productId, code) {
      const record = redeemCodes.get(`${productId}:${code}`);
      return record ? clone(record) : null;
    },
    async updateRedeemCodeStatus(input) {
      const key = `${input.productId}:${input.code}`;
      const record = redeemCodes.get(key);
      if (!record) {
        throw new Error(`RUNTIME_STORE_REDEEM_CODE_NOT_FOUND: ${input.code}`);
      }
      const next: RuntimeStoreRedeemCode = {
        ...record,
        metadata: {
          ...record.metadata,
          ...(input.metadata ?? {}),
          status: input.status,
        },
        updatedAt: iso(now),
      };
      redeemCodes.set(key, next);
      return clone(next);
    },
    async listRedeemCodes(query = {}) {
      return [...redeemCodes.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) =>
            !query.batchId ||
            (typeof record.metadata.batchId === 'string' &&
              record.metadata.batchId === query.batchId)
        )
        .filter((record) => {
          if (!query.status) {
            return true;
          }
          const status =
            typeof record.metadata.status === 'string' ? record.metadata.status : 'active';
          return status === query.status;
        })
        .map((record) => clone(record));
    },
    async recordRedeemRedemption(input) {
      const userCodeKey = `${input.productId}:${input.code}:${input.userId}`;
      const existing = [...redemptions.values()].find(
        (record) => `${record.productId}:${record.code}:${record.userId}` === userCodeKey
      );
      if (existing) {
        return clone(existing);
      }
      const key = input.idempotencyKey
        ? `${input.productId}:${input.userId}:${input.idempotencyKey}`
        : null;
      if (key) {
        const existingId = redemptionIdempotency.get(key);
        if (existingId) {
          return clone(redemptions.get(existingId)!);
        }
      }
      if (input.maxRedemptions) {
        const redemptionCount = [...redemptions.values()].filter(
          (record) => record.productId === input.productId && record.code === input.code
        ).length;
        if (redemptionCount >= input.maxRedemptions) {
          throw new Error('MODULE_REDEEM_CODE_REDEMPTION_LIMIT_EXCEEDED');
        }
      }
      const redemption: RuntimeStoreRedeemRedemption = {
        id: createId('redemption'),
        productId: input.productId,
        code: input.code,
        userId: input.userId,
        entitlement: input.entitlement,
        creditsAmount: input.creditsAmount,
        creditsUnit: input.creditsUnit,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        createdAt: iso(now),
      };
      redemptions.set(redemption.id, redemption);
      if (key) {
        redemptionIdempotency.set(key, redemption.id);
      }
      return clone(redemption);
    },
    async listRedeemRedemptions(query = {}) {
      return [...redemptions.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter((record) => !query.code || record.code === query.code)
        .filter((record) => !query.userId || record.userId === query.userId)
        .map((record) => clone(record));
    },
  };
}
