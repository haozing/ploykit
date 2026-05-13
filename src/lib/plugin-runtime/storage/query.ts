import {
  PluginError,
  type PluginStorageFieldOperators,
  type PluginStorageFilterValue,
  type PluginStorageQuery,
  type PluginStorageScalar,
} from '@ploykit/plugin-sdk';
import type { PluginRecordData } from '@/lib/db/schema/plugin-storage';

export interface QueryablePluginStorageRecord {
  id: string;
  data: PluginRecordData;
  createdAt: Date;
  updatedAt: Date;
}

export interface NormalizedPluginStorageQuery {
  where: Record<string, PluginStorageFilterValue>;
  orderBy: Record<string, 'asc' | 'desc'>;
  limit: number;
  offset: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function createQueryError(message: string, details?: Record<string, unknown>): PluginError {
  return new PluginError({
    code: 'PLUGIN_STORAGE_QUERY_INVALID',
    message,
    statusCode: 400,
    details,
  });
}

function isOperatorObject(value: PluginStorageFilterValue): value is PluginStorageFieldOperators {
  if (!value || typeof value !== 'object' || value instanceof Date || Array.isArray(value)) {
    return false;
  }

  return ['eq', 'ne', 'in', 'contains', 'gt', 'gte', 'lt', 'lte', 'startsWith'].some((operator) =>
    Object.prototype.hasOwnProperty.call(value, operator)
  );
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIMIT;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw createQueryError('Storage query limit must be a positive integer.', { limit });
  }

  return Math.min(limit, MAX_LIMIT);
}

function normalizeOffset(offset: number | undefined): number {
  if (offset === undefined) {
    return 0;
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw createQueryError('Storage query offset must be a non-negative integer.', { offset });
  }

  return offset;
}

export function normalizePluginStorageQuery(
  query: PluginStorageQuery | undefined
): NormalizedPluginStorageQuery {
  return {
    where: query?.where ?? {},
    orderBy: query?.orderBy ?? {},
    limit: normalizeLimit(query?.limit),
    offset: normalizeOffset(query?.offset),
  };
}

function readFieldValue(record: QueryablePluginStorageRecord, field: string): unknown {
  if (field === 'id') {
    return record.id;
  }

  if (field === 'createdAt') {
    return record.createdAt;
  }

  if (field === 'updatedAt') {
    return record.updatedAt;
  }

  return record.data[field];
}

function toComparable(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'string') {
    const parsedDate = new Date(value);
    if (!Number.isNaN(parsedDate.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      return parsedDate.getTime();
    }

    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return JSON.stringify(value);
}

function scalarEquals(actual: unknown, expected: PluginStorageScalar): boolean {
  return toComparable(actual) === toComparable(expected);
}

function compare(actual: unknown, expected: unknown): number {
  const actualValue = toComparable(actual);
  const expectedValue = toComparable(expected);

  if (actualValue === null && expectedValue === null) {
    return 0;
  }

  if (actualValue === null) {
    return -1;
  }

  if (expectedValue === null) {
    return 1;
  }

  if (actualValue < expectedValue) {
    return -1;
  }

  if (actualValue > expectedValue) {
    return 1;
  }

  return 0;
}

function matchesOperator(actual: unknown, operators: PluginStorageFieldOperators): boolean {
  if (operators.eq !== undefined && !scalarEquals(actual, operators.eq)) {
    return false;
  }

  if (operators.ne !== undefined && scalarEquals(actual, operators.ne)) {
    return false;
  }

  if (
    operators.in !== undefined &&
    !operators.in.some((expected) => scalarEquals(actual, expected))
  ) {
    return false;
  }

  if (operators.contains !== undefined) {
    if (typeof actual === 'string') {
      if (!actual.includes(String(operators.contains))) {
        return false;
      }
    } else if (Array.isArray(actual)) {
      if (!actual.some((item) => scalarEquals(item, operators.contains ?? null))) {
        return false;
      }
    } else {
      return false;
    }
  }

  if (operators.gt !== undefined && compare(actual, operators.gt) <= 0) {
    return false;
  }

  if (operators.gte !== undefined && compare(actual, operators.gte) < 0) {
    return false;
  }

  if (operators.lt !== undefined && compare(actual, operators.lt) >= 0) {
    return false;
  }

  if (operators.lte !== undefined && compare(actual, operators.lte) > 0) {
    return false;
  }

  if (operators.startsWith !== undefined) {
    if (typeof actual !== 'string' || !actual.startsWith(operators.startsWith)) {
      return false;
    }
  }

  return true;
}

export function matchesPluginStorageQuery(
  record: QueryablePluginStorageRecord,
  query: PluginStorageQuery | undefined
): boolean {
  const normalized = normalizePluginStorageQuery(query);

  for (const [field, filter] of Object.entries(normalized.where)) {
    const actual = readFieldValue(record, field);

    if (isOperatorObject(filter)) {
      if (!matchesOperator(actual, filter)) {
        return false;
      }
      continue;
    }

    if (!scalarEquals(actual, filter)) {
      return false;
    }
  }

  return true;
}

export function applyPluginStorageQuery<TRecord extends QueryablePluginStorageRecord>(
  records: readonly TRecord[],
  query: PluginStorageQuery | undefined
): TRecord[] {
  const normalized = normalizePluginStorageQuery(query);
  const filtered = records.filter((record) => matchesPluginStorageQuery(record, query));
  const orderEntries = Object.entries(normalized.orderBy);

  if (orderEntries.length > 0) {
    filtered.sort((left, right) => {
      for (const [field, direction] of orderEntries) {
        const result = compare(readFieldValue(left, field), readFieldValue(right, field));
        if (result !== 0) {
          return direction === 'asc' ? result : -result;
        }
      }

      return 0;
    });
  }

  return filtered.slice(normalized.offset, normalized.offset + normalized.limit);
}
