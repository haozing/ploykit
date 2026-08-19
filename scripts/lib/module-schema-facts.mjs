const DATA_AUTHORITY_FIELDS = new Set(['tenant_id', 'workspace_id', 'organization_id']);

function cloneJson(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

export function isRuntimeSchema(value) {
  return Boolean(value && typeof value === 'object' && value.$$type === 'ploykit.schema');
}

export function isBusinessResource(value) {
  return Boolean(value && typeof value === 'object' && value.$$type === 'ploykit.resource');
}

function diagnostic(severity, code, message, path, fix) {
  return {
    severity,
    code,
    message,
    ...(path ? { path } : {}),
    ...(fix ? { fix } : {}),
  };
}

export function schemaFieldToJsonSchema(field) {
  const jsonSchema = {};
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
  if (Object.prototype.hasOwnProperty.call(field, 'default')) {
    jsonSchema.default = cloneJson(field.default);
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

  if (field.array) {
    return {
      type: 'array',
      items: {
        ...jsonSchema,
        type: baseType,
        ...(field.type === 'date' ? { format: 'date' } : {}),
        ...(field.type === 'datetime' ? { format: 'date-time' } : {}),
        ...(field.type === 'uuid' ? { format: 'uuid' } : {}),
      },
    };
  }

  return {
    ...jsonSchema,
    type: baseType,
    ...(field.type === 'date' ? { format: 'date' } : {}),
    ...(field.type === 'datetime' ? { format: 'date-time' } : {}),
    ...(field.type === 'uuid' ? { format: 'uuid' } : {}),
  };
}

export function schemaToJsonSchema(schema, options = {}) {
  const required = Object.entries(schema.fields ?? {})
    .filter(([, field]) => field.required === true)
    .map(([name]) => name);

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    ...(options.id ? { $id: options.id } : {}),
    ...(schema.name || options.title ? { title: schema.name ?? options.title } : {}),
    ...(schema.description ? { description: schema.description } : {}),
    properties: Object.fromEntries(
      Object.entries(schema.fields ?? {}).map(([name, field]) => [
        name,
        schemaFieldToJsonSchema(field),
      ])
    ),
    ...(required.length > 0 ? { required } : {}),
  };
}

function fixtureValueForField(field) {
  if (Object.prototype.hasOwnProperty.call(field, 'default')) {
    return cloneJson(field.default);
  }
  if (Array.isArray(field.enum) && field.enum.length > 0) {
    return field.enum[0];
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
    }[field.type] ?? null;
  return field.array ? [value] : value;
}

export function schemaToFixture(schema) {
  return Object.fromEntries(
    Object.entries(schema.fields ?? {}).map(([name, field]) => [name, fixtureValueForField(field)])
  );
}

function schemaFieldToDataColumn(field) {
  return {
    kind:
      {
        string: 'text',
        text: 'text',
        number: 'number',
        integer: 'integer',
        boolean: 'boolean',
        date: 'timestamp',
        datetime: 'timestamp',
        json: 'jsonb',
        uuid: 'uuid',
      }[field.type] ?? 'text',
    nullable: field.required !== true,
    ...(Object.prototype.hasOwnProperty.call(field, 'default')
      ? { default: cloneJson(field.default) }
      : {}),
  };
}

function schemaToDataColumns(schema) {
  return Object.fromEntries(
    Object.entries(schema.fields ?? {})
      .filter(([name]) => !DATA_AUTHORITY_FIELDS.has(name))
      .map(([name, field]) => [name, schemaFieldToDataColumn(field)])
  );
}

function schemaToDocumentFields(schema) {
  return Object.fromEntries(
    Object.entries(schema.fields ?? {})
      .filter(([name]) => !DATA_AUTHORITY_FIELDS.has(name))
      .map(([name, field]) => [
        name,
        {
          type:
            {
              uuid: 'string',
              text: 'text',
              string: 'string',
              number: 'number',
              integer: 'integer',
              boolean: 'boolean',
              date: 'date',
              datetime: 'datetime',
              json: 'json',
            }[field.type] ?? 'json',
          required: field.required === true,
          ...(typeof field.maxLength === 'number' ? { maxLength: field.maxLength } : {}),
          ...(Array.isArray(field.enum) ? { enum: [...field.enum] } : {}),
          ...(Object.prototype.hasOwnProperty.call(field, 'default')
            ? { default: cloneJson(field.default) }
            : {}),
        },
      ])
  );
}

function businessResources(resources) {
  return Object.entries(resources ?? {}).filter(([, value]) => isBusinessResource(value));
}

export function deriveResourceDataDefinition(definition) {
  const diagnostics = [];
  const tables = {};
  const documents = {};
  const resourceFacts = [];

  for (const [name, resource] of businessResources(definition.resources)) {
    if (!isRuntimeSchema(resource.schema)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_RESOURCE_SCHEMA_INLINE_REQUIRED',
          `Resource "${name}" must use a runtime schema object before Data v2 artifacts can be generated.`,
          `resources.${name}.schema`,
          'Import a schema(...) value into module.ts instead of passing only a string path.'
        )
      );
      continue;
    }

    const tableName = resource.storage?.table;
    const documentName = resource.storage?.document;
    if (!tableName && !documentName) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_RESOURCE_STORAGE_REQUIRED',
          `Resource "${name}" must declare storage.table or storage.document.`,
          `resources.${name}.storage`
        )
      );
      continue;
    }

    const fact = {
      name,
      scope: resource.scope,
      schema: {
        name: resource.schema.name ?? name,
        jsonSchema: schemaToJsonSchema(resource.schema, { title: name }),
        fixture: schemaToFixture(resource.schema),
      },
    };

    if (tableName) {
      tables[tableName] = {
        $$type: 'ploykit.data.table',
        scope: resource.scope,
        columns: schemaToDataColumns(resource.schema),
      };
      resourceFacts.push({ ...fact, kind: 'table', model: tableName });
      continue;
    }

    documents[documentName] = {
      scope: resource.scope,
      fields: schemaToDocumentFields(resource.schema),
    };
    resourceFacts.push({ ...fact, kind: 'document', model: documentName });
  }

  const hasDerivedData = Object.keys(tables).length > 0 || Object.keys(documents).length > 0;
  const explicitData = definition.data ?? {};
  const data =
    hasDerivedData || definition.data
      ? {
          version: Number.isInteger(explicitData.version) ? explicitData.version : 1,
          ...explicitData,
          tables: {
            ...tables,
            ...(explicitData.tables ?? {}),
          },
          documents: {
            ...documents,
            ...(explicitData.documents ?? {}),
          },
          migrations: explicitData.migrations ?? { mode: 'generated', dir: './migrations' },
        }
      : null;

  return {
    data,
    diagnostics,
    resourceFacts,
  };
}
