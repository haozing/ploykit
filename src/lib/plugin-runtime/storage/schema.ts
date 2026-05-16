import type {
  PluginCollectionDefinition,
  PluginCollectionField,
  PluginCollectionFieldDefinition,
  PluginStorageFieldOperators,
  PluginStorageQuery,
} from '@ploykit/plugin-sdk';
import { PluginError } from '@ploykit/plugin-sdk';
import type { PluginRecordData } from '@/lib/db/schema/plugin-storage';

export type NormalizedPluginCollectionFieldType =
  | 'string'
  | 'text'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'json';

export interface NormalizedPluginCollectionField {
  name: string;
  type: NormalizedPluginCollectionFieldType;
  required: boolean;
  hasDefault: boolean;
  defaultValue?: unknown;
  maxLength?: number;
  enum?: readonly string[];
}

export interface NormalizedPluginCollectionDefinition {
  fields: Record<string, NormalizedPluginCollectionField>;
  indexes: PluginCollectionDefinition['indexes'];
}

export interface ValidatePluginRecordDataOptions {
  partial?: boolean;
  collectionName?: string;
}

const FIELD_TYPES = new Set<NormalizedPluginCollectionFieldType>([
  'string',
  'text',
  'number',
  'integer',
  'boolean',
  'date',
  'datetime',
  'json',
]);
const QUERY_OPERATOR_KEYS = new Set<keyof PluginStorageFieldOperators>([
  'eq',
  'ne',
  'in',
  'contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'startsWith',
]);
const RUNTIME_QUERY_FIELDS = new Set(['id', 'createdAt', 'updatedAt']);

function createStorageError(
  code: string,
  message: string,
  details?: Record<string, unknown>
): PluginError {
  return new PluginError({
    code,
    message,
    statusCode: 400,
    details,
  });
}

function parseFieldType(type: string): {
  type: NormalizedPluginCollectionFieldType;
  optional: boolean;
} {
  const optional = type.endsWith('?');
  const normalizedType = (
    optional ? type.slice(0, -1) : type
  ) as NormalizedPluginCollectionFieldType;

  if (!FIELD_TYPES.has(normalizedType)) {
    throw createStorageError(
      'PLUGIN_STORAGE_FIELD_TYPE_INVALID',
      `Unsupported field type "${type}".`,
      {
        type,
      }
    );
  }

  return {
    type: normalizedType,
    optional,
  };
}

function cloneDefaultValue(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isOperatorObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || value instanceof Date) {
    return false;
  }

  return Object.keys(value).some((key) =>
    QUERY_OPERATOR_KEYS.has(key as keyof PluginStorageFieldOperators)
  );
}

function fieldTypeForQuery(
  collection: NormalizedPluginCollectionDefinition,
  fieldName: string,
  collectionName?: string
): NormalizedPluginCollectionFieldType | 'runtime' {
  if (RUNTIME_QUERY_FIELDS.has(fieldName)) {
    return 'runtime';
  }

  const field = collection.fields[fieldName];
  if (!field) {
    throw createStorageError(
      'PLUGIN_STORAGE_QUERY_FIELD_UNKNOWN',
      `Query field "${fieldName}" is not declared for collection "${collectionName ?? 'unknown'}".`,
      { collection: collectionName, field: fieldName }
    );
  }

  return field.type;
}

function assertOperatorAllowed(
  operator: string,
  fieldName: string,
  fieldType: NormalizedPluginCollectionFieldType | 'runtime',
  collectionName?: string
): void {
  if (!QUERY_OPERATOR_KEYS.has(operator as keyof PluginStorageFieldOperators)) {
    throw createStorageError(
      'PLUGIN_STORAGE_QUERY_OPERATOR_UNKNOWN',
      `Storage query operator "${operator}" is not supported.`,
      { collection: collectionName, field: fieldName, operator }
    );
  }

  if (
    operator === 'startsWith' &&
    fieldType !== 'runtime' &&
    fieldType !== 'string' &&
    fieldType !== 'text'
  ) {
    throw createStorageError(
      'PLUGIN_STORAGE_QUERY_OPERATOR_INVALID',
      `Operator "startsWith" can only be used on string or text fields.`,
      { collection: collectionName, field: fieldName, fieldType }
    );
  }

  if (
    operator === 'contains' &&
    fieldType !== 'string' &&
    fieldType !== 'text' &&
    fieldType !== 'json'
  ) {
    throw createStorageError(
      'PLUGIN_STORAGE_QUERY_OPERATOR_INVALID',
      `Operator "contains" can only be used on string, text, or json fields.`,
      { collection: collectionName, field: fieldName, fieldType }
    );
  }
}

function isJsonSerializable(value: unknown): boolean {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return false;
  }

  if (typeof value === 'bigint') {
    return false;
  }

  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function normalizeDate(value: unknown, fieldName: string): string {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    throw createStorageError(
      'PLUGIN_STORAGE_FIELD_TYPE_INVALID',
      `Field "${fieldName}" must be a valid date value.`,
      { field: fieldName }
    );
  }

  return date.toISOString().slice(0, 10);
}

function normalizeDateTime(value: unknown, fieldName: string): string {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    throw createStorageError(
      'PLUGIN_STORAGE_FIELD_TYPE_INVALID',
      `Field "${fieldName}" must be a valid datetime value.`,
      { field: fieldName }
    );
  }

  return date.toISOString();
}

function normalizeFieldValue(
  field: NormalizedPluginCollectionField,
  value: unknown,
  collectionName?: string
): unknown {
  if (value === null) {
    if (field.required) {
      throw createStorageError(
        'PLUGIN_STORAGE_FIELD_REQUIRED',
        `Field "${field.name}" is required and cannot be null.`,
        { collection: collectionName, field: field.name }
      );
    }

    return null;
  }

  if (value === undefined) {
    throw createStorageError(
      'PLUGIN_STORAGE_FIELD_UNDEFINED',
      `Field "${field.name}" cannot be undefined.`,
      { collection: collectionName, field: field.name }
    );
  }

  switch (field.type) {
    case 'string':
    case 'text': {
      if (typeof value !== 'string') {
        throw createStorageError(
          'PLUGIN_STORAGE_FIELD_TYPE_INVALID',
          `Field "${field.name}" must be a string.`,
          { collection: collectionName, field: field.name }
        );
      }

      if (field.maxLength !== undefined && value.length > field.maxLength) {
        throw createStorageError(
          'PLUGIN_STORAGE_FIELD_MAX_LENGTH_EXCEEDED',
          `Field "${field.name}" exceeds maxLength ${field.maxLength}.`,
          { collection: collectionName, field: field.name, maxLength: field.maxLength }
        );
      }

      if (field.enum && !field.enum.includes(value)) {
        throw createStorageError(
          'PLUGIN_STORAGE_FIELD_ENUM_INVALID',
          `Field "${field.name}" must be one of: ${field.enum.join(', ')}.`,
          { collection: collectionName, field: field.name, enum: field.enum }
        );
      }

      return value;
    }

    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw createStorageError(
          'PLUGIN_STORAGE_FIELD_TYPE_INVALID',
          `Field "${field.name}" must be a finite number.`,
          { collection: collectionName, field: field.name }
        );
      }

      return value;

    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw createStorageError(
          'PLUGIN_STORAGE_FIELD_TYPE_INVALID',
          `Field "${field.name}" must be an integer.`,
          { collection: collectionName, field: field.name }
        );
      }

      return value;

    case 'boolean':
      if (typeof value !== 'boolean') {
        throw createStorageError(
          'PLUGIN_STORAGE_FIELD_TYPE_INVALID',
          `Field "${field.name}" must be a boolean.`,
          { collection: collectionName, field: field.name }
        );
      }

      return value;

    case 'date':
      return normalizeDate(value, field.name);

    case 'datetime':
      return normalizeDateTime(value, field.name);

    case 'json':
      if (!isJsonSerializable(value)) {
        throw createStorageError(
          'PLUGIN_STORAGE_FIELD_TYPE_INVALID',
          `Field "${field.name}" must be JSON serializable.`,
          { collection: collectionName, field: field.name }
        );
      }

      return value;
  }
}

export function normalizeCollectionField(
  name: string,
  field: PluginCollectionField
): NormalizedPluginCollectionField {
  const definition: PluginCollectionFieldDefinition =
    typeof field === 'string' ? { type: field } : field;
  const { type, optional } = parseFieldType(definition.type);
  const hasDefault = Object.prototype.hasOwnProperty.call(definition, 'default');
  const required = definition.required ?? (!optional && !hasDefault);

  return {
    name,
    type,
    required,
    hasDefault,
    defaultValue: definition.default,
    maxLength: definition.maxLength,
    enum: definition.enum,
  };
}

export function normalizeCollectionDefinition(
  collection: PluginCollectionDefinition
): NormalizedPluginCollectionDefinition {
  const fields = Object.fromEntries(
    Object.entries(collection.fields).map(([name, field]) => [
      name,
      normalizeCollectionField(name, field),
    ])
  );

  return {
    fields,
    indexes: collection.indexes ?? [],
  };
}

export function validatePluginRecordData(
  collection: PluginCollectionDefinition,
  data: Record<string, unknown>,
  options: ValidatePluginRecordDataOptions = {}
): PluginRecordData {
  if (!isRecord(data)) {
    throw createStorageError(
      'PLUGIN_STORAGE_RECORD_INVALID',
      'Storage record data must be an object.',
      {
        collection: options.collectionName,
      }
    );
  }

  const normalizedCollection = normalizeCollectionDefinition(collection);
  const output: PluginRecordData = {};

  for (const fieldName of Object.keys(data)) {
    const field = normalizedCollection.fields[fieldName];
    if (!field) {
      throw createStorageError(
        'PLUGIN_STORAGE_FIELD_UNKNOWN',
        `Unknown field "${fieldName}" for collection "${options.collectionName ?? 'unknown'}".`,
        { collection: options.collectionName, field: fieldName }
      );
    }

    output[fieldName] = normalizeFieldValue(field, data[fieldName], options.collectionName);
  }

  if (!options.partial) {
    for (const field of Object.values(normalizedCollection.fields)) {
      if (Object.prototype.hasOwnProperty.call(output, field.name)) {
        continue;
      }

      if (field.hasDefault) {
        output[field.name] = cloneDefaultValue(field.defaultValue);
        continue;
      }

      if (field.required) {
        throw createStorageError(
          'PLUGIN_STORAGE_FIELD_REQUIRED',
          `Field "${field.name}" is required.`,
          { collection: options.collectionName, field: field.name }
        );
      }
    }
  }

  return output;
}

export function validatePluginStorageQuery(
  collection: PluginCollectionDefinition,
  query: PluginStorageQuery | undefined,
  options: { collectionName?: string } = {}
): void {
  if (!query) {
    return;
  }

  const normalizedCollection = normalizeCollectionDefinition(collection);

  for (const [fieldName, filter] of Object.entries(query.where ?? {})) {
    const fieldType = fieldTypeForQuery(normalizedCollection, fieldName, options.collectionName);

    if (!isOperatorObject(filter)) {
      continue;
    }

    for (const operator of Object.keys(filter)) {
      assertOperatorAllowed(operator, fieldName, fieldType, options.collectionName);
    }
  }

  for (const fieldName of Object.keys(query.orderBy ?? {})) {
    fieldTypeForQuery(normalizedCollection, fieldName, options.collectionName);
  }
}
