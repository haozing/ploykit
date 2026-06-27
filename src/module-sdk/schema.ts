import type { ModuleSchemaDefinition, ModuleSchemaFieldDefinition } from './types';

type FieldValue<TField extends ModuleSchemaFieldDefinition> =
  TField['type'] extends 'number' | 'integer'
    ? number
    : TField['type'] extends 'boolean'
      ? boolean
      : TField['type'] extends 'json'
        ? unknown
        : string;

type FieldOutput<TField extends ModuleSchemaFieldDefinition> =
  TField['array'] extends true
    ? FieldValue<TField>[]
    : TField['required'] extends true
      ? FieldValue<TField>
      : FieldValue<TField> | null;

export type InferSchema<TSchema extends ModuleSchemaDefinition> = {
  [K in keyof TSchema['fields']]: FieldOutput<TSchema['fields'][K]>;
};

export interface ModuleJsonSchema {
  $schema: 'https://json-schema.org/draft/2020-12/schema';
  $id?: string;
  type: 'object';
  title?: string;
  description?: string;
  additionalProperties: false;
  properties: Record<string, unknown>;
  required?: string[];
}

export function schema(definition: Omit<ModuleSchemaDefinition, '$$type'>): ModuleSchemaDefinition {
  return Object.freeze({
    ...definition,
    $$type: 'ploykit.schema',
    fields: Object.freeze({ ...definition.fields }),
  });
}

function field(
  type: ModuleSchemaFieldDefinition['type'],
  options: Omit<ModuleSchemaFieldDefinition, 'type'> = {}
): ModuleSchemaFieldDefinition {
  return Object.freeze({ type, ...options });
}

function schemaFieldToJsonSchema(field: ModuleSchemaFieldDefinition): unknown {
  const jsonSchema: Record<string, unknown> = {};
  if (field.description) {
    jsonSchema.description = field.description;
  }
  if (Array.isArray(field.enum) && field.enum.length > 0) {
    jsonSchema.enum = [...field.enum];
  }
  if (typeof field.maxLength === 'number') {
    jsonSchema.maxLength = field.maxLength;
  }
  if (typeof field.min === 'number') {
    jsonSchema.minimum = field.min;
  }
  if (typeof field.max === 'number') {
    jsonSchema.maximum = field.max;
  }
  if ('default' in field) {
    jsonSchema.default = field.default;
  }

  const baseType =
    {
      string: 'string',
      text: 'string',
      number: 'number',
      integer: 'integer',
      boolean: 'boolean',
      date: 'string',
      datetime: 'string',
      json: ['object', 'array', 'string', 'number', 'boolean', 'null'],
      uuid: 'string',
    }[field.type] ?? 'string';
  const base = {
    ...jsonSchema,
    type: baseType,
    ...(field.type === 'date' ? { format: 'date' } : {}),
    ...(field.type === 'datetime' ? { format: 'date-time' } : {}),
    ...(field.type === 'uuid' ? { format: 'uuid' } : {}),
  };

  return field.array ? { type: 'array', items: base } : base;
}

export function toJsonSchema(
  definition: ModuleSchemaDefinition,
  options: { id?: string; title?: string } = {}
): ModuleJsonSchema {
  const required = Object.entries(definition.fields)
    .filter(([, schemaField]) => schemaField.required === true)
    .map(([name]) => name);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    ...(options.id ? { $id: options.id } : {}),
    type: 'object',
    ...(definition.name || options.title ? { title: definition.name ?? options.title } : {}),
    ...(definition.description ? { description: definition.description } : {}),
    additionalProperties: false,
    properties: Object.fromEntries(
      Object.entries(definition.fields).map(([name, schemaField]) => [
        name,
        schemaFieldToJsonSchema(schemaField),
      ])
    ),
    ...(required.length > 0 ? { required } : {}),
  };
}

function fixtureValueForField(schemaField: ModuleSchemaFieldDefinition): unknown {
  if ('default' in schemaField) {
    return schemaField.default;
  }
  if (schemaField.enum?.length) {
    return schemaField.enum[0];
  }
  const value =
    {
      string: 'example',
      text: 'Example text',
      number: 1,
      integer: 1,
      boolean: true,
      date: '2026-01-01',
      datetime: '2026-01-01T00:00:00.000Z',
      json: {},
      uuid: '00000000-0000-4000-8000-000000000000',
    }[schemaField.type] ?? null;
  return schemaField.array ? [value] : value;
}

export function createFixture<TSchema extends ModuleSchemaDefinition>(
  definition: TSchema
): InferSchema<TSchema> {
  return Object.fromEntries(
    Object.entries(definition.fields).map(([name, schemaField]) => [
      name,
      fixtureValueForField(schemaField),
    ])
  ) as InferSchema<TSchema>;
}

export const stringField = (options?: Omit<ModuleSchemaFieldDefinition, 'type'>) =>
  field('string', options);
export const textField = (options?: Omit<ModuleSchemaFieldDefinition, 'type'>) =>
  field('text', options);
export const numberField = (options?: Omit<ModuleSchemaFieldDefinition, 'type'>) =>
  field('number', options);
export const integerField = (options?: Omit<ModuleSchemaFieldDefinition, 'type'>) =>
  field('integer', options);
export const booleanField = (options?: Omit<ModuleSchemaFieldDefinition, 'type'>) =>
  field('boolean', options);
export const dateField = (options?: Omit<ModuleSchemaFieldDefinition, 'type'>) =>
  field('date', options);
export const datetimeField = (options?: Omit<ModuleSchemaFieldDefinition, 'type'>) =>
  field('datetime', options);
export const jsonField = (options?: Omit<ModuleSchemaFieldDefinition, 'type'>) =>
  field('json', options);
export const uuidField = (options?: Omit<ModuleSchemaFieldDefinition, 'type'>) =>
  field('uuid', options);
