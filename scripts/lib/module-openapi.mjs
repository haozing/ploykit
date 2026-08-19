import { schemaToJsonSchema, isRuntimeSchema, isBusinessResource } from './module-schema-facts.mjs';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function schemaName(prefix, name) {
  return `${prefix}${name
    .split(/[_\-.]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('')}`;
}

function ref(name) {
  return { $ref: `#/components/schemas/${name}` };
}

function okResponse(schemaRef) {
  return {
    description: 'OK',
    content: {
      'application/json': {
        schema: schemaRef,
      },
    },
  };
}

function requestBody(schemaRef) {
  return {
    required: true,
    content: {
      'application/json': {
        schema: schemaRef,
      },
    },
  };
}

function addSchema(components, name, schema, title) {
  if (!isRuntimeSchema(schema)) {
    return null;
  }
  components.schemas[name] = schemaToJsonSchema(schema, { title });
  return ref(name);
}

function addOperation(paths, path, method, operation) {
  const normalizedMethod = method.toLowerCase();
  paths[path] = paths[path] ?? {};
  paths[path][normalizedMethod] = operation;
}

function defaultMethods(methods) {
  return (methods?.length ? methods : ['GET']).filter((method) => HTTP_METHODS.includes(method));
}

function invalidMethods(methods) {
  return (methods ?? []).filter((method) => !HTTP_METHODS.includes(method));
}

export function createModuleOpenApi(definition) {
  const components = { schemas: {} };
  const paths = {};
  const diagnostics = [];

  for (const [resourceName, resource] of Object.entries(definition.resources ?? {})) {
    if (!isBusinessResource(resource) || !isRuntimeSchema(resource.schema)) {
      continue;
    }
    const componentName = schemaName('Resource', resourceName);
    addSchema(components, componentName, resource.schema, resourceName);
  }

  for (const api of definition.apis ?? []) {
    const inputRef = addSchema(components, schemaName('ApiInput', api.id), api.input, api.id);
    const outputRef = addSchema(components, schemaName('ApiOutput', api.id), api.output, api.id);
    for (const method of invalidMethods(api.methods)) {
      diagnostics.push({
        code: 'MODULE_API_METHOD_INVALID',
        path: `apis.${api.id}.methods`,
        message: `HTTP method "${method}" is not supported and was omitted from OpenAPI output.`,
      });
    }
    for (const method of defaultMethods(api.methods)) {
      addOperation(paths, api.path, method, {
        operationId: `${api.id}.${method.toLowerCase()}`,
        tags: [definition.id],
        ...(inputRef && method !== 'GET' ? { requestBody: requestBody(inputRef) } : {}),
        responses: {
          200: okResponse(outputRef ?? { type: 'object' }),
        },
      });
    }
  }

  for (const [actionName, action] of Object.entries(definition.actions ?? {})) {
    addSchema(
      components,
      schemaName('ActionInput', actionName),
      action.input,
      actionName
    );
    addSchema(
      components,
      schemaName('ActionOutput', actionName),
      action.output,
      actionName
    );
  }

  return {
    openapi: '3.1.0',
    info: {
      title: definition.name ?? definition.id,
      version: definition.version ?? '0.0.0',
    },
    paths,
    components,
    ...(diagnostics.length > 0 ? { 'x-ploykit-diagnostics': diagnostics } : {}),
  };
}
