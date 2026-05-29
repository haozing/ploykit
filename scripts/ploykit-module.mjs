import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import { builtinModules } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

const PROJECT_ROOT = process.cwd();
const CLI_FILE = fileURLToPath(import.meta.url);
const tsx = register({ namespace: 'ploykit-module-doctor' });
const CONTRACT_VALIDATION_TIMEOUT_MS = 10_000;
const MODULE_ID_PATTERN = /^[a-z0-9-]+$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;
const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_.:-]*$/;
const EGRESS_ORIGIN_PATTERN = /^https?:\/\/[^*/\s?#]+(?::\d+)?$/;
const RATE_LIMIT_WINDOW_PATTERN = /^\d+(ms|s|m|h|d)$/;
const WEBHOOK_SIGNATURES = new Set(['none', 'hmac-sha256', 'stripe', 'github']);
const DATA_MIGRATION_MODES = new Set(['generated', 'sql']);
const LIFECYCLE_HOOKS = new Set([
  'install',
  'enable',
  'disable',
  'update',
  'seed',
  'activate',
  'deactivate',
  'reset',
]);
const MODULE_TEMPLATES = new Set([
  'basic',
  'dashboard',
  'crud',
  'connector',
  'signed-service',
  'job',
  'white-label',
  'product-app',
]);
const MODULE_MAP_MANIFEST_FILE = path.join(PROJECT_ROOT, 'src', 'lib', 'module-map.manifest.json');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const NODE_BUILTINS = new Set(
  builtinModules.map((specifier) => specifier.replace(/^node:/, '').split('/')[0])
);
const RESERVED_PUBLIC_ALIAS_PATHS = new Set([
  '/',
  '/about',
  '/pricing',
  '/login',
  '/signup',
  '/sign-in',
  '/sign-up',
]);
const RESERVED_PUBLIC_ALIAS_PREFIXES = ['/api', '/admin', '/dashboard'];
const PART_EXPECTED_EXPORTS = {
  data: /\bexport\s+(const|default)\s+\w*data|\bexport\s*{\s*\w+\s+as\s+data|\bdata\s*:/,
  routes: /\bexport\s+(const|default)\s+\w*routes|\bexport\s*{\s*\w+\s+as\s+routes|\broutes\s*:/,
  presentation:
    /\bexport\s+(const|default)\s+\w*presentation|\bexport\s*{\s*\w+\s+as\s+presentation|\bpresentation\s*:/,
  theme: /\bexport\s+(const|default)\s+\w*theme|\bexport\s*{\s*\w+\s+as\s+theme|\btheme\s*:/,
  i18n: /\bexport\s+(const|default)\s+\w*i18n|\bexport\s*{\s*\w+\s+as\s+i18n|\bi18n\s*:/,
};

function slash(value) {
  return value.replace(/\\/g, '/');
}

function toProjectPath(file) {
  return slash(path.relative(PROJECT_ROOT, file));
}

function locateInSource(source, needle) {
  if (!needle) {
    return {};
  }
  const index = source.indexOf(needle);
  if (index < 0) {
    return {};
  }
  const before = source.slice(0, index);
  const lines = before.split(/\r?\n/);
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function classifyDiagnostic(code) {
  if (code.includes('MAP')) {
    return { category: 'map', subsystem: 'module-map' };
  }
  if (code.includes('PERMISSION') || code.includes('EGRESS') || code.includes('AUTH')) {
    return { category: 'security', subsystem: 'permissions' };
  }
  if (code.includes('DATA')) {
    return { category: 'data', subsystem: 'data' };
  }
  if (
    code.includes('PRESENTATION') ||
    code.includes('SURFACE') ||
    code.includes('THEME') ||
    code.includes('I18N') ||
    code.includes('NAVIGATION')
  ) {
    return { category: 'presentation', subsystem: code.includes('SURFACE') ? 'surfaces' : 'i18n' };
  }
  if (code.includes('ROUTE') || code.includes('API') || code.includes('WEBHOOK')) {
    return { category: 'contract', subsystem: 'routes' };
  }
  if (code.includes('ACTION')) {
    return { category: 'contract', subsystem: 'actions' };
  }
  if (
    code.includes('HOST_INTERNAL') ||
    code.includes('RAW_FETCH') ||
    code.includes('PROCESS_ENV') ||
    code.includes('NODE_BUILTIN') ||
    code.includes('DYNAMIC_CTX') ||
    code.includes('DYNAMIC_CODE') ||
    code.includes('DYNAMIC_IMPORT') ||
    code.includes('DYNAMIC_REQUIRE') ||
    code.includes('SOURCE_IMPORT')
  ) {
    return { category: 'source', subsystem: 'doctor' };
  }
  return { category: 'contract', subsystem: 'module' };
}

function diagnostic(severity, code, message, pathValue, fix, details, location = {}) {
  const classified = classifyDiagnostic(code);
  return {
    severity,
    code,
    message,
    ...(pathValue ? { path: pathValue } : {}),
    ...(fix ? { fix } : {}),
    ...classified,
    ...(location.line ? { line: location.line } : {}),
    ...(location.column ? { column: location.column } : {}),
    ...(details ? { details } : {}),
  };
}

function normalizeDiagnostic(item) {
  return diagnostic(
    item.severity ?? 'error',
    item.code ?? 'MODULE_DIAGNOSTIC_UNKNOWN',
    item.message ?? 'Module diagnostic failed.',
    item.path,
    item.fix,
    item.details,
    { line: item.line, column: item.column }
  );
}

function dedupeDiagnostics(diagnostics) {
  const seen = new Set();
  const result = [];
  for (const item of diagnostics) {
    const key = `${item.severity}:${item.code}:${item.path ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function resolveModuleRoot(inputPath) {
  const resolved = path.resolve(PROJECT_ROOT, inputPath ?? '.');
  if (fs.existsSync(path.join(resolved, 'module.ts'))) {
    return resolved;
  }
  if (fs.existsSync(path.join(resolved, 'modules'))) {
    return path.join(resolved, 'modules');
  }
  return resolved;
}

function discoverModuleRoots(inputPath = 'modules') {
  const root = resolveModuleRoot(inputPath);
  if (!fs.existsSync(root)) {
    return [];
  }
  if (fs.existsSync(path.join(root, 'module.ts'))) {
    return [root];
  }
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'module.ts')));
}

function extractString(source, key) {
  return source.match(new RegExp(`\\b${key}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`))?.[1] ?? '';
}

function normalizeLocalModulePath(moduleRoot, localPath) {
  const withoutPrefix = localPath.replace(/^\.\//, '');
  const absoluteBase = path.resolve(moduleRoot, withoutPrefix);
  const candidates = [
    absoluteBase,
    `${absoluteBase}.ts`,
    `${absoluteBase}.tsx`,
    `${absoluteBase}.js`,
    `${absoluteBase}.jsx`,
    path.join(absoluteBase, 'index.ts'),
    path.join(absoluteBase, 'index.tsx'),
    path.join(absoluteBase, 'index.js'),
    path.join(absoluteBase, 'index.jsx'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? absoluteBase;
}

function extractLocalPaths(source) {
  const paths = new Set();
  const pattern = /['"`](\.\/[^'"`]+)['"`]/g;
  for (const match of source.matchAll(pattern)) {
    paths.add(match[1]);
  }
  return [...paths].sort();
}

function extractHandlerPaths(source) {
  const paths = new Set();
  const pattern = /\bhandler\s*:\s*['"`](\.\/[^'"`]+)['"`]/g;
  for (const match of source.matchAll(pattern)) {
    paths.add(match[1]);
  }
  return [...paths].sort();
}

function extractAllContractLocalPaths(source) {
  return [...new Set([...extractLocalPaths(source), ...extractContractParts(source).map((part) => part.localPath)])].sort();
}

function readPackageManifest() {
  const file = path.join(PROJECT_ROOT, 'package.json');
  if (!fs.existsSync(file)) {
    return { dependencies: {}, devDependencies: {} };
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readDefaultExport(value) {
  if (value && typeof value === 'object' && 'default' in value) {
    return value.default;
  }
  return value;
}

async function loadSdkValidator() {
  const sdk = await tsx.import(
    pathToFileURL(path.join(PROJECT_ROOT, 'src', 'module-sdk', 'index.ts')).href,
    import.meta.url
  );
  return sdk.validateModuleDefinition;
}

async function evaluateSdkContractValidation(moduleRoot) {
  const diagnostics = [];
  try {
    const [loaded, validateModuleDefinition] = await Promise.all([
      tsx.import(pathToFileURL(path.join(moduleRoot, 'module.ts')).href, import.meta.url),
      loadSdkValidator(),
    ]);
    const definition = readDefaultExport(loaded);
    if (!definition || typeof definition !== 'object') {
      return [
        diagnostic(
          'error',
          'MODULE_CONTRACT_INVALID_EXPORT',
          'module.ts must export a module definition object.',
          'module.ts',
          'Export default defineModule(...).'
        ),
      ];
    }

    for (const sdkDiagnostic of validateModuleDefinition(definition)) {
      diagnostics.push(normalizeDiagnostic(sdkDiagnostic));
    }
  } catch (error) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_CONTRACT_EVALUATION_FAILED',
        error instanceof Error ? error.message : String(error),
        'module.ts',
        'Ensure module.ts exports defineModule(...) and compiles.'
      )
    );
  }
  return diagnostics;
}

function runSdkContractValidation(moduleRoot) {
  const result = childProcess.spawnSync(
    process.execPath,
    [CLI_FILE, 'validate-contract-internal', moduleRoot],
    {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      timeout: CONTRACT_VALIDATION_TIMEOUT_MS,
    }
  );

  if (result.error) {
    const isTimeout = result.error.code === 'ETIMEDOUT';
    return [
      diagnostic(
        'error',
        isTimeout ? 'MODULE_CONTRACT_EVALUATION_TIMEOUT' : 'MODULE_CONTRACT_EVALUATION_FAILED',
        isTimeout
          ? `module.ts contract evaluation exceeded ${CONTRACT_VALIDATION_TIMEOUT_MS}ms.`
          : result.error.message,
        'module.ts',
        'Keep module.ts side-effect free and export defineModule(...).'
      ),
    ];
  }

  try {
    const payload = JSON.parse(result.stdout);
    return Array.isArray(payload.diagnostics)
      ? payload.diagnostics.map((item) => normalizeDiagnostic(item))
      : [
          diagnostic(
            'error',
            'MODULE_CONTRACT_EVALUATION_FAILED',
            'Contract validator did not return diagnostics.',
            'module.ts',
            'Ensure module.ts exports defineModule(...) and compiles.'
          ),
        ];
  } catch (error) {
    return [
      diagnostic(
        'error',
        'MODULE_CONTRACT_EVALUATION_FAILED',
        [
          error instanceof Error ? error.message : String(error),
          result.stdout.trim(),
          result.stderr.trim(),
        ]
          .filter(Boolean)
          .join('\n'),
        'module.ts',
        'Ensure module.ts exports defineModule(...) and compiles.'
      ),
    ];
  }
}

function hasSourceBoundaryErrors(diagnostics) {
  return diagnostics.some(
    (item) =>
      item.severity === 'error' &&
      (item.category === 'source' ||
        item.code === 'MODULE_LOCAL_PATH_ESCAPES_ROOT' ||
        item.code === 'MODULE_SOURCE_IMPORT_ESCAPES_ROOT')
  );
}

function checkSdkContractValidation(moduleRoot, diagnostics) {
  if (hasSourceBoundaryErrors(diagnostics)) {
    diagnostics.push(
      diagnostic(
        'info',
        'MODULE_CONTRACT_EVALUATION_SKIPPED',
        'Skipped SDK contract evaluation because source boundary errors must be fixed first.',
        'module.ts',
        'Fix source safety diagnostics, then rerun module doctor.'
      )
    );
    return;
  }

  diagnostics.push(...runSdkContractValidation(moduleRoot));
}

function extractPublicAliases(source) {
  const aliases = [];
  const publicAliasesPattern = /\bpublicAliases\s*:\s*\[([\s\S]*?)\]/g;
  for (const aliasesMatch of source.matchAll(publicAliasesPattern)) {
    const valuesSource = aliasesMatch[1];
    const stringPattern = /['"`]([^'"`]+)['"`]/g;
    for (const valueMatch of valuesSource.matchAll(stringPattern)) {
      aliases.push(valueMatch[1]);
    }
  }
  return aliases;
}

function extractStringArray(source, key) {
  const values = [];
  const arraySource = source.match(new RegExp(`\\b${key}\\s*:\\s*\\[([\\s\\S]*?)\\]`))?.[1];
  if (!arraySource) {
    return values;
  }

  for (const match of arraySource.matchAll(/['"`]([^'"`]+)['"`]/g)) {
    values.push(match[1]);
  }
  return values;
}

function originForUrl(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function extractStaticHttpFetchOrigins(source) {
  const origins = [];
  for (const match of source.matchAll(/\bctx\.http\.fetch\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
    const origin = originForUrl(match[1]);
    if (origin) {
      origins.push(origin);
    }
  }
  return origins;
}

function extractContractParts(source) {
  const partsSource = extractObjectAfterKey(source, 'parts');
  if (!partsSource) {
    return [];
  }
  const entries = [];
  for (const match of partsSource.matchAll(/\b(data|routes|presentation|theme|i18n)\s*:\s*['"`](\.\/[^'"`]+)['"`]/g)) {
    entries.push({ part: match[1], localPath: match[2] });
  }
  return entries;
}

function findKeyArraySource(source, key) {
  const keyMatch = new RegExp(`\\b${key}\\s*:\\s*\\[`).exec(source);
  if (!keyMatch) {
    return '';
  }

  const start = keyMatch.index + keyMatch[0].lastIndexOf('[');
  const end = findMatchingDelimiter(source, start, '[', ']');
  return end >= 0 ? source.slice(start + 1, end) : '';
}

function findMatchingDelimiter(source, start, open, close) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === open) {
      depth += 1;
      continue;
    }
    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function extractObjectLiterals(source) {
  const objects = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '{') {
      continue;
    }
    const end = findMatchingDelimiter(source, index, '{', '}');
    if (end < 0) {
      break;
    }
    objects.push(source.slice(index, end + 1));
    index = end;
  }
  return objects;
}

function extractRouteObjects(source, group) {
  const block = findKeyArraySource(source, group);
  return block ? extractObjectLiterals(block) : [];
}

function hasStringProperty(source, key, value) {
  return new RegExp(`\\b${key}\\s*:\\s*['"\`]${value}['"\`]`).test(source);
}

function extractObjectAfterKey(source, key) {
  const keyMatch = new RegExp(`\\b${key}\\s*:\\s*{`).exec(source);
  if (!keyMatch) {
    return '';
  }
  const start = keyMatch.index + keyMatch[0].lastIndexOf('{');
  const end = findMatchingDelimiter(source, start, '{', '}');
  return end >= 0 ? source.slice(start, end + 1) : '';
}

function extractConstObject(source, name) {
  const assignment = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*{`).exec(source);
  if (!assignment) {
    return '';
  }
  const start = assignment.index + assignment[0].lastIndexOf('{');
  const end = findMatchingDelimiter(source, start, '{', '}');
  return end >= 0 ? source.slice(start, end + 1) : '';
}

function resolveAnonymousPolicySource(routeObject, moduleSource) {
  const inline = extractObjectAfterKey(routeObject, 'anonymousPolicy');
  if (inline) {
    return inline;
  }
  return /\banonymousPolicy\s*,/.test(routeObject)
    ? extractConstObject(moduleSource, 'anonymousPolicy')
    : '';
}

function moduleCode(moduleRoot) {
  return listModuleSourceFiles(moduleRoot)
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
}

function listModuleHashFiles(moduleRoot) {
  const files = [];
  const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.sql', '.md']);
  const ignored = new Set(['node_modules', '.next', '.runtime', 'dist']);

  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.name !== '.ploykit') {
        continue;
      }
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) {
          visit(path.join(current, entry.name));
        }
        continue;
      }
      if (!entry.isFile() || entry.name.includes('.test.')) {
        continue;
      }
      if (extensions.has(path.extname(entry.name))) {
        files.push(path.join(current, entry.name));
      }
    }
  }

  visit(moduleRoot);
  return files.sort((left, right) =>
    slash(path.relative(moduleRoot, left)).localeCompare(slash(path.relative(moduleRoot, right)))
  );
}

function sourceHash(moduleRoot) {
  const hash = crypto.createHash('sha256');
  for (const file of listModuleHashFiles(moduleRoot)) {
    hash.update(slash(path.relative(moduleRoot, file)));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function contractSourceDigest(moduleRoot) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(moduleRoot, 'module.ts'))).digest('hex');
}

function isReservedPublicAlias(value) {
  if (RESERVED_PUBLIC_ALIAS_PATHS.has(value)) {
    return true;
  }

  return RESERVED_PUBLIC_ALIAS_PREFIXES.some(
    (prefix) => value === prefix || value.startsWith(`${prefix}/`)
  );
}

function checkPublicAliases(source, diagnostics) {
  const seen = new Set();
  for (const alias of extractPublicAliases(source)) {
    if (!alias.startsWith('/') || alias.includes('?') || alias.includes('#')) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_PUBLIC_ALIAS_PATH_INVALID',
          `Public alias "${alias}" must be an absolute path without query or hash.`,
          'publicAliases',
          'Use a path like "/tools/json-formatter".'
        )
      );
    }

    if (alias.includes(':') || alias.includes('*')) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_PUBLIC_ALIAS_DYNAMIC_UNSUPPORTED',
          `Public alias "${alias}" must be a static host path.`,
          'publicAliases',
          'Use a fixed path such as "/tools/json-formatter".'
        )
      );
    }

    if (isReservedPublicAlias(alias)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_PUBLIC_ALIAS_RESERVED',
          `Public alias "${alias}" conflicts with a reserved host path.`,
          'publicAliases',
          'Use a product-specific path such as "/tools/my-tool".'
        )
      );
    }

    if (seen.has(alias)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_PUBLIC_ALIAS_DUPLICATE',
          `Public alias "${alias}" is duplicated in this module.`,
          'publicAliases'
        )
      );
    }
    seen.add(alias);
  }
}

function checkResourceKinds(source, diagnostics) {
  const assetObjectPattern = /{[^{}]*\bpath\s*:\s*['"`]([^'"`]+)['"`][^{}]*}/g;
  for (const match of source.matchAll(assetObjectPattern)) {
    const objectSource = match[0];
    const assetPath = match[1];
    if (assetPath.endsWith('.wasm') && !/\bkind\s*:\s*['"`]wasm['"`]/.test(objectSource)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_ASSET_WASM_KIND_REQUIRED',
          'WASM assets must explicitly declare kind: "wasm".',
          assetPath,
          'Add kind: "wasm".'
        )
      );
    }
    if (assetPath.includes('.worker.') && !/\bkind\s*:\s*['"`]worker['"`]/.test(objectSource)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_ASSET_WORKER_KIND_REQUIRED',
          'Worker assets must explicitly declare kind: "worker".',
          assetPath,
          'Add kind: "worker".'
        )
      );
    }
  }
}

function checkEventNames(source, diagnostics) {
  const publishBlocks = source.matchAll(/\bpublishes\s*:\s*\[([\s\S]*?)\]/g);
  for (const block of publishBlocks) {
    for (const match of block[1].matchAll(/['"`]([^'"`]+)['"`]/g)) {
      const eventName = match[1];
      if (!EVENT_NAME_PATTERN.test(eventName)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_EVENT_NAME_INVALID',
            `Event "${eventName}" must start with a lowercase letter and contain only lowercase letters, numbers, "_", ".", ":", or "-".`,
            eventName,
            'Use an event name like "orders.created" or "hello:greeted".'
          )
        );
      }
    }
  }

  const subscribeBlocks = source.matchAll(/\bsubscribes\s*:\s*{([\s\S]*?)}/g);
  for (const block of subscribeBlocks) {
    for (const match of block[1].matchAll(/['"`]([^'"`]+)['"`]\s*:/g)) {
      const eventName = match[1];
      if (!EVENT_NAME_PATTERN.test(eventName)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_EVENT_NAME_INVALID',
            `Event "${eventName}" must start with a lowercase letter and contain only lowercase letters, numbers, "_", ".", ":", or "-".`,
            eventName,
            'Use an event name like "orders.created" or "hello:greeted".'
          )
        );
      }
    }
  }
}

function checkWebhookSignatures(source, diagnostics) {
  for (const match of source.matchAll(/\bsignature\s*:\s*['"`]([^'"`]+)['"`]/g)) {
    const signature = match[1];
    if (!WEBHOOK_SIGNATURES.has(signature)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_WEBHOOK_SIGNATURE_INVALID',
          `Webhook signature "${signature}" is not supported.`,
          signature,
          'Use "none", "hmac-sha256", "stripe", or "github".'
        )
      );
    }
  }
}

function hasDataDefinition(source) {
  return /\bdata\s*:\s*{/.test(source);
}

function dataDefinitionSource(source) {
  return extractObjectAfterKey(source, 'data');
}

function hasPhysicalDataDefinition(source) {
  const dataSource = dataDefinitionSource(source);
  return /\b(?:tables|views|grants|checks)\s*:/.test(dataSource);
}

function hasDataMigrationsDeclaration(source) {
  return /\bmigrations\s*:/.test(dataDefinitionSource(source));
}

function extractMigrationMode(source) {
  return (
    dataDefinitionSource(source).match(/\bmigrations\s*:\s*{[\s\S]*?\bmode\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ??
    null
  );
}

function hasGeneratedMigrations(source) {
  const migrationMode = extractMigrationMode(source);
  return !migrationMode || migrationMode === 'generated';
}

function extractMigrationDir(source) {
  return (
    source.match(/\bmigrations\s*:\s*{[\s\S]*?\bdir\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ??
    './migrations'
  );
}

function checkFileExists(diagnostics, file, code, message, fix) {
  if (fs.existsSync(file)) {
    return;
  }

  diagnostics.push(diagnostic('error', code, message, toProjectPath(file), fix));
}

function listModuleSourceFiles(moduleRoot) {
  const files = [];

  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (
        entry.name === '.ploykit' ||
        entry.name === 'migrations' ||
        entry.name === 'scripts' ||
        entry.name === 'tests'
      ) {
        continue;
      }

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }

      if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }

  visit(moduleRoot);
  return files.sort();
}

function hasAnyPermission(source, permissions) {
  return permissions.some((permission) => source.includes(permission));
}

function checkCapabilityPermissions(moduleRoot, moduleSource, diagnostics) {
  const code = moduleCode(moduleRoot);
  const checks = [
    {
      token: 'ctx.data',
      permissions: [
        'Permission.DataDocumentRead',
        'Permission.DataDocumentWrite',
        'Permission.DataTableRead',
        'Permission.DataTableWrite',
        'Permission.DataTransaction',
        'Permission.DataSqlRead',
        'Permission.DataSqlWrite',
        'data.document.read',
        'data.document.write',
        'data.table.read',
        'data.table.write',
        'data.transaction',
        'data.sql.read',
        'data.sql.write',
      ],
      code: 'MODULE_DATA_PERMISSION_MISSING',
      fix: 'Add the matching Data permission to module.ts.',
    },
    {
      token: 'ctx.files',
      permissions: [
        'Permission.FilesRead',
        'Permission.FilesWrite',
        'Permission.FilesPublish',
        'files.read',
        'files.write',
        'files.publish',
      ],
      code: 'MODULE_FILES_PERMISSION_MISSING',
      fix: 'Add Permission.FilesRead, Permission.FilesWrite, or Permission.FilesPublish to module.ts.',
    },
    {
      token: 'ctx.artifacts',
      permissions: [
        'Permission.ArtifactsRead',
        'Permission.ArtifactsWrite',
        'artifacts.read',
        'artifacts.write',
      ],
      code: 'MODULE_ARTIFACTS_PERMISSION_MISSING',
      fix: 'Add Permission.ArtifactsRead or Permission.ArtifactsWrite to module.ts.',
    },
    {
      token: 'ctx.resourceBindings',
      permissions: [
        'Permission.ResourceBindingsRead',
        'Permission.ResourceBindingsWrite',
        'resourceBindings.read',
        'resourceBindings.write',
      ],
      code: 'MODULE_RESOURCE_BINDINGS_PERMISSION_MISSING',
      fix: 'Add Permission.ResourceBindingsRead or Permission.ResourceBindingsWrite to module.ts.',
    },
    {
      token: 'ctx.notifications.send',
      permissions: ['Permission.NotificationsSend', 'notifications.send'],
      code: 'MODULE_NOTIFICATIONS_SEND_PERMISSION_MISSING',
      fix: 'Add Permission.NotificationsSend to module.ts.',
    },
    {
      token: 'ctx.notifications.list',
      permissions: ['Permission.NotificationsRead', 'notifications.read'],
      code: 'MODULE_NOTIFICATIONS_READ_PERMISSION_MISSING',
      fix: 'Add Permission.NotificationsRead to module.ts.',
    },
    {
      token: 'ctx.notifications.markRead',
      permissions: ['Permission.NotificationsRead', 'notifications.read'],
      code: 'MODULE_NOTIFICATIONS_READ_PERMISSION_MISSING',
      fix: 'Add Permission.NotificationsRead to module.ts.',
    },
    {
      token: 'ctx.runs',
      permissions: ['Permission.RunsRead', 'Permission.RunsWrite', 'runs.read', 'runs.write'],
      code: 'MODULE_RUNS_PERMISSION_MISSING',
      fix: 'Add Permission.RunsRead or Permission.RunsWrite to module.ts.',
    },
    {
      token: 'ctx.jobs',
      permissions: ['Permission.JobsEnqueue', 'Permission.JobsRegister', 'jobs.enqueue', 'jobs.register'],
      code: 'MODULE_JOBS_PERMISSION_MISSING',
      fix: 'Add Permission.JobsEnqueue or Permission.JobsRegister to module.ts.',
    },
    {
      token: 'ctx.events',
      permissions: ['Permission.EventsEmit', 'Permission.EventsSubscribe', 'events.emit', 'events.subscribe'],
      code: 'MODULE_EVENTS_PERMISSION_MISSING',
      fix: 'Add Permission.EventsEmit or Permission.EventsSubscribe to module.ts.',
    },
    {
      token: 'ctx.webhooks',
      permissions: ['Permission.WebhookReceive', 'webhook.receive'],
      code: 'MODULE_WEBHOOKS_PERMISSION_MISSING',
      fix: 'Add Permission.WebhookReceive to module.ts.',
    },
    {
      token: 'ctx.connectors',
      permissions: [
        'Permission.ConnectorsRead',
        'Permission.ConnectorsInvoke',
        'Permission.ConnectorsManage',
        'connectors.read',
        'connectors.invoke',
        'connectors.manage',
      ],
      code: 'MODULE_CONNECTORS_PERMISSION_MISSING',
      fix: 'Add the matching connector permission to module.ts.',
    },
    {
      token: 'ctx.services',
      permissions: ['Permission.ServicesInvoke', 'services.invoke'],
      code: 'MODULE_SERVICES_PERMISSION_MISSING',
      fix: 'Add Permission.ServicesInvoke to module.ts.',
    },
    {
      token: 'ctx.secrets',
      permissions: [
        'Permission.SecretsRead',
        'Permission.SecretsWrite',
        'secrets.read',
        'secrets.write',
      ],
      code: 'MODULE_SECRETS_PERMISSION_MISSING',
      fix: 'Add Permission.SecretsRead or Permission.SecretsWrite to module.ts.',
    },
    {
      token: 'ctx.config',
      permissions: [
        'Permission.ConfigRead',
        'Permission.ConfigWrite',
        'config.read',
        'config.write',
      ],
      code: 'MODULE_CONFIG_PERMISSION_MISSING',
      fix: 'Add Permission.ConfigRead or Permission.ConfigWrite to module.ts.',
    },
    {
      token: 'ctx.apiKeys',
      permissions: [
        'Permission.ApiKeysRead',
        'Permission.ApiKeysWrite',
        'apiKeys.read',
        'apiKeys.write',
      ],
      code: 'MODULE_API_KEYS_PERMISSION_MISSING',
      fix: 'Add Permission.ApiKeysRead or Permission.ApiKeysWrite to module.ts.',
    },
    {
      token: 'ctx.rateLimit',
      permissions: ['Permission.RateLimitCheck', 'rateLimit.check'],
      code: 'MODULE_RATE_LIMIT_PERMISSION_MISSING',
      fix: 'Add Permission.RateLimitCheck to module.ts.',
    },
    {
      token: 'ctx.http',
      permissions: ['Permission.ExternalHttp', 'http.external'],
      code: 'MODULE_HTTP_PERMISSION_MISSING',
      fix: 'Add Permission.ExternalHttp and a narrow egress origin to module.ts.',
    },
    {
      token: 'ctx.cache',
      permissions: ['Permission.CacheRevalidate', 'cache.revalidate'],
      code: 'MODULE_CACHE_PERMISSION_MISSING',
      fix: 'Add Permission.CacheRevalidate to module.ts.',
    },
    {
      token: 'ctx.audit',
      permissions: ['Permission.AuditWrite', 'audit.write'],
      code: 'MODULE_AUDIT_PERMISSION_MISSING',
      fix: 'Add Permission.AuditWrite to module.ts.',
    },
    {
      token: 'ctx.ai',
      permissions: ['Permission.AiGenerate', 'Permission.AiEmbed', 'ai.generate', 'ai.embed'],
      code: 'MODULE_AI_PERMISSION_MISSING',
      fix: 'Add Permission.AiGenerate or Permission.AiEmbed to module.ts.',
    },
    {
      token: 'ctx.rag',
      permissions: ['Permission.RagRead', 'Permission.RagWrite', 'rag.read', 'rag.write'],
      code: 'MODULE_RAG_PERMISSION_MISSING',
      fix: 'Add Permission.RagRead or Permission.RagWrite to module.ts.',
    },
    {
      token: 'ctx.usage',
      permissions: ['Permission.UsageWrite', 'usage.write'],
      code: 'MODULE_USAGE_PERMISSION_MISSING',
      fix: 'Add Permission.UsageWrite to module.ts.',
    },
    {
      token: 'ctx.metering',
      permissions: ['Permission.MeteringWrite', 'metering.write'],
      code: 'MODULE_METERING_PERMISSION_MISSING',
      fix: 'Add Permission.MeteringWrite to module.ts.',
    },
    {
      token: 'ctx.credits',
      permissions: [
        'Permission.CreditsRead',
        'Permission.CreditsConsume',
        'Permission.CreditsWrite',
        'credits.read',
        'credits.consume',
        'credits.write',
      ],
      code: 'MODULE_CREDITS_PERMISSION_MISSING',
      fix: 'Add the matching Credits permission to module.ts.',
    },
    {
      token: 'ctx.billing',
      permissions: ['Permission.BillingRead', 'Permission.BillingWrite', 'billing.read', 'billing.write'],
      code: 'MODULE_BILLING_PERMISSION_MISSING',
      fix: 'Add Permission.BillingRead or Permission.BillingWrite to module.ts.',
    },
    {
      token: 'ctx.commerce',
      permissions: ['Permission.CommerceRead', 'Permission.CommerceWrite', 'commerce.read', 'commerce.write'],
      code: 'MODULE_COMMERCE_PERMISSION_MISSING',
      fix: 'Add Permission.CommerceRead or Permission.CommerceWrite to module.ts.',
    },
  ];

  for (const check of checks) {
    if (code.includes(check.token) && !hasAnyPermission(moduleSource, check.permissions)) {
      diagnostics.push(
        diagnostic(
          'error',
          check.code,
          `${check.token} is used but module.ts does not declare the matching permission.`,
          check.token,
          check.fix
        )
      );
    }
  }
}

function checkCapabilityDeclarations(moduleRoot, moduleSource, diagnostics) {
  const code = moduleCode(moduleRoot);
  const configSource = extractObjectAfterKey(moduleSource, 'config');
  const declarationChecks = [
    {
      token: 'ctx.config',
      hasDeclaration: /\bconfig\s*:/.test(moduleSource),
      code: 'MODULE_CONFIG_DECLARATION_MISSING',
      pathValue: 'config',
      fix: 'Declare config fields in module.ts and read them through ctx.config.',
    },
    {
      token: 'ctx.secrets',
      hasDeclaration: /\bsecret\s*:\s*true\b/.test(configSource),
      code: 'MODULE_SECRET_CONFIG_DECLARATION_MISSING',
      pathValue: 'config',
      fix: 'Declare at least one config field with secret: true and read it through ctx.secrets.',
    },
    {
      token: 'ctx.services',
      hasDeclaration: /\bserviceRequirements\s*:/.test(moduleSource),
      code: 'MODULE_SERVICE_REQUIREMENT_MISSING',
      pathValue: 'serviceRequirements',
      fix: 'Declare serviceRequirements in module.ts so provider readiness can be checked.',
    },
    {
      token: 'ctx.resourceBindings',
      hasDeclaration: /\bresourceBindings\s*:/.test(moduleSource),
      code: 'MODULE_RESOURCE_BINDING_DECLARATION_MISSING',
      pathValue: 'resourceBindings',
      fix: 'Declare resourceBindings in module.ts so host resources are explicit.',
    },
  ];

  for (const check of declarationChecks) {
    if (code.includes(check.token) && !check.hasDeclaration) {
      diagnostics.push(
        diagnostic(
          'error',
          check.code,
          `${check.token} is used but module.ts does not declare the matching contract metadata.`,
          check.pathValue,
          check.fix
        )
      );
    }
  }
}

function checkPrivilegedServiceSourceUsage(moduleRoot, moduleSource, diagnostics) {
  if (!/\bserviceRequirements\s*:/.test(moduleSource)) {
    return;
  }
  const code = moduleCode(moduleRoot);
  if (/\bctx\.http\.fetch\s*\(/.test(code)) {
    const serviceOrigins = new Set(
      extractStringArray(moduleSource, 'egress').map(originForUrl).filter(Boolean)
    );
    const fetchOrigins = extractStaticHttpFetchOrigins(code);
    const overlapsPrivilegedService =
      fetchOrigins.length === 0 || fetchOrigins.some((origin) => serviceOrigins.has(origin));
    if (!overlapsPrivilegedService) {
      return;
    }
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_PRIVILEGED_HTTP_FORBIDDEN',
        'Modules that declare privileged serviceRequirements must not call the same service through ctx.http.fetch.',
        'serviceRequirements',
        'Use ctx.services.invoke(serviceName, operationName, input) so runtime can sign, redact and audit the request.'
      )
    );
  }
  if (/authorization\s*:\s*['"`]\s*Bearer\s+/i.test(code) || /x-[\w-]*signature\s*['"`]?\s*:/i.test(code)) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_SECRET_LITERAL_FORBIDDEN',
        'Module source appears to construct privileged service credentials or signature headers.',
        'serviceRequirements',
        'Declare service secrets in serviceRequirements and let runtime inject bearer/HMAC headers.'
      )
    );
  }
}

function checkHttpEgress(moduleRoot, moduleSource, diagnostics) {
  const code = moduleCode(moduleRoot);
  const usesHttpFetch = /\bctx\.http\.fetch\s*\(/.test(code);
  const egressOrigins = extractStringArray(moduleSource, 'egress');
  const hasExternalHttpPermission =
    moduleSource.includes('Permission.ExternalHttp') || moduleSource.includes('http.external');

  if (usesHttpFetch && egressOrigins.length === 0) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_HTTP_EGRESS_MISSING',
        'ctx.http.fetch is used but module.ts does not declare egress origins.',
        'egress',
        'Declare egress: ["https://api.example.com"] with the exact allowed origin.'
      )
    );
  }

  if (egressOrigins.length > 0 && !hasExternalHttpPermission) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_EGRESS_PERMISSION_REQUIRED',
        'Modules that declare egress origins must also declare Permission.ExternalHttp.',
        'permissions',
        'Add Permission.ExternalHttp or remove the unused egress declaration.'
      )
    );
  }

  if (hasExternalHttpPermission && egressOrigins.length === 0) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_HTTP_EGRESS_REQUIRED',
        'Permission.ExternalHttp requires at least one explicit egress origin.',
        'egress',
        'Declare egress: ["https://api.example.com"].'
      )
    );
  }

  for (const [index, origin] of egressOrigins.entries()) {
    if (!EGRESS_ORIGIN_PATTERN.test(origin) || origin.includes('*')) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_EGRESS_ORIGIN_INVALID',
          `Egress origin "${origin}" must be an explicit http(s) origin.`,
          `egress.${index}`,
          'Use an origin like "https://api.example.com".'
        )
      );
    }
  }
}

function checkPublicRouteContracts(source, diagnostics) {
  for (const [index, route] of extractRouteObjects(source, 'site').entries()) {
    if (!hasStringProperty(route, 'auth', 'public')) {
      continue;
    }

    if (!/\bmetadata\s*:/.test(route)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_PUBLIC_SITE_METADATA_REQUIRED',
          'Public site routes must declare a metadata loader.',
          `routes.site.${index}.metadata`,
          'Add metadata: "./loaders/metadata" and return title, description, and canonical.'
        )
      );
    }

    if (!/\bcache\s*:/.test(route)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_PUBLIC_SITE_CACHE_REQUIRED',
          'Public site routes must declare an explicit cache strategy.',
          `routes.site.${index}.cache`,
          'Add cache: { strategy: "public", revalidateSeconds: 300, tags: ["module-id"] } or strategy: "none".'
        )
      );
    }

    if (/\bstrategy\s*:\s*['"`]private['"`]/.test(route)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_PUBLIC_ROUTE_PRIVATE_CACHE',
          'Public routes cannot use private cache strategy.',
          `routes.site.${index}.cache.strategy`,
          'Use "public" or "none".'
        )
      );
    }

    const revalidate = route.match(/\brevalidateSeconds\s*:\s*(-?\d+)/)?.[1];
    if (revalidate && Number(revalidate) <= 0) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_ROUTE_CACHE_REVALIDATE_INVALID',
          'Cache revalidateSeconds must be a positive integer when declared.',
          `routes.site.${index}.cache.revalidateSeconds`
        )
      );
    }
  }

  for (const [index, route] of extractRouteObjects(source, 'api').entries()) {
    if (!hasStringProperty(route, 'auth', 'public')) {
      continue;
    }

    if (!/\banonymousPolicy\b/.test(route)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_PUBLIC_API_ANONYMOUS_POLICY_REQUIRED',
          'Public API routes must declare anonymousPolicy.',
          `routes.api.${index}.anonymousPolicy`,
          'Add anonymousPolicy with rateLimit, upload, captcha, or high-cost policy.'
        )
      );
      continue;
    }

    const policy = resolveAnonymousPolicySource(route, source);
    if (!policy) {
      continue;
    }

    if (!/\brateLimit\s*:/.test(policy)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_PUBLIC_API_RATE_LIMIT_REQUIRED',
          'Public API routes must declare anonymousPolicy.rateLimit.',
          `routes.api.${index}.anonymousPolicy.rateLimit`,
          'Add an IP, route, module, method, or custom bucket rate limit.'
        )
      );
    }

    const limit = policy.match(/\blimit\s*:\s*(-?\d+)/)?.[1];
    if (limit && Number(limit) <= 0) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_PUBLIC_API_RATE_LIMIT_INVALID',
          'anonymousPolicy.rateLimit.limit must be a positive integer.',
          `routes.api.${index}.anonymousPolicy.rateLimit.limit`
        )
      );
    }

    const windowValue = policy.match(/\bwindow\s*:\s*['"`]([^'"`]+)['"`]/)?.[1];
    if (windowValue && !RATE_LIMIT_WINDOW_PATTERN.test(windowValue)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_PUBLIC_API_RATE_LIMIT_WINDOW_INVALID',
          'anonymousPolicy.rateLimit.window must use a duration such as "30s", "1m", or "1h".',
          `routes.api.${index}.anonymousPolicy.rateLimit.window`
        )
      );
    }

    const maxUploadBytes = policy.match(/\bmaxUploadBytes\s*:\s*(-?\d+)/)?.[1];
    if (maxUploadBytes && Number(maxUploadBytes) <= 0) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_PUBLIC_API_UPLOAD_LIMIT_INVALID',
          'anonymousPolicy.maxUploadBytes must be a positive integer when declared.',
          `routes.api.${index}.anonymousPolicy.maxUploadBytes`
        )
      );
    }

    const captcha = policy.match(/\bcaptcha\s*:\s*['"`]([^'"`]+)['"`]/)?.[1];
    if (captcha && !['never', 'auto', 'always'].includes(captcha)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_PUBLIC_API_CAPTCHA_INVALID',
          `Anonymous captcha policy "${captcha}" is not supported.`,
          `routes.api.${index}.anonymousPolicy.captcha`,
          'Use "never", "auto", or "always".'
        )
      );
    }

    if (/\bcommercial\s*:/.test(route) && /\ballowHighCostActions\s*:\s*true\b/.test(policy)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_PUBLIC_API_HIGH_COST_ANONYMOUS_FORBIDDEN',
          'Public commercial API routes cannot allow anonymous high-cost actions.',
          `routes.api.${index}.anonymousPolicy.allowHighCostActions`,
          'Set allowHighCostActions: false and require auth for high-cost execution.'
        )
      );
    }
  }
}

function extractImportSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"`]*?\s+from\s+)?['"`]([^'"`]+)['"`]/g,
    /\bexport\s+(?:type\s+)?[^'"`]*?\s+from\s+['"`]([^'"`]+)['"`]/g,
    /\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }
  return [...new Set(specifiers)];
}

function isPathInsideDirectory(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function checkSourceSafety(moduleRoot, diagnostics) {
  for (const file of listModuleSourceFiles(moduleRoot)) {
    const source = fs.readFileSync(file, 'utf8');
    const projectPath = toProjectPath(file);

    for (const specifier of extractImportSpecifiers(source)) {
      const normalizedSpecifier = specifier.replace(/\\/g, '/');
      const builtin = normalizedSpecifier.replace(/^node:/, '').split('/')[0];

      if (
        normalizedSpecifier.includes('src/lib') ||
        normalizedSpecifier.includes('apps/host-next') ||
        normalizedSpecifier.startsWith('@host/') ||
        normalizedSpecifier.startsWith('@/lib/module-runtime')
      ) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_HOST_IMPORT_FORBIDDEN',
            'Module code must not import host internals.',
            projectPath,
            'Use @ploykit/module-sdk and ctx capabilities instead.'
          )
        );
      }

      if (normalizedSpecifier.startsWith('.')) {
        const resolved = path.resolve(path.dirname(file), normalizedSpecifier);
        if (!isPathInsideDirectory(moduleRoot, resolved)) {
          diagnostics.push(
            diagnostic(
              'error',
              'MODULE_SOURCE_IMPORT_ESCAPES_ROOT',
              `Module source import "${specifier}" must not escape the module root.`,
              projectPath,
              'Move shared code inside the module root or expose it through @ploykit/module-sdk.'
            )
          );
        }
      }

      if (NODE_BUILTINS.has(builtin)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_NODE_BUILTIN_FORBIDDEN',
            `Module code must not import Node builtin "${specifier}".`,
            projectPath,
            'Move privileged IO into a host service or connector capability.'
          )
        );
      }
    }

    if (/\bprocess\.env\b/.test(source)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_PROCESS_ENV_FORBIDDEN',
          'Module code must not read process.env directly.',
          projectPath,
          'Use ctx.config or ctx.secrets.'
        )
      );
    }

    if (/\bctx\s*\[/.test(source)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DYNAMIC_CTX_ACCESS_FORBIDDEN',
          'Module code must not access ctx with dynamic property names.',
          projectPath,
          'Use explicit ctx capabilities so doctor can map permissions.'
        )
      );
    }

    if (/\beval\s*\(|\bnew\s+Function\s*\(|(?<!function\s+)\bFunction\s*\(/.test(source)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DYNAMIC_CODE_FORBIDDEN',
          'Module code must not use eval or Function constructors.',
          projectPath,
          'Use normal module code and declared handlers.'
        )
      );
    }

    if (/\bimport\s*\(\s*(?!['"`])/.test(source)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DYNAMIC_IMPORT_FORBIDDEN',
          'Module code must not use dynamic import specifiers.',
          projectPath,
          'Use static imports so doctor can validate source boundaries.'
        )
      );
    }

    if (/\brequire\s*\(\s*(?!['"`])/.test(source)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DYNAMIC_REQUIRE_FORBIDDEN',
          'Module code must not use dynamic require specifiers.',
          projectPath,
          'Use static imports so doctor can validate source boundaries.'
        )
      );
    }

    if (/(?<![\w.])fetch\s*\(/.test(source)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_RAW_FETCH_FORBIDDEN',
          'Module code must not call global fetch directly.',
          projectPath,
          'Use ctx.http.fetch and declare Permission.ExternalHttp with a narrow egress origin.'
        )
      );
    }
  }
}

function checkHandlerDefinitions(moduleRoot, moduleSource, diagnostics) {
  for (const localPath of extractHandlerPaths(moduleSource)) {
    const resolved = normalizeLocalModulePath(moduleRoot, localPath);
    if (!fs.existsSync(resolved)) {
      continue;
    }
    const source = fs.readFileSync(resolved, 'utf8');
    if (localPath.startsWith('./api/') && !source.includes('defineApi')) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_API_DEFINE_API_REQUIRED',
          `API handler "${localPath}" must export defineApi(...).`,
          toProjectPath(resolved),
          'Wrap the API methods with defineApi({ get, post, ... }).'
        )
      );
    }
    if (
      localPath.startsWith('./actions/') &&
      !source.includes('action(') &&
      !source.includes('defineAction')
    ) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_ACTION_DEFINE_ACTION_REQUIRED',
          `Action handler "${localPath}" must export action(...) or defineAction(...).`,
          toProjectPath(resolved),
          'Wrap the action handler with action(async (ctx, input) => ...).'
        )
      );
    }
  }
}

function checkContractPartFiles(moduleRoot, moduleSource, diagnostics) {
  for (const part of extractContractParts(moduleSource)) {
    const resolved = normalizeLocalModulePath(moduleRoot, part.localPath);
    if (!fs.existsSync(resolved)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_PART_FILE_MISSING',
          `Contract part "${part.part}" points at missing file "${part.localPath}".`,
          part.localPath,
          'Create the part file or remove the parts entry.',
          { part: part.part },
          locateInSource(moduleSource, part.localPath)
        )
      );
      continue;
    }

    const partSource = fs.readFileSync(resolved, 'utf8');
    const expected = PART_EXPECTED_EXPORTS[part.part];
    if (expected && !expected.test(partSource)) {
      diagnostics.push(
        diagnostic(
          'warning',
          'MODULE_PART_EXPORT_UNCLEAR',
          `Contract part "${part.part}" does not expose an obvious ${part.part} export.`,
          toProjectPath(resolved),
          `Export a named "${part.part}" value or make this file's purpose clear.`,
          { part: part.part }
        )
      );
    }
  }
}

function extractDeclaredNpmDependencies(source) {
  const packages = new Set();
  const npmArray = source.match(/\bnpm\s*:\s*\[([\s\S]*?)\]/)?.[1];
  if (npmArray) {
    for (const match of npmArray.matchAll(/['"`]([^'"`]+)['"`]/g)) {
      packages.add(match[1]);
    }
  }

  const npmObject = source.match(/\bnpm\s*:\s*{([\s\S]*?)}/)?.[1];
  if (npmObject) {
    for (const match of npmObject.matchAll(/['"`]([^'"`]+)['"`]\s*:/g)) {
      packages.add(match[1]);
    }
  }

  return [...packages].sort();
}

function checkModuleDependencies(source, diagnostics) {
  const dependencies = extractDeclaredNpmDependencies(source);
  if (dependencies.length === 0) {
    return;
  }

  const packageManifest = readPackageManifest();
  const hostDependencies = {
    ...(packageManifest.dependencies ?? {}),
    ...(packageManifest.devDependencies ?? {}),
  };

  for (const dependency of dependencies) {
    if (!hostDependencies[dependency]) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DEPENDENCY_NOT_HOST_RUNTIME',
          `Module dependency "${dependency}" is not declared by the host runtime package.`,
          `dependencies.npm.${dependency}`,
          `Add "${dependency}" to package.json dependencies or remove it from module.ts.`
        )
      );
    }
  }
}

function checkDataArtifacts(moduleRoot, source, diagnostics) {
  if (!hasDataDefinition(source)) {
    return;
  }

  const migrationMode = extractMigrationMode(source);
  const hasMigrations = hasDataMigrationsDeclaration(source);
  const hasPhysicalData = hasPhysicalDataDefinition(source);

  if (hasPhysicalData && !hasMigrations) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_DATA_MIGRATIONS_REQUIRED',
        'Physical Data v2 definitions must declare an explicit migrations block.',
        'data.migrations',
        'Add migrations: { mode: "generated", dir: "./migrations" } or use mode: "sql".'
      )
    );
  }

  if (hasMigrations && !DATA_MIGRATION_MODES.has(migrationMode)) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_DATA_MIGRATION_MODE_INVALID',
        `Data migration mode "${migrationMode ?? '(missing)'}" is not supported.`,
        'data.migrations.mode',
        'Use "generated" or "sql".'
      )
    );
  }

  const generatedDir = path.join(moduleRoot, '.ploykit', 'generated');
  checkFileExists(
    diagnostics,
    path.join(generatedDir, 'data-plan.json'),
    'MODULE_DATA_PLAN_MISSING',
    'Data definition exists, but generated data plan is missing.',
    'Run npm run data:generate.'
  );
  checkFileExists(
    diagnostics,
    path.join(generatedDir, 'data-types.ts'),
    'MODULE_DATA_TYPES_MISSING',
    'Data definition exists, but generated data types are missing.',
    'Run npm run data:types.'
  );

  if (hasGeneratedMigrations(source)) {
    checkFileExists(
      diagnostics,
      path.join(moduleRoot, extractMigrationDir(source).replace(/^\.\//, ''), '0001_generated.sql'),
      'MODULE_DATA_MIGRATION_MISSING',
      'Generated data migration is missing.',
      'Run npm run data:generate.'
    );
  }

  if (migrationMode === 'sql') {
    const migrationDir = path.join(moduleRoot, extractMigrationDir(source).replace(/^\.\//, ''));
    const sqlFiles = fs.existsSync(migrationDir)
      ? fs.readdirSync(migrationDir).filter((file) => file.endsWith('.sql'))
      : [];
    if (sqlFiles.length === 0) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DATA_SQL_MIGRATION_MISSING',
          'SQL migration mode requires at least one .sql migration file.',
          toProjectPath(migrationDir),
          'Create a SQL migration file in the declared data.migrations.dir.'
        )
      );
    }
  }
}

function extractLifecycleEntries(source) {
  const lifecycleSource = extractObjectAfterKey(source, 'lifecycle');
  if (!lifecycleSource) {
    return [];
  }

  const entries = [];
  const unquotedPattern = /\b([A-Za-z_$][\w$]*)\s*:\s*['"`](\.\/[^'"`]+)['"`]/g;
  for (const match of lifecycleSource.matchAll(unquotedPattern)) {
    entries.push({ hook: match[1], localPath: match[2] });
  }

  const quotedPattern = /['"`]([^'"`]+)['"`]\s*:\s*['"`](\.\/[^'"`]+)['"`]/g;
  for (const match of lifecycleSource.matchAll(quotedPattern)) {
    entries.push({ hook: match[1], localPath: match[2] });
  }

  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.hook}:${entry.localPath}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function hasDefaultExport(source) {
  return /\bexport\s+default\b/.test(source) || /\bexport\s*{[^}]+\bas\s+default\b/.test(source);
}

function checkLifecycleContracts(moduleRoot, source, diagnostics) {
  for (const entry of extractLifecycleEntries(source)) {
    if (!LIFECYCLE_HOOKS.has(entry.hook)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_LIFECYCLE_HOOK_UNKNOWN',
          `Lifecycle hook "${entry.hook}" is not supported.`,
          `lifecycle.${entry.hook}`,
          `Use one of ${[...LIFECYCLE_HOOKS].join(', ')}.`
        )
      );
    }

    const resolved = normalizeLocalModulePath(moduleRoot, entry.localPath);
    if (!fs.existsSync(resolved)) {
      continue;
    }

    if (!hasDefaultExport(fs.readFileSync(resolved, 'utf8'))) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_LIFECYCLE_HANDLER_EXPORT_REQUIRED',
          `Lifecycle handler "${entry.localPath}" must provide a default export.`,
          toProjectPath(resolved),
          'Export a default function or an object with a run(ctx, event) method.'
        )
      );
    }
  }
}

function checkModuleMapManifest(moduleRoot, moduleId, diagnostics) {
  if (!fs.existsSync(MODULE_MAP_MANIFEST_FILE)) {
    diagnostics.push(
      diagnostic(
        'warning',
        'MODULE_MAP_MANIFEST_MISSING',
        'Module map manifest is missing.',
        toProjectPath(MODULE_MAP_MANIFEST_FILE),
        'Run npm run modules:scan.'
      )
    );
    return;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(MODULE_MAP_MANIFEST_FILE, 'utf8'));
    const rootDir = toProjectPath(moduleRoot);
    const found = (manifest.modules ?? []).find(
      (moduleInfo) => moduleInfo.id === moduleId && moduleInfo.rootDir === rootDir
    );
    if (!found) {
      diagnostics.push(
        diagnostic(
          'warning',
          'MODULE_MAP_MANIFEST_STALE',
          `Module "${moduleId}" is not present in the generated module map manifest.`,
          toProjectPath(MODULE_MAP_MANIFEST_FILE),
          'Run npm run modules:scan.'
        )
      );
      return;
    }

    if (!found.release) {
      diagnostics.push(
        diagnostic(
          'warning',
          'MODULE_MAP_RELEASE_METADATA_MISSING',
          `Module "${moduleId}" is present in module map, but release metadata is missing.`,
          toProjectPath(MODULE_MAP_MANIFEST_FILE),
          'Run npm run modules:scan.'
        )
      );
      return;
    }

    const actualSourceHash = sourceHash(moduleRoot);
    if (found.release.sourceHash !== actualSourceHash) {
      diagnostics.push(
        diagnostic(
          'warning',
          'MODULE_MAP_SOURCE_HASH_DRIFT',
          `Module "${moduleId}" source hash differs from generated module map.`,
          toProjectPath(MODULE_MAP_MANIFEST_FILE),
          'Run npm run modules:scan.',
          {
            expected: found.release.sourceHash,
            actual: actualSourceHash,
          }
        )
      );
    }

    const actualContractDigest = contractSourceDigest(moduleRoot);
    if (found.release.contractDigest !== actualContractDigest) {
      diagnostics.push(
        diagnostic(
          'warning',
          'MODULE_MAP_CONTRACT_DIGEST_DRIFT',
          `Module "${moduleId}" contract digest differs from generated module map.`,
          toProjectPath(MODULE_MAP_MANIFEST_FILE),
          'Run npm run modules:scan.',
          {
            expected: found.release.contractDigest,
            actual: actualContractDigest,
          }
        )
      );
    }
  } catch (error) {
    diagnostics.push(
      diagnostic(
        'warning',
        'MODULE_MAP_MANIFEST_INVALID',
        error instanceof Error ? error.message : String(error),
        toProjectPath(MODULE_MAP_MANIFEST_FILE),
        'Run npm run modules:scan.'
      )
    );
  }
}

async function doctorModule(moduleRoot) {
  const diagnostics = [];
  const moduleFile = path.join(moduleRoot, 'module.ts');

  if (!fs.existsSync(moduleFile)) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_FILE_MISSING',
        `Module root "${toProjectPath(moduleRoot)}" does not contain module.ts.`,
        'module.ts',
        'Create module.ts with defineModule(...).'
      )
    );
    return {
      moduleRoot: toProjectPath(moduleRoot),
      moduleId: path.basename(moduleRoot),
      success: false,
      diagnostics,
    };
  }

  const source = fs.readFileSync(moduleFile, 'utf8');
  const moduleId = extractString(source, 'id');
  const name = extractString(source, 'name');
  const version = extractString(source, 'version');

  if (!source.includes('defineModule')) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_DEFINE_MODULE_MISSING',
        'module.ts must call defineModule(...).',
        'module.ts',
        'Import and use defineModule from @ploykit/module-sdk.'
      )
    );
  }

  if (!moduleId) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_ID_REQUIRED',
        'Module id is required.',
        'id',
        'Add id: "my-module".'
      )
    );
  } else if (!MODULE_ID_PATTERN.test(moduleId)) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_ID_INVALID',
        `Module id "${moduleId}" must contain only lowercase letters, numbers, and hyphens.`,
        'id',
        'Use an id like "cms", "shop", or "workflow".'
      )
    );
  }

  if (!name) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_NAME_REQUIRED',
        'Module name is required.',
        'name',
        'Add a readable module name.'
      )
    );
  }

  if (!version) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_VERSION_REQUIRED',
        'Module version is required.',
        'version',
        'Add version: "0.1.0".'
      )
    );
  } else if (!SEMVER_PATTERN.test(version)) {
    diagnostics.push(
      diagnostic(
        'error',
        'MODULE_VERSION_INVALID',
        `Module version "${version}" must follow semantic versioning.`,
        'version',
        'Use a version like "0.1.0".'
      )
    );
  }

  for (const localPath of extractAllContractLocalPaths(source)) {
    if (localPath.includes('../')) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_LOCAL_PATH_ESCAPES_ROOT',
          `Module local path "${localPath}" must not escape the module root.`,
          localPath,
          undefined,
          undefined,
          locateInSource(source, localPath)
        )
      );
      continue;
    }

    if (localPath === './module-sdk' || localPath.startsWith('./.')) {
      continue;
    }

    const resolved = normalizeLocalModulePath(moduleRoot, localPath);
    if (!fs.existsSync(resolved)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_LOCAL_PATH_MISSING',
          `Module local path "${localPath}" does not resolve to a file.`,
          localPath,
          'Create the referenced file inside the module directory or update module.ts.',
          undefined,
          locateInSource(source, localPath)
        )
      );
    }
  }

  checkContractPartFiles(moduleRoot, source, diagnostics);
  checkDataArtifacts(moduleRoot, source, diagnostics);
  checkPublicAliases(source, diagnostics);
  checkResourceKinds(source, diagnostics);
  checkEventNames(source, diagnostics);
  checkWebhookSignatures(source, diagnostics);
  checkCapabilityPermissions(moduleRoot, source, diagnostics);
  checkCapabilityDeclarations(moduleRoot, source, diagnostics);
  checkPrivilegedServiceSourceUsage(moduleRoot, source, diagnostics);
  checkHttpEgress(moduleRoot, source, diagnostics);
  checkPublicRouteContracts(source, diagnostics);
  checkLifecycleContracts(moduleRoot, source, diagnostics);
  checkSourceSafety(moduleRoot, diagnostics);
  checkHandlerDefinitions(moduleRoot, source, diagnostics);
  checkModuleDependencies(source, diagnostics);
  await checkSdkContractValidation(moduleRoot, diagnostics);
  checkModuleMapManifest(moduleRoot, moduleId || path.basename(moduleRoot), diagnostics);
  const finalDiagnostics = dedupeDiagnostics(diagnostics);

  return {
    moduleRoot: toProjectPath(moduleRoot),
    moduleId: moduleId || path.basename(moduleRoot),
    success: !finalDiagnostics.some((item) => item.severity === 'error'),
    summary: {
      parts: extractContractParts(source).map((part) => part.part),
      sourceHash: sourceHash(moduleRoot),
      contractDigest: contractSourceDigest(moduleRoot),
      diagnostics: {
        errors: finalDiagnostics.filter((item) => item.severity === 'error').length,
        warnings: finalDiagnostics.filter((item) => item.severity === 'warning').length,
        infos: finalDiagnostics.filter((item) => item.severity === 'info').length,
      },
      categories: [...new Set(finalDiagnostics.map((item) => item.category).filter(Boolean))].sort(),
      subsystems: [...new Set(finalDiagnostics.map((item) => item.subsystem).filter(Boolean))].sort(),
    },
    diagnostics: finalDiagnostics,
  };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function commandDoctor(args) {
  const target = args[0] ?? 'modules';
  const roots = discoverModuleRoots(target);
  const result =
    roots.length === 1
      ? await doctorModule(roots[0])
      : {
          success: false,
          diagnostics: [
            diagnostic(
              'error',
              'MODULE_DOCTOR_TARGET_AMBIGUOUS',
              `Expected one module root, found ${roots.length}.`,
              target,
              'Pass a specific module directory such as modules/hello.'
            ),
          ],
        };
  printJson(result);
  if (!result.success) {
    process.exitCode = 1;
  }
}

async function commandCheck(args) {
  const target = args[0] ?? 'modules';
  const roots = discoverModuleRoots(target);
  const results = await Promise.all(roots.map(doctorModule));
  const success = results.every((result) => result.success);
  printJson({ success, count: results.length, results });
  if (!success) {
    process.exitCode = 1;
  }
}

async function commandValidateContractInternal(args) {
  const moduleRoot = path.resolve(PROJECT_ROOT, args[0] ?? '.');
  const diagnostics = await evaluateSdkContractValidation(moduleRoot);
  printJson({
    success: !diagnostics.some((item) => item.severity === 'error'),
    diagnostics,
  });
}

function commandInspect(args) {
  const target = args[0] ?? 'modules';
  const roots = discoverModuleRoots(target);
  const results = roots.map((root) => {
    const source = fs.readFileSync(path.join(root, 'module.ts'), 'utf8');
    return {
      moduleRoot: toProjectPath(root),
      id: extractString(source, 'id') || path.basename(root),
      name: extractString(source, 'name') || null,
      version: extractString(source, 'version') || null,
      localPaths: extractAllContractLocalPaths(source),
      parts: extractContractParts(source),
      sourceHash: sourceHash(root),
      contractDigest: contractSourceDigest(root),
    };
  });
  printJson({ count: results.length, modules: results });
}

function parseCreateArgs(args) {
  let moduleId = null;
  let template = 'basic';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--template' || arg === '-t') {
      template = args[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (!moduleId) {
      moduleId = arg;
      continue;
    }

    if (!arg.startsWith('--')) {
      template = arg;
    }
  }

  return { moduleId, template };
}

function moduleDisplayName(moduleId) {
  return moduleId
    .split('-')
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function renderTemplateContent(content, variables) {
  return content
    .replaceAll('__MODULE_ID__', variables.moduleId)
    .replaceAll('__MODULE_NAME__', variables.moduleName);
}

function copyTemplateDirectory(sourceDir, targetDir, variables) {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyTemplateDirectory(source, target, variables);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const content = fs.readFileSync(source, 'utf8');
    fs.writeFileSync(target, renderTemplateContent(content, variables), 'utf8');
  }
}

function runLocalScript(script, args) {
  const result = childProcess.spawnSync(process.execPath, [script, ...args], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: node ${script} ${args.join(' ')}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join('\n')
    );
  }
}

function commandCreate(args) {
  const { moduleId, template } = parseCreateArgs(args);
  if (!moduleId || !MODULE_ID_PATTERN.test(moduleId)) {
    throw new Error(
      'Usage: npm run module:create -- <module-id> [--template basic|dashboard|crud|connector|signed-service|job|white-label|product-app]'
    );
  }

  if (!MODULE_TEMPLATES.has(template)) {
    throw new Error(
      `Unknown module template "${template}". Available: ${[...MODULE_TEMPLATES].join(', ')}.`
    );
  }

  const moduleRoot = path.join(PROJECT_ROOT, 'modules', moduleId);
  if (fs.existsSync(moduleRoot)) {
    throw new Error(`Module already exists: ${toProjectPath(moduleRoot)}`);
  }

  const templateRoot = path.join(PROJECT_ROOT, 'templates', 'modules', template);
  if (!fs.existsSync(templateRoot)) {
    throw new Error(`Template directory is missing: ${toProjectPath(templateRoot)}`);
  }

  copyTemplateDirectory(templateRoot, moduleRoot, {
    moduleId,
    moduleName: moduleDisplayName(moduleId),
  });

  if (template === 'crud') {
    runLocalScript(path.join('scripts', 'module-data.mjs'), ['generate', moduleRoot]);
    runLocalScript(path.join('scripts', 'module-data.mjs'), ['types', moduleRoot]);
  }

  runLocalScript(path.join('scripts', 'generate-module-map.mjs'), []);
  runLocalScript(path.join('scripts', 'ploykit-module.mjs'), ['doctor', moduleRoot]);

  printJson({
    success: true,
    moduleRoot: toProjectPath(moduleRoot),
    template,
    next: [
      `npm run module:doctor -- ${toProjectPath(moduleRoot)}`,
      `npm run module:test -- ${toProjectPath(moduleRoot)}`,
    ],
  });
}

function commandTemplates() {
  const templateRoot = path.join(PROJECT_ROOT, 'templates', 'modules');
  const templates = [...MODULE_TEMPLATES].sort().map((name) => {
    const dir = path.join(templateRoot, name);
    const files = fs.existsSync(dir)
      ? fs
          .readdirSync(dir, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => {
            const absolute = path.join(entry.parentPath ?? dir, entry.name);
            return slash(path.relative(dir, absolute));
          })
          .sort()
      : [];
    return {
      name,
      path: toProjectPath(dir),
      files,
    };
  });

  printJson({ success: true, templates });
}

function commandDev(args) {
  const target = args[0] ?? 'modules';
  runLocalScript(path.join('scripts', 'generate-module-map.mjs'), ['--check']);
  runLocalScript(path.join('scripts', 'ploykit-module.mjs'), ['check', target]);
  printJson({
    success: true,
    target,
    checks: ['modules:scan --check', 'modules:check'],
    next: [
      `npm run module:doctor -- ${target}`,
      `npm run module:test -- ${target}`,
      'npm run module:build',
    ],
  });
}

async function main() {
  const [, , command, ...args] = process.argv;

  try {
    switch (command) {
      case 'doctor':
        await commandDoctor(args);
        return;
      case 'check':
        await commandCheck(args);
        return;
      case 'validate-contract-internal':
        await commandValidateContractInternal(args);
        return;
      case 'inspect':
        commandInspect(args);
        return;
      case 'create':
        commandCreate(args);
        return;
      case 'templates':
        commandTemplates(args);
        return;
      case 'dev':
        commandDev(args);
        return;
      default:
        console.error(
          'Usage: ploykit-module <doctor|check|inspect|create|templates|dev> [...args]'
        );
        process.exitCode = 1;
    }
  } catch (error) {
    printJson({
      success: false,
      diagnostics: [
        diagnostic(
          'error',
          'MODULE_CLI_ERROR',
          error instanceof Error ? error.message : String(error)
        ),
      ],
    });
    process.exitCode = 1;
  }
}

try {
  await main();
} finally {
  await tsx.unregister();
}
