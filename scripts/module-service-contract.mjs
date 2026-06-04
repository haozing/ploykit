import fs from 'node:fs';
import path from 'node:path';
import {
  readModuleIdFromSource,
  resolveModuleRoot,
  slash,
} from './lib/module-sources.mjs';

const PROJECT_ROOT = process.cwd();
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const IGNORED_DIRS = new Set(['node_modules', '.next', '.runtime', 'dist', '.ploykit', 'migrations']);
const DEFAULT_CONSUMER_FILES = [
  path.join('tests', 'service-contract.json'),
  path.join('.ploykit', 'service-contract.json'),
];
const DEFAULT_FIXTURES_DIR = path.join('tests', 'fixtures', 'generated');

function toProjectPath(file) {
  return slash(path.relative(PROJECT_ROOT, file));
}

function usage() {
  return [
    'Usage: npm run module:service-contract -- <module-id-or-root> --openapi <openapi.json|openapi.yaml> [--uses <module-local-json>] [--write-fixtures [dir]]',
    '',
    'Validates that service-backed module consumer method/path usage still exists in the service machine contract.',
  ].join('\n');
}

function parseArgs(args) {
  const options = {
    target: '',
    openapi: '',
    uses: '',
    writeFixtures: false,
    fixturesDir: DEFAULT_FIXTURES_DIR,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--openapi' || arg === '--contract') {
      options.openapi = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--uses' || arg === '--consumers') {
      options.uses = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--write-fixtures' || arg === '--generate-fixtures') {
      options.writeFixtures = true;
      const candidate = args[index + 1] ?? '';
      if (candidate && !candidate.startsWith('--')) {
        options.fixturesDir = candidate;
        index += 1;
      }
      continue;
    }
    if (arg === '--fixtures-dir') {
      options.fixturesDir = args[index + 1] ?? DEFAULT_FIXTURES_DIR;
      options.writeFixtures = true;
      index += 1;
      continue;
    }
    if (!options.target) {
      options.target = arg;
      continue;
    }
  }

  return options;
}

function diagnostic(severity, code, message, pathValue, fix, details) {
  return {
    severity,
    code,
    message,
    ...(pathValue ? { path: pathValue } : {}),
    ...(fix ? { fix } : {}),
    ...(details ? { details } : {}),
  };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function readJson(file) {
  return JSON.parse(readText(file));
}

function normalizeMethod(value) {
  const method = String(value || 'GET').trim().toUpperCase();
  return method || 'GET';
}

function normalizeConsumerPath(value) {
  return String(value || '')
    .trim()
    .replace(/\$\{[^}]+\}/g, '{param}')
    .split('?')[0]
    .replace(/\/+/g, '/');
}

function normalizeOpenApiPath(value) {
  return String(value || '').trim().split('?')[0].replace(/\/+/g, '/');
}

function isOpenApiParameterSegment(segment) {
  return /^\{[^}]+\}$/.test(segment) || /^:[A-Za-z_][A-Za-z0-9_]*$/.test(segment);
}

function splitPath(value) {
  return normalizeOpenApiPath(value).split('/').filter(Boolean);
}

function pathMatches(openapiPath, consumerPath) {
  const openapiSegments = splitPath(openapiPath);
  const consumerSegments = splitPath(consumerPath);
  if (openapiSegments.length !== consumerSegments.length) {
    return false;
  }

  return openapiSegments.every((openapiSegment, index) => {
    const consumerSegment = consumerSegments[index];
    return (
      openapiSegment === consumerSegment ||
      isOpenApiParameterSegment(openapiSegment) ||
      isOpenApiParameterSegment(consumerSegment)
    );
  });
}

function sampleFromSchema(schema, seen = new Set()) {
  if (!schema || typeof schema !== 'object') {
    return { ok: true };
  }
  if (schema.example !== undefined) {
    return schema.example;
  }
  if (Array.isArray(schema.examples) && schema.examples.length > 0) {
    return schema.examples[0];
  }
  if (schema.$ref && typeof schema.$ref === 'string') {
    return { $ref: schema.$ref };
  }
  if (seen.has(schema)) {
    return null;
  }
  seen.add(schema);

  const variants = [schema.const, ...(Array.isArray(schema.enum) ? schema.enum.slice(0, 1) : [])].filter(
    (value) => value !== undefined
  );
  if (variants.length > 0) {
    return variants[0];
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === 'string') {
    if (schema.format === 'date-time') {
      return '2026-01-01T00:00:00.000Z';
    }
    if (schema.format === 'date') {
      return '2026-01-01';
    }
    return 'string';
  }
  if (type === 'integer' || type === 'number') {
    return 0;
  }
  if (type === 'boolean') {
    return false;
  }
  if (type === 'array') {
    return [sampleFromSchema(schema.items, seen)];
  }

  const objectLike = type === 'object' || schema.properties || schema.additionalProperties;
  if (objectLike) {
    const result = {};
    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      result[name] = sampleFromSchema(property, seen);
    }
    return result;
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf[0]) {
    return sampleFromSchema(schema.oneOf[0], seen);
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf[0]) {
    return sampleFromSchema(schema.anyOf[0], seen);
  }
  if (Array.isArray(schema.allOf)) {
    return Object.assign({}, ...schema.allOf.map((item) => sampleFromSchema(item, seen)));
  }

  return { ok: true };
}

function selectJsonResponse(operation) {
  if (!operation || typeof operation !== 'object' || !operation.responses) {
    return {
      status: 200,
      json: { ok: true },
      source: 'placeholder',
    };
  }
  const entries = Object.entries(operation.responses);
  const selected =
    entries.find(([status]) => /^2\d\d$/.test(status)) ??
    entries.find(([status]) => status === 'default') ??
    entries[0];
  if (!selected) {
    return {
      status: 200,
      json: { ok: true },
      source: 'placeholder',
    };
  }
  const [status, response] = selected;
  const content = response && typeof response === 'object' ? response.content ?? {} : {};
  const media =
    content['application/json'] ??
    Object.entries(content).find(([type]) => type.endsWith('+json'))?.[1] ??
    Object.entries(content)[0]?.[1];
  if (media && typeof media === 'object') {
    if (media.example !== undefined) {
      return { status: Number(status) || 200, json: media.example, source: 'example' };
    }
    const examples = media.examples && typeof media.examples === 'object' ? Object.values(media.examples) : [];
    const example = examples.find((item) => item && typeof item === 'object' && 'value' in item);
    if (example) {
      return { status: Number(status) || 200, json: example.value, source: 'examples' };
    }
    if (media.schema) {
      return { status: Number(status) || 200, json: sampleFromSchema(media.schema), source: 'schema' };
    }
  }
  return {
    status: Number(status) || 200,
    json: { ok: true },
    source: 'placeholder',
  };
}

function parseOpenApiJson(document) {
  const endpoints = [];
  const paths = document && typeof document === 'object' ? document.paths ?? {} : {};
  for (const [routePath, operations] of Object.entries(paths)) {
    if (!operations || typeof operations !== 'object') {
      continue;
    }
    for (const [method, operation] of Object.entries(operations)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) {
        continue;
      }
      endpoints.push({
        method: method.toUpperCase(),
        path: normalizeOpenApiPath(routePath),
        hasResponses: Boolean(operation && typeof operation === 'object' && operation.responses),
        mock: selectJsonResponse(operation),
      });
    }
  }
  return endpoints;
}

function parseOpenApiYaml(text) {
  const endpoints = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let inPaths = false;
  let pathsIndent = -1;
  let currentPath = '';
  let currentPathIndent = -1;

  for (const rawLine of lines) {
    const withoutComment = rawLine.replace(/\s+#.*$/, '');
    if (!withoutComment.trim()) {
      continue;
    }
    const indent = withoutComment.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = withoutComment.trim();

    if (!inPaths && /^paths\s*:\s*$/.test(trimmed)) {
      inPaths = true;
      pathsIndent = indent;
      continue;
    }
    if (!inPaths) {
      continue;
    }
    if (indent <= pathsIndent && !/^paths\s*:\s*$/.test(trimmed)) {
      break;
    }

    const pathMatch = trimmed.match(/^(["'])?(\/[^"']*?)\1\s*:\s*$/);
    if (pathMatch && indent > pathsIndent) {
      currentPath = normalizeOpenApiPath(pathMatch[2]);
      currentPathIndent = indent;
      continue;
    }

    const methodMatch = trimmed.match(/^([A-Za-z]+)\s*:\s*$/);
    if (
      currentPath &&
      indent > currentPathIndent &&
      methodMatch &&
      HTTP_METHODS.has(methodMatch[1].toLowerCase())
    ) {
      endpoints.push({
        method: methodMatch[1].toUpperCase(),
        path: currentPath,
        hasResponses: true,
        mock: {
          status: 200,
          json: { ok: true },
          source: 'yaml-placeholder',
        },
      });
    }
  }

  return endpoints;
}

function readOpenApiEndpoints(openapiFile) {
  const text = readText(openapiFile);
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) {
    return parseOpenApiJson(JSON.parse(text));
  }
  return parseOpenApiYaml(text);
}

function discoverSourceFiles(moduleRoot) {
  const roots = ['lib', 'services', 'actions', 'loaders', 'api']
    .map((dir) => path.join(moduleRoot, dir))
    .filter((dir) => fs.existsSync(dir));
  const files = [];

  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          visit(fullPath);
        }
        continue;
      }
      if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }

  for (const root of roots) {
    visit(root);
  }
  return files.sort();
}

function extractConsumersFromSource(moduleRoot) {
  const consumers = [];
  const seen = new Set();

  for (const file of discoverSourceFiles(moduleRoot)) {
    const source = readText(file);
    const pathPattern = /\bpath\s*:\s*(['"`])([\s\S]*?)\1/g;
    for (const match of source.matchAll(pathPattern)) {
      const rawPath = match[2];
      if (!rawPath.trim().startsWith('/')) {
        continue;
      }
      const windowStart = Math.max(0, match.index - 400);
      const windowEnd = Math.min(source.length, match.index + match[0].length + 800);
      const window = source.slice(windowStart, windowEnd);
      const methodMatch = window.match(/\bmethod\s*:\s*['"`]([A-Za-z]+)['"`]/);
      const method = normalizeMethod(methodMatch?.[1] ?? 'GET');
      const consumerPath = normalizeConsumerPath(rawPath);
      const key = `${method} ${consumerPath}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      consumers.push({
        method,
        path: consumerPath,
        source: toProjectPath(file),
      });
    }
  }

  return consumers;
}

function normalizeConsumerEntry(entry, source) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  if (typeof entry.path !== 'string' || !entry.path.trim()) {
    return null;
  }
  return {
    service: typeof entry.service === 'string' ? entry.service : undefined,
    operation: typeof entry.operation === 'string' ? entry.operation : undefined,
    method: normalizeMethod(entry.method ?? 'GET'),
    path: normalizeConsumerPath(entry.path),
    source: typeof entry.source === 'string' ? entry.source : source,
  };
}

function readConsumerManifest(file) {
  const body = readJson(file);
  const entries = Array.isArray(body) ? body : Array.isArray(body?.endpoints) ? body.endpoints : [];
  return entries
    .map((entry) => normalizeConsumerEntry(entry, toProjectPath(file)))
    .filter(Boolean);
}

function defaultConsumerManifest(moduleRoot) {
  return DEFAULT_CONSUMER_FILES.map((file) => path.join(moduleRoot, file)).find((file) =>
    fs.existsSync(file)
  );
}

function discoverConsumers(moduleRoot, explicitUsesFile) {
  const manifestFile = explicitUsesFile
    ? path.resolve(moduleRoot, explicitUsesFile)
    : defaultConsumerManifest(moduleRoot);
  if (manifestFile) {
    return {
      source: toProjectPath(manifestFile),
      consumers: readConsumerManifest(manifestFile),
    };
  }
  return {
    source: 'source-scan',
    consumers: extractConsumersFromSource(moduleRoot),
  };
}

function fixtureFileName(consumer) {
  const pathId = consumer.path
    .replace(/^\//, '')
    .replace(/\{([^}]+)\}/g, '$1')
    .replace(/[^a-zA-Z0-9_-]+/g, '.')
    .replace(/^\.+|\.+$/g, '') || 'root';
  return `${consumer.method.toLowerCase()}.${pathId}.json`;
}

function writeMockFixtures(moduleRoot, outputDir, matchedConsumers) {
  const fixturesRoot = path.resolve(moduleRoot, outputDir);
  fs.mkdirSync(fixturesRoot, { recursive: true });
  const fixtures = [];

  for (const item of matchedConsumers) {
    const file = path.join(fixturesRoot, fixtureFileName(item.consumer));
    const mock = item.endpoint.mock ?? { status: 200, json: { ok: true }, source: 'placeholder' };
    const body = {
      ok: Number(mock.status) >= 200 && Number(mock.status) < 400,
      status: Number(mock.status) || 200,
      method: item.consumer.method,
      path: item.consumer.path,
      json: mock.json,
      generatedFrom: {
        openapiPath: item.endpoint.path,
        openapiMethod: item.endpoint.method,
        source: mock.source,
      },
    };
    fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    fixtures.push({
      method: item.consumer.method,
      path: item.consumer.path,
      file: toProjectPath(file),
      source: mock.source,
    });
  }

  return fixtures;
}

function writeReport(moduleId, report) {
  const reportFile = path.join(PROJECT_ROOT, '.runtime', 'module-service-contract-reports', `${moduleId}.json`);
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return toProjectPath(reportFile);
}

function checkServiceContract(options) {
  const moduleRoot = resolveModuleRoot(PROJECT_ROOT, options.target);
  const moduleId = readModuleIdFromSource(moduleRoot);
  const openapiFile = path.resolve(PROJECT_ROOT, options.openapi);
  const diagnostics = [];

  if (!fs.existsSync(openapiFile)) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_SERVICE_CONTRACT_OPENAPI_MISSING',
        `OpenAPI contract was not found: ${options.openapi}.`,
        options.openapi,
        'Pass --openapi <openapi.json|openapi.yaml> from the service repository.'
      )
    );
  }

  let endpoints = [];
  if (diagnostics.length === 0) {
    try {
      endpoints = readOpenApiEndpoints(openapiFile);
    } catch (error) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_SERVICE_CONTRACT_OPENAPI_INVALID',
          error instanceof Error ? error.message : String(error),
          toProjectPath(openapiFile),
          'Use valid OpenAPI JSON or a YAML file with a paths section.'
        )
      );
    }
  }

  const { source, consumers } = discoverConsumers(moduleRoot, options.uses);
  if (consumers.length === 0) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_SERVICE_CONTRACT_CONSUMERS_MISSING',
        'No service consumer endpoints were found for this module.',
        source,
        'Add tests/service-contract.json or keep literal method/path pairs in the module service client.'
      )
    );
  }
  if (endpoints.length === 0 && diagnostics.length === 0) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_SERVICE_CONTRACT_OPENAPI_PATHS_MISSING',
        'OpenAPI contract does not declare any HTTP paths.',
        toProjectPath(openapiFile),
        'Check that the file has a top-level paths object.'
      )
    );
  }

  const matchedConsumers = [];
  for (const consumer of consumers) {
    const match = endpoints.find(
      (endpoint) => endpoint.method === consumer.method && pathMatches(endpoint.path, consumer.path)
    );
    if (!match) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_SERVICE_CONTRACT_ENDPOINT_MISSING',
          `Module consumes ${consumer.method} ${consumer.path}, but it is not present in the OpenAPI contract.`,
          consumer.source,
          'Update the service OpenAPI contract or the module service client before merging.',
          { method: consumer.method, path: consumer.path }
        )
      );
      continue;
    }
    matchedConsumers.push({ consumer, endpoint: match });
    if (!match.hasResponses) {
      diagnostics.push(
        diagnostic(
          'warning',
          'MODULE_SERVICE_CONTRACT_RESPONSES_MISSING',
          `OpenAPI operation ${match.method} ${match.path} does not declare responses.`,
          toProjectPath(openapiFile),
          'Add success and error responses so generated mocks and consumer tests can use the schema.',
          { method: match.method, path: match.path }
        )
      );
    }
  }

  const mockFixtures =
    options.writeFixtures && matchedConsumers.length > 0
      ? writeMockFixtures(moduleRoot, options.fixturesDir, matchedConsumers)
      : [];
  const report = {
    success: !diagnostics.some((item) => item.severity === 'error'),
    moduleRoot: toProjectPath(moduleRoot),
    moduleId,
    openapi: toProjectPath(openapiFile),
    consumerSource: source,
    consumers,
    openapiEndpoints: endpoints.map((endpoint) => ({
      method: endpoint.method,
      path: endpoint.path,
      hasResponses: endpoint.hasResponses,
    })),
    mockFixtures,
    diagnostics,
    checkedAt: new Date().toISOString(),
  };
  report.reportFile = writeReport(moduleId, report);
  return report;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.target || !options.openapi) {
    printJson({
      success: false,
      diagnostics: [
        diagnostic(
          'error',
          'MODULE_SERVICE_CONTRACT_USAGE',
          usage(),
          '',
          'Pass a module id/root and --openapi <file>.'
        ),
      ],
    });
    process.exitCode = 1;
    return;
  }

  try {
    const report = checkServiceContract(options);
    printJson(report);
    process.exitCode = report.success ? 0 : 1;
  } catch (error) {
    printJson({
      success: false,
      diagnostics: [
        diagnostic(
          'error',
          'MODULE_SERVICE_CONTRACT_ERROR',
          error instanceof Error ? error.message : String(error)
        ),
      ],
    });
    process.exitCode = 1;
  }
}

main();
