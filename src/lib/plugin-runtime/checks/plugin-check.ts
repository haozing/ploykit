import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { hasPluginDiagnosticErrors, type PluginDiagnostic } from '@/plugin-sdk/diagnostics';
import { Permission, type PermissionValue } from '@/plugin-sdk/permissions';
import { findPluginRoutePatternConflict } from '@/plugin-sdk/route-patterns';
import type { DefinedPlugin, PluginDefinition, PluginHttpMethod } from '@/plugin-sdk/types';
import { isDefinedPlugin, matchRuntimePathWithParams, normalizeRuntimePath } from '../contract';
import { normalizePluginAssetPath } from '../assets';

const SDK_IMPORTS = new Set([
  '@ploykit/plugin-sdk',
  '@ploykit/plugin-sdk/react',
  '@ploykit/plugin-sdk/testing',
]);

const FORBIDDEN_NEXT_IMPORT_PREFIX = 'next/';
const ALLOWED_EXTERNAL_IMPORTS = new Set([
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
]);

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'dist',
  'build',
  'coverage',
]);

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const NODE_BUILTINS = new Set(builtinModules.map((moduleName) => moduleName.replace(/^node:/, '')));

const PERMISSION_NAMES = new Map<PermissionValue, string>(
  Object.entries(Permission).map(([name, value]) => [value, name])
);
const DYNAMIC_CTX_CAPABILITY_PERMISSIONS = new Map<string, readonly PermissionValue[]>([
  ['ai', [Permission.AiGenerate, Permission.AiEmbed]],
  ['artifacts', [Permission.ArtifactsRead, Permission.ArtifactsWrite]],
  ['audit', [Permission.AuditWrite]],
  ['apiKeys', [Permission.ApiKeysRead, Permission.ApiKeysWrite]],
  ['billing', [Permission.BillingRead, Permission.BillingWrite]],
  ['config', [Permission.ConfigRead, Permission.ConfigWrite]],
  [
    'connectors',
    [Permission.ConnectorsRead, Permission.ConnectorsInvoke, Permission.ConnectorsManage],
  ],
  ['commerce', [Permission.CommerceRead, Permission.CommerceWrite]],
  ['credits', [Permission.CreditsRead, Permission.CreditsConsume, Permission.CreditsWrite]],
  ['events', [Permission.EventsEmit, Permission.EventsSubscribe]],
  ['files', [Permission.FilesRead, Permission.FilesWrite]],
  ['http', [Permission.ExternalHttp]],
  ['jobs', [Permission.JobsEnqueue, Permission.JobsRegister]],
  ['metering', [Permission.MeteringWrite]],
  ['notifications', [Permission.NotificationsSend]],
  ['rag', [Permission.RagRead, Permission.RagWrite]],
  ['rateLimit', [Permission.RateLimitCheck]],
  ['resourceBindings', [Permission.ResourceBindingsRead, Permission.ResourceBindingsWrite]],
  ['runs', [Permission.RunsRead, Permission.RunsWrite]],
  ['secrets', [Permission.SecretsRead, Permission.SecretsWrite]],
  ['services', [Permission.ServicesInvoke]],
  ['storage', [Permission.StorageRead, Permission.StorageWrite]],
  ['ui', [Permission.UiToast]],
  ['usage', [Permission.UsageWrite]],
  ['webhooks', [Permission.WebhookReceive]],
  ['workspace', [Permission.WorkspaceRead, Permission.WorkspaceWrite]],
]);

type PluginModule = Record<string, unknown>;
type RuntimeRequire = ((specifier: string) => unknown) & {
  resolve: (specifier: string) => string;
};

interface RuntimeModuleApi {
  createRequire: (filename: string) => RuntimeRequire;
  Module: new (id: string) => RuntimeCommonJsModule;
}

interface RuntimeCommonJsModule {
  exports: unknown;
  filename: string;
  paths: string[];
  require: RuntimeRequire;
  _compile: (code: string, filename: string) => void;
}

export interface PluginCheckPermissionUse {
  permission: PermissionValue;
  file: string;
  line: number;
  column: number;
  reason: string;
}

export interface PluginCheckHttpFetchUse {
  file: string;
  line: number;
  column: number;
  reason: string;
  url?: string;
  origin?: string;
  dynamic: boolean;
}

export interface PluginCheckServiceUse {
  file: string;
  line: number;
  column: number;
  service?: string;
  path?: string;
  method?: string;
  dynamic: boolean;
}

export interface PluginCheckResult {
  pluginId?: string;
  pluginPath: string;
  entryFile?: string;
  filesScanned: number;
  diagnostics: PluginDiagnostic[];
  success: boolean;
}

export interface PluginCheckReport {
  targetPath: string;
  checked: number;
  diagnostics: PluginDiagnostic[];
  plugins: PluginCheckResult[];
  success: boolean;
}

export interface PluginCheckOptions {
  loadContract?: (pluginRoot: string, entryFile: string) => Promise<PluginCheckContract | null>;
  allowedExternalImports?: readonly string[];
}

type PluginCheckContract = { id: string } & Partial<
  Pick<
    PluginDefinition,
    | 'trustLevel'
    | 'permissions'
    | 'routes'
    | 'menu'
    | 'slots'
    | 'hostPages'
    | 'config'
    | 'lifecycle'
    | 'jobs'
    | 'events'
    | 'webhooks'
    | 'hooks'
    | 'resources'
    | 'theme'
    | 'egress'
    | 'serviceRequirements'
    | 'resourceBindings'
  >
>;

interface PluginDependencyPolicy {
  allowedExternalImports: string[];
  dependencies: Record<string, string>;
  manifestPath?: string;
  malformed?: boolean;
}

interface ScannedFileResult {
  diagnostics: PluginDiagnostic[];
  permissionUses: Map<PermissionValue, PluginCheckPermissionUse>;
  httpFetchUses: PluginCheckHttpFetchUse[];
  serviceUses: PluginCheckServiceUse[];
  fileCount: number;
}

interface DynamicCapabilityAccess {
  accessPath: string;
  capability: string | null;
  permissions: readonly PermissionValue[];
}

interface AccessPathScan {
  segments: string[];
  dynamicIndex?: number;
}

interface RelativeImportResolution {
  resolvedPath: string;
  exists: boolean;
}

const LEGACY_PLUGIN_ENTRY_FILES = [
  'manifest.ts',
  'index.tsx',
  'api.ts',
  'lifecycle.ts',
  'hooks.ts',
];

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

function relativeToCwd(filePath: string): string {
  return toPosix(path.relative(process.cwd(), filePath));
}

function relativeToRoot(rootPath: string, filePath: string): string {
  return toPosix(path.relative(rootPath, filePath));
}

function createDiagnostic(
  code: string,
  severity: PluginDiagnostic['severity'],
  message: string,
  file: string,
  pathValue: string,
  fix?: string,
  details?: Record<string, unknown>
): PluginDiagnostic {
  return {
    code,
    severity,
    message,
    file,
    path: pathValue,
    fix,
    details,
  };
}

function isIgnoredDirectory(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name) || name.startsWith('.');
}

function isSourceFile(fileName: string): boolean {
  if (fileName.endsWith('.d.ts')) {
    return false;
  }

  return SOURCE_EXTENSIONS.some((extension) => fileName.endsWith(extension));
}

function hasLegacyPluginEntry(pluginRoot: string): boolean {
  return LEGACY_PLUGIN_ENTRY_FILES.some((fileName) =>
    fs.existsSync(path.join(pluginRoot, fileName))
  );
}

function listLegacyPluginEntries(pluginRoot: string): string[] {
  return LEGACY_PLUGIN_ENTRY_FILES.filter((fileName) =>
    fs.existsSync(path.join(pluginRoot, fileName))
  );
}

function isInsideRoot(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isSystemPluginRoot(pluginRoot: string): boolean {
  const systemPluginsRoot = path.resolve(process.cwd(), 'src/system-plugins');
  return isInsideRoot(path.resolve(pluginRoot), systemPluginsRoot);
}

function resolveRelativeImport(baseFile: string, specifier: string): RelativeImportResolution {
  const baseDir = path.dirname(baseFile);
  const directPath = path.resolve(baseDir, specifier);
  const candidates = [
    directPath,
    ...SOURCE_EXTENSIONS.map((extension) => `${directPath}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(directPath, `index${extension}`)),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return { resolvedPath: candidate, exists: true };
    }
  }

  return { resolvedPath: directPath, exists: false };
}

function normalizeSpecifier(specifier: string): string {
  return specifier.startsWith('node:') ? specifier.slice(5) : specifier;
}

function isNodeBuiltin(specifier: string): boolean {
  return NODE_BUILTINS.has(normalizeSpecifier(specifier));
}

function isAllowedSdkImport(specifier: string): boolean {
  if (SDK_IMPORTS.has(specifier)) {
    return true;
  }

  if (!specifier.startsWith('@ploykit/plugin-sdk/')) {
    return false;
  }

  return false;
}

function getExternalPackageName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/');
    return scope && name ? `${scope}/${name}` : specifier;
  }

  return specifier.split('/')[0] ?? specifier;
}

function isAllowedExternalImport(
  specifier: string,
  allowedExternalImports: readonly string[]
): boolean {
  const packageName = getExternalPackageName(specifier);
  return (
    ALLOWED_EXTERNAL_IMPORTS.has(specifier) ||
    ALLOWED_EXTERNAL_IMPORTS.has(packageName) ||
    allowedExternalImports.includes(specifier) ||
    allowedExternalImports.includes(packageName)
  );
}

function recordPermissionUse(
  permissionUses: Map<PermissionValue, PluginCheckPermissionUse>,
  permission: PermissionValue,
  file: string,
  node: ts.Node,
  reason: string,
  sourceFile: ts.SourceFile
): void {
  if (permissionUses.has(permission)) {
    return;
  }

  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile, false));
  permissionUses.set(permission, {
    permission,
    file,
    line: position.line + 1,
    column: position.character + 1,
    reason,
  });
}

function recordDeclaredPermissionUse(
  permissionUses: Map<PermissionValue, PluginCheckPermissionUse>,
  permission: PermissionValue,
  file: string,
  reason: string
): void {
  if (permissionUses.has(permission)) {
    return;
  }

  permissionUses.set(permission, {
    permission,
    file,
    line: 1,
    column: 1,
    reason,
  });
}

function formatPermissionReference(permission: PermissionValue): string {
  const permissionName = PERMISSION_NAMES.get(permission);
  return permissionName ? `Permission.${permissionName}` : `"${permission}"`;
}

function recordHttpFetchUse(
  httpFetchUses: PluginCheckHttpFetchUse[],
  file: string,
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  url?: string
): void {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile, false));
  const origin = url ? normalizeHttpOrigin(url) : null;

  httpFetchUses.push({
    file,
    line: position.line + 1,
    column: position.character + 1,
    reason: 'ctx.http.fetch',
    url,
    origin: origin ?? undefined,
    dynamic: !url,
  });
}

function recordServiceUse(
  serviceUses: PluginCheckServiceUse[],
  file: string,
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  service?: string,
  servicePath?: string,
  method?: string
): void {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile, false));
  serviceUses.push({
    file,
    line: position.line + 1,
    column: position.character + 1,
    service,
    path: servicePath,
    method,
    dynamic: !service || !servicePath,
  });
}

function normalizeHttpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function matchesPrefix(segments: readonly string[], prefix: readonly string[]): boolean {
  if (segments.length < prefix.length) {
    return false;
  }

  return prefix.every((segment, index) => segments[index] === segment);
}

function extractAccessSegments(expression: ts.Expression): string[] | null {
  if (ts.isParenthesizedExpression(expression)) {
    return extractAccessSegments(expression.expression);
  }

  if (
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return extractAccessSegments(expression.expression);
  }

  if (ts.isIdentifier(expression)) {
    return [expression.text];
  }

  if (ts.isPropertyAccessExpression(expression)) {
    const left = extractAccessSegments(expression.expression);
    return left ? [...left, expression.name.text] : null;
  }

  if (ts.isElementAccessExpression(expression)) {
    const left = extractAccessSegments(expression.expression);
    if (!left || !ts.isStringLiteralLike(expression.argumentExpression)) {
      return null;
    }

    return [...left, expression.argumentExpression.text];
  }

  if (ts.isCallExpression(expression)) {
    return extractAccessSegments(expression.expression);
  }

  return null;
}

function scanAccessPath(expression: ts.Expression): AccessPathScan | null {
  if (ts.isParenthesizedExpression(expression)) {
    return scanAccessPath(expression.expression);
  }

  if (
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return scanAccessPath(expression.expression);
  }

  if (ts.isIdentifier(expression)) {
    return { segments: [expression.text] };
  }

  if (ts.isPropertyAccessExpression(expression)) {
    const left = scanAccessPath(expression.expression);
    return left ? { ...left, segments: [...left.segments, expression.name.text] } : null;
  }

  if (ts.isElementAccessExpression(expression)) {
    const left = scanAccessPath(expression.expression);
    if (!left) {
      return null;
    }

    if (ts.isStringLiteralLike(expression.argumentExpression)) {
      return {
        ...left,
        segments: [...left.segments, expression.argumentExpression.text],
      };
    }

    return {
      segments: left.segments,
      dynamicIndex: left.dynamicIndex ?? left.segments.length,
    };
  }

  if (ts.isCallExpression(expression)) {
    return scanAccessPath(expression.expression);
  }

  return null;
}

function formatAccessPath(scan: AccessPathScan): string {
  if (scan.dynamicIndex === undefined) {
    return scan.segments.join('.');
  }

  return [
    ...scan.segments.slice(0, scan.dynamicIndex),
    '*',
    ...scan.segments.slice(scan.dynamicIndex),
  ].join('.');
}

function describeDynamicCapabilityAccess(
  expression: ts.Expression
): DynamicCapabilityAccess | null {
  const scan = scanAccessPath(expression);

  if (!scan || scan.dynamicIndex === undefined || scan.segments[0] !== 'ctx') {
    return null;
  }

  const capability = scan.dynamicIndex === 1 ? null : scan.segments[1];
  if (capability && !DYNAMIC_CTX_CAPABILITY_PERMISSIONS.has(capability)) {
    return null;
  }

  return {
    accessPath: formatAccessPath(scan),
    capability: capability ?? null,
    permissions: capability ? (DYNAMIC_CTX_CAPABILITY_PERMISSIONS.get(capability) ?? []) : [],
  };
}

function extractStaticHttpFetchUrl(argument: ts.Expression | undefined): string | undefined {
  if (!argument) {
    return undefined;
  }

  if (ts.isStringLiteralLike(argument)) {
    return argument.text;
  }

  if (
    ts.isNewExpression(argument) &&
    ts.isIdentifier(argument.expression) &&
    argument.expression.text === 'URL'
  ) {
    return extractStaticHttpFetchUrl(argument.arguments?.[0]);
  }

  return undefined;
}

function extractStaticString(argument: ts.Expression | undefined): string | undefined {
  return argument && ts.isStringLiteralLike(argument) ? argument.text : undefined;
}

function extractServicePathTemplate(argument: ts.Expression | undefined): string | undefined {
  if (!argument) {
    return undefined;
  }

  if (ts.isStringLiteralLike(argument)) {
    return argument.text;
  }

  if (!ts.isTemplateExpression(argument) && !ts.isNoSubstitutionTemplateLiteral(argument)) {
    return undefined;
  }

  if (ts.isNoSubstitutionTemplateLiteral(argument)) {
    return argument.text;
  }

  const segments: string[] = [argument.head.text];
  for (const span of argument.templateSpans) {
    segments.push(':param', span.literal.text);
  }

  return segments.join('');
}

function objectProperty(
  argument: ts.Expression | undefined,
  name: string
): ts.Expression | undefined {
  if (!argument || !ts.isObjectLiteralExpression(argument)) {
    return undefined;
  }

  const property = argument.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) &&
      ((ts.isIdentifier(candidate.name) && candidate.name.text === name) ||
        (ts.isStringLiteralLike(candidate.name) && candidate.name.text === name))
  );

  return property?.initializer;
}

function extractServiceRequestPath(argument: ts.Expression | undefined): string | undefined {
  if (!argument || !ts.isObjectLiteralExpression(argument)) {
    return extractServicePathTemplate(argument);
  }

  return (
    extractServicePathTemplate(objectProperty(argument, 'template')) ??
    extractServicePathTemplate(objectProperty(argument, 'path'))
  );
}

function extractServiceInitMethod(argument: ts.Expression | undefined): string | undefined {
  return extractStaticString(objectProperty(argument, 'method'));
}

function isExternalHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function isDirectFetchExpression(expression: ts.Expression): boolean {
  const chain = extractAccessSegments(expression);
  if (!chain) {
    return false;
  }

  if (chain.length === 1) {
    return chain[0] === 'fetch';
  }

  return (
    chain.length === 2 &&
    chain[1] === 'fetch' &&
    (chain[0] === 'globalThis' || chain[0] === 'window' || chain[0] === 'self')
  );
}

function isProcessEnvAccess(
  node: ts.Node
): node is ts.PropertyAccessExpression | ts.ElementAccessExpression {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) {
    return false;
  }

  const chain = extractAccessSegments(node);
  return !!chain && matchesPrefix(chain, ['process', 'env']);
}

function isNestedProcessEnvAccess(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression
): boolean {
  return isProcessEnvAccess(node.parent);
}

function captureCapabilityPermissions(
  permissionUses: Map<PermissionValue, PluginCheckPermissionUse>,
  httpFetchUses: PluginCheckHttpFetchUse[],
  serviceUses: PluginCheckServiceUse[],
  sourceFile: ts.SourceFile,
  filePath: string,
  node: ts.CallExpression
): void {
  const chain = extractAccessSegments(node.expression);
  if (!chain || chain[0] !== 'ctx') {
    return;
  }

  if (matchesPrefix(chain, ['ctx', 'files'])) {
    const method = chain[2];
    if (
      method === 'createUpload' ||
      method === 'completeUpload' ||
      method === 'createSignedUploadUrl' ||
      method === 'archive' ||
      method === 'delete'
    ) {
      recordPermissionUse(
        permissionUses,
        Permission.FilesWrite,
        filePath,
        node,
        `ctx.files.${method}`,
        sourceFile
      );
      return;
    }

    if (
      method === 'read' ||
      method === 'get' ||
      method === 'list' ||
      method === 'createSignedDownloadUrl'
    ) {
      recordPermissionUse(
        permissionUses,
        Permission.FilesRead,
        filePath,
        node,
        `ctx.files.${method}`,
        sourceFile
      );
      return;
    }
  }

  if (matchesPrefix(chain, ['ctx', 'artifacts'])) {
    const method = chain[2];
    if (method === 'readText' || method === 'list' || method === 'tree') {
      recordPermissionUse(
        permissionUses,
        Permission.ArtifactsRead,
        filePath,
        node,
        `ctx.artifacts.${method}`,
        sourceFile
      );
      return;
    }

    if (method === 'writeText' || method === 'updateMetadata' || method === 'delete') {
      recordPermissionUse(
        permissionUses,
        Permission.ArtifactsWrite,
        filePath,
        node,
        `ctx.artifacts.${method}`,
        sourceFile
      );
      return;
    }
  }

  if (matchesPrefix(chain, ['ctx', 'rag'])) {
    const method = chain[2];
    if (method === 'search' || method === 'buildContextPack') {
      recordPermissionUse(
        permissionUses,
        Permission.RagRead,
        filePath,
        node,
        `ctx.rag.${method}`,
        sourceFile
      );
      return;
    }

    if (method === 'index' || method === 'delete') {
      recordPermissionUse(
        permissionUses,
        Permission.RagWrite,
        filePath,
        node,
        `ctx.rag.${method}`,
        sourceFile
      );
      return;
    }
  }

  if (matchesPrefix(chain, ['ctx', 'ai'])) {
    const method = chain[2];
    if (method === 'generateText' || method === 'streamText') {
      recordPermissionUse(
        permissionUses,
        Permission.AiGenerate,
        filePath,
        node,
        `ctx.ai.${method}`,
        sourceFile
      );
      return;
    }

    if (method === 'embedText') {
      recordPermissionUse(
        permissionUses,
        Permission.AiEmbed,
        filePath,
        node,
        'ctx.ai.embedText',
        sourceFile
      );
      return;
    }
  }

  if (matchesPrefix(chain, ['ctx', 'workspace'])) {
    const method = chain[2];
    if (method === 'current' || method === 'list' || method === 'members' || method === 'hasRole') {
      recordPermissionUse(
        permissionUses,
        Permission.WorkspaceRead,
        filePath,
        node,
        `ctx.workspace.${method}`,
        sourceFile
      );
      return;
    }

    if (method === 'create' || method === 'invite') {
      recordPermissionUse(
        permissionUses,
        Permission.WorkspaceWrite,
        filePath,
        node,
        `ctx.workspace.${method}`,
        sourceFile
      );
      return;
    }
  }

  if (matchesPrefix(chain, ['ctx', 'runs'])) {
    const method = chain[2];
    if (method === 'get' || method === 'list') {
      recordPermissionUse(
        permissionUses,
        Permission.RunsRead,
        filePath,
        node,
        `ctx.runs.${method}`,
        sourceFile
      );
      return;
    }

    if (
      method === 'create' ||
      method === 'update' ||
      method === 'appendLog' ||
      method === 'addResult' ||
      method === 'complete' ||
      method === 'fail' ||
      method === 'requestCancel'
    ) {
      recordPermissionUse(
        permissionUses,
        Permission.RunsWrite,
        filePath,
        node,
        `ctx.runs.${method}`,
        sourceFile
      );
      return;
    }
  }

  if (matchesPrefix(chain, ['ctx', 'connectors'])) {
    const method = chain[2];
    if (method === 'get' || method === 'list') {
      recordPermissionUse(
        permissionUses,
        Permission.ConnectorsRead,
        filePath,
        node,
        `ctx.connectors.${method}`,
        sourceFile
      );
      return;
    }

    if (method === 'call' || method === 'createSignedCallback') {
      recordPermissionUse(
        permissionUses,
        Permission.ConnectorsInvoke,
        filePath,
        node,
        `ctx.connectors.${method}`,
        sourceFile
      );
      return;
    }

    if (method === 'upsert' || method === 'setStatus' || method === 'delete') {
      recordPermissionUse(
        permissionUses,
        Permission.ConnectorsManage,
        filePath,
        node,
        `ctx.connectors.${method}`,
        sourceFile
      );
      return;
    }
  }

  if (matchesPrefix(chain, ['ctx', 'resourceBindings'])) {
    const method = chain[2];
    if (method === 'get' || method === 'list') {
      recordPermissionUse(
        permissionUses,
        Permission.ResourceBindingsRead,
        filePath,
        node,
        `ctx.resourceBindings.${method}`,
        sourceFile
      );
      return;
    }

    if (method === 'upsert' || method === 'archive') {
      recordPermissionUse(
        permissionUses,
        Permission.ResourceBindingsWrite,
        filePath,
        node,
        `ctx.resourceBindings.${method}`,
        sourceFile
      );
      return;
    }
  }

  if (matchesPrefix(chain, ['ctx', 'apiKeys'])) {
    const method = chain[2];
    if (method === 'list') {
      recordPermissionUse(
        permissionUses,
        Permission.ApiKeysRead,
        filePath,
        node,
        'ctx.apiKeys.list',
        sourceFile
      );
      return;
    }

    if (method === 'create' || method === 'revoke') {
      recordPermissionUse(
        permissionUses,
        Permission.ApiKeysWrite,
        filePath,
        node,
        `ctx.apiKeys.${method}`,
        sourceFile
      );
      return;
    }
  }

  if (matchesPrefix(chain, ['ctx', 'rateLimit']) && chain[2] === 'check') {
    recordPermissionUse(
      permissionUses,
      Permission.RateLimitCheck,
      filePath,
      node,
      'ctx.rateLimit.check',
      sourceFile
    );
    return;
  }

  if (matchesPrefix(chain, ['ctx', 'events'])) {
    const method = chain[2];
    if (method === 'emit') {
      recordPermissionUse(
        permissionUses,
        Permission.EventsEmit,
        filePath,
        node,
        'ctx.events.emit',
        sourceFile
      );
      return;
    }

    if (method === 'on' || method === 'off') {
      recordPermissionUse(
        permissionUses,
        Permission.EventsSubscribe,
        filePath,
        node,
        `ctx.events.${method}`,
        sourceFile
      );
      return;
    }
  }

  if (matchesPrefix(chain, ['ctx', 'jobs'])) {
    const method = chain[2];
    if (method === 'enqueue') {
      recordPermissionUse(
        permissionUses,
        Permission.JobsEnqueue,
        filePath,
        node,
        'ctx.jobs.enqueue',
        sourceFile
      );
      return;
    }

    if (method === 'register') {
      recordPermissionUse(
        permissionUses,
        Permission.JobsRegister,
        filePath,
        node,
        'ctx.jobs.register',
        sourceFile
      );
      return;
    }
  }

  if (matchesPrefix(chain, ['ctx', 'webhooks'])) {
    const method = chain[2];
    if (method === 'verify' || method === 'respondAccepted') {
      recordPermissionUse(
        permissionUses,
        Permission.WebhookReceive,
        filePath,
        node,
        `ctx.webhooks.${method}`,
        sourceFile
      );
      return;
    }
  }

  if (matchesPrefix(chain, ['ctx', 'http']) && chain[2] === 'fetch') {
    recordPermissionUse(
      permissionUses,
      Permission.ExternalHttp,
      filePath,
      node,
      'ctx.http.fetch',
      sourceFile
    );
    const firstArgument = node.arguments[0];
    recordHttpFetchUse(
      httpFetchUses,
      filePath,
      node,
      sourceFile,
      extractStaticHttpFetchUrl(firstArgument)
    );
    return;
  }

  if (matchesPrefix(chain, ['ctx', 'services'])) {
    const method = chain[2];
    if (method === 'fetch' || method === 'json' || method === 'requestJson') {
      const requestArgument = node.arguments[1];
      recordPermissionUse(
        permissionUses,
        Permission.ServicesInvoke,
        filePath,
        node,
        `ctx.services.${method}`,
        sourceFile
      );
      recordServiceUse(
        serviceUses,
        filePath,
        node,
        sourceFile,
        extractStaticString(node.arguments[0]),
        extractServiceRequestPath(requestArgument),
        ts.isObjectLiteralExpression(requestArgument)
          ? extractServiceInitMethod(requestArgument)
          : extractServiceInitMethod(node.arguments[2])
      );
      return;
    }
  }

  if (matchesPrefix(chain, ['ctx', 'audit']) && chain[2] === 'record') {
    recordPermissionUse(
      permissionUses,
      Permission.AuditWrite,
      filePath,
      node,
      'ctx.audit.record',
      sourceFile
    );
    return;
  }

  if (matchesPrefix(chain, ['ctx', 'usage']) && chain[2] === 'increment') {
    recordPermissionUse(
      permissionUses,
      Permission.UsageWrite,
      filePath,
      node,
      'ctx.usage.increment',
      sourceFile
    );
    return;
  }

  if (matchesPrefix(chain, ['ctx', 'metering'])) {
    const method = chain[2];
    if (
      method === 'authorize' ||
      method === 'commit' ||
      method === 'refund' ||
      method === 'void' ||
      method === 'reconcile'
    ) {
      recordPermissionUse(
        permissionUses,
        Permission.MeteringWrite,
        filePath,
        node,
        `ctx.metering.${method}`,
        sourceFile
      );
      return;
    }
  }

  if (matchesPrefix(chain, ['ctx', 'credits'])) {
    const method = chain[2];
    if (method === 'getBalance') {
      recordPermissionUse(
        permissionUses,
        Permission.CreditsRead,
        filePath,
        node,
        'ctx.credits.getBalance',
        sourceFile
      );
      return;
    }

    if (method === 'consume') {
      recordPermissionUse(
        permissionUses,
        Permission.CreditsConsume,
        filePath,
        node,
        'ctx.credits.consume',
        sourceFile
      );
      return;
    }

    if (method === 'grant' || method === 'adjust' || method === 'refund') {
      recordPermissionUse(
        permissionUses,
        Permission.CreditsWrite,
        filePath,
        node,
        `ctx.credits.${method}`,
        sourceFile
      );
      return;
    }
  }

  if (matchesPrefix(chain, ['ctx', 'commerce'])) {
    const method = chain[2];
    if (method === 'createCheckout' || method === 'createOrder') {
      recordPermissionUse(
        permissionUses,
        Permission.CommerceWrite,
        filePath,
        node,
        `ctx.commerce.${method}`,
        sourceFile
      );
      return;
    }

    if (method === 'getOrder' || method === 'listOrders') {
      recordPermissionUse(
        permissionUses,
        Permission.CommerceRead,
        filePath,
        node,
        `ctx.commerce.${method}`,
        sourceFile
      );
      return;
    }
  }

  if (matchesPrefix(chain, ['ctx', 'billing'])) {
    const method = chain[2];
    if (method === 'getCurrentPlan' || method === 'hasEntitlement') {
      recordPermissionUse(
        permissionUses,
        Permission.BillingRead,
        filePath,
        node,
        `ctx.billing.${method}`,
        sourceFile
      );
      return;
    }

    if (method === 'grantPlan' || method === 'redeemCode') {
      recordPermissionUse(
        permissionUses,
        Permission.BillingWrite,
        filePath,
        node,
        `ctx.billing.${method}`,
        sourceFile
      );
      return;
    }
  }

  if (matchesPrefix(chain, ['ctx', 'notifications']) && chain[2] === 'send') {
    recordPermissionUse(
      permissionUses,
      Permission.NotificationsSend,
      filePath,
      node,
      'ctx.notifications.send',
      sourceFile
    );
    return;
  }

  if (matchesPrefix(chain, ['ctx', 'config'])) {
    const method = chain[2];
    if (method === 'get') {
      recordPermissionUse(
        permissionUses,
        Permission.ConfigRead,
        filePath,
        node,
        'ctx.config.get',
        sourceFile
      );
      return;
    }

    if (method === 'set' || method === 'delete') {
      recordPermissionUse(
        permissionUses,
        Permission.ConfigWrite,
        filePath,
        node,
        `ctx.config.${method}`,
        sourceFile
      );
      return;
    }
  }

  if (matchesPrefix(chain, ['ctx', 'secrets'])) {
    const method = chain[2];
    if (method === 'get') {
      recordPermissionUse(
        permissionUses,
        Permission.SecretsRead,
        filePath,
        node,
        'ctx.secrets.get',
        sourceFile
      );
      return;
    }

    if (method === 'set' || method === 'delete') {
      recordPermissionUse(
        permissionUses,
        Permission.SecretsWrite,
        filePath,
        node,
        `ctx.secrets.${method}`,
        sourceFile
      );
      return;
    }
  }

  if (matchesPrefix(chain, ['ctx', 'ui']) && chain[2] === 'toast') {
    recordPermissionUse(
      permissionUses,
      Permission.UiToast,
      filePath,
      node,
      'ctx.ui.toast',
      sourceFile
    );
    return;
  }

  if (matchesPrefix(chain, ['ctx', 'storage'])) {
    const method = chain[2];
    if (method === 'collection') {
      const operation = chain[3];

      if (operation === 'findMany' || operation === 'findById') {
        recordPermissionUse(
          permissionUses,
          Permission.StorageRead,
          filePath,
          node,
          `ctx.storage.collection.${operation}`,
          sourceFile
        );
        return;
      }

      if (operation === 'insert' || operation === 'update' || operation === 'delete') {
        recordPermissionUse(
          permissionUses,
          Permission.StorageWrite,
          filePath,
          node,
          `ctx.storage.collection.${operation}`,
          sourceFile
        );
        return;
      }

      if (ts.isPropertyAccessExpression(node.parent)) {
        return;
      }

      recordPermissionUse(
        permissionUses,
        Permission.StorageRead,
        filePath,
        node,
        'ctx.storage.collection',
        sourceFile
      );
      recordPermissionUse(
        permissionUses,
        Permission.StorageWrite,
        filePath,
        node,
        'ctx.storage.collection',
        sourceFile
      );
      return;
    }

    if (method === 'transaction' || method === 'ensureCollections') {
      recordPermissionUse(
        permissionUses,
        Permission.StorageWrite,
        filePath,
        node,
        `ctx.storage.${method}`,
        sourceFile
      );
      return;
    }
  }
}

function scanFile(
  filePath: string,
  pluginRoot: string,
  allowedExternalImports: readonly string[]
): ScannedFileResult {
  const diagnostics: PluginDiagnostic[] = [];
  const permissionUses = new Map<PermissionValue, PluginCheckPermissionUse>();
  const httpFetchUses: PluginCheckHttpFetchUse[] = [];
  const serviceUses: PluginCheckServiceUse[] = [];
  const sourceText = fs.readFileSync(filePath, 'utf-8');
  const scriptKind =
    filePath.endsWith('.tsx') || filePath.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );

  function addImportDiagnostic(
    code: string,
    severity: PluginDiagnostic['severity'],
    message: string,
    specifier: string,
    node: ts.Node,
    fix?: string,
    details?: Record<string, unknown>
  ): void {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile, false));
    diagnostics.push(
      createDiagnostic(
        code,
        severity,
        message,
        relativeToCwd(filePath),
        relativeToRoot(pluginRoot, filePath),
        fix,
        {
          ...details,
          specifier,
          line: position.line + 1,
          column: position.character + 1,
        }
      )
    );
  }

  function addDynamicCapabilityDiagnostic(access: DynamicCapabilityAccess, node: ts.Node): void {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile, false));

    diagnostics.push(
      createDiagnostic(
        'PLUGIN_CAPABILITY_DYNAMIC_ACCESS_UNVERIFIED',
        'warning',
        `Dynamic PluginContext capability access "${access.accessPath}" cannot be fully verified by plugin check.`,
        relativeToCwd(filePath),
        relativeToRoot(pluginRoot, filePath),
        'Use a static ctx capability method call so plugin check can infer the exact permission.',
        {
          accessPath: access.accessPath,
          capability: access.capability,
          assumedPermissions: [...access.permissions],
          line: position.line + 1,
          column: position.character + 1,
        }
      )
    );
  }

  function checkRelativeImport(specifier: string, node: ts.Node): void {
    const resolution = resolveRelativeImport(filePath, specifier);
    if (!isInsideRoot(resolution.resolvedPath, pluginRoot)) {
      addImportDiagnostic(
        'PLUGIN_IMPORT_OUTSIDE_ROOT',
        'error',
        `Plugin import "${specifier}" escapes the plugin directory.`,
        specifier,
        node,
        'Use a ./ path that stays inside the plugin root.',
        {
          resolvedPath: relativeToCwd(resolution.resolvedPath),
        }
      );
      return;
    }

    if (!resolution.exists) {
      addImportDiagnostic(
        'PLUGIN_IMPORT_NOT_FOUND',
        'error',
        `Plugin import "${specifier}" could not be resolved from ${relativeToRoot(pluginRoot, filePath)}.`,
        specifier,
        node,
        'Create the referenced file or fix the import path.',
        {
          resolvedPath: relativeToCwd(resolution.resolvedPath),
        }
      );
    }
  }

  function checkSpecifier(specifier: string, node: ts.Node): void {
    if (specifier.startsWith('.')) {
      checkRelativeImport(specifier, node);
      return;
    }

    if (path.isAbsolute(specifier)) {
      addImportDiagnostic(
        'PLUGIN_IMPORT_FORBIDDEN',
        'error',
        `Absolute path imports are forbidden in plugin code: "${specifier}".`,
        specifier,
        node,
        'Use a plugin-local relative path or the SDK entrypoint.'
      );
      return;
    }

    if (isAllowedSdkImport(specifier)) {
      return;
    }

    if (specifier.startsWith('@ploykit/plugin-sdk/')) {
      addImportDiagnostic(
        'PLUGIN_IMPORT_FORBIDDEN',
        'error',
        `Only @ploykit/plugin-sdk, @ploykit/plugin-sdk/react, and @ploykit/plugin-sdk/testing are allowed. Found "${specifier}".`,
        specifier,
        node,
        'Switch to the public SDK entrypoint or a plugin-local relative import.'
      );
      return;
    }

    if (specifier.startsWith('@/')) {
      addImportDiagnostic(
        'PLUGIN_IMPORT_FORBIDDEN',
        'error',
        `Host internal import "${specifier}" is forbidden in plugin code.`,
        specifier,
        node,
        'Move the dependency into plugin-local files or use the SDK surface instead.'
      );
      return;
    }

    if (
      specifier === 'next' ||
      specifier.startsWith(FORBIDDEN_NEXT_IMPORT_PREFIX) ||
      specifier === 'server-only'
    ) {
      addImportDiagnostic(
        'PLUGIN_IMPORT_FORBIDDEN',
        'error',
        `Framework import "${specifier}" is forbidden in plugin code.`,
        specifier,
        node,
        'Use the SDK surface instead of importing the host framework directly.'
      );
      return;
    }

    if (isNodeBuiltin(specifier)) {
      addImportDiagnostic(
        'PLUGIN_NODE_IMPORT_FORBIDDEN',
        'error',
        `Node builtin import "${specifier}" is forbidden in plugin code.`,
        specifier,
        node,
        'Move the work into an SDK capability or a host-side adapter.'
      );
      return;
    }

    if (!isAllowedExternalImport(specifier, allowedExternalImports)) {
      const packageName = getExternalPackageName(specifier);
      addImportDiagnostic(
        'PLUGIN_IMPORT_EXTERNAL_UNDECLARED',
        'error',
        `External package import "${specifier}" is outside the default SDK boundary.`,
        specifier,
        node,
        'Add the package to plugin.dependencies.json, keep plugin code SDK-first, or move this dependency behind a declared host capability.',
        {
          package: packageName,
        }
      );
    }
  }

  function scanNode(node: ts.Node): void {
    if (isProcessEnvAccess(node) && !isNestedProcessEnvAccess(node)) {
      addImportDiagnostic(
        'PLUGIN_PROCESS_ENV_FORBIDDEN',
        'error',
        'process.env access is forbidden in plugin code.',
        'process.env',
        node,
        'Use ctx.config, ctx.secrets, or a host-side capability instead of reading environment variables directly.'
      );
    }

    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      checkSpecifier(node.moduleSpecifier.text, node.moduleSpecifier);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      checkSpecifier(node.moduleSpecifier.text, node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const expression = node.moduleReference.expression;
      if (expression && ts.isStringLiteralLike(expression)) {
        checkSpecifier(expression.text, expression);
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      checkSpecifier(node.arguments[0].text, node.arguments[0]);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isIdentifier(callee) &&
        callee.text === 'require' &&
        node.arguments.length > 0 &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        checkSpecifier(node.arguments[0].text, node.arguments[0]);
      }

      if (ts.isIdentifier(callee) || ts.isPropertyAccessExpression(callee)) {
        const chain = extractAccessSegments(callee);
        if (
          chain &&
          (chain[chain.length - 1] === 'eval' || chain[chain.length - 1] === 'Function')
        ) {
          const code =
            chain[chain.length - 1] === 'eval'
              ? 'PLUGIN_EVAL_FORBIDDEN'
              : 'PLUGIN_FUNCTION_FORBIDDEN';
          addImportDiagnostic(
            code,
            'error',
            chain[chain.length - 1] === 'eval'
              ? 'eval() is forbidden in plugin code.'
              : 'The Function constructor is forbidden in plugin code.',
            chain.join('.'),
            node,
            'Replace dynamic code execution with ordinary module code.'
          );
        }
      }

      const firstArgument = node.arguments[0];
      if (
        isDirectFetchExpression(callee) &&
        firstArgument &&
        ts.isStringLiteralLike(firstArgument) &&
        isExternalHttpUrl(firstArgument.text)
      ) {
        addImportDiagnostic(
          'PLUGIN_EXTERNAL_FETCH_FORBIDDEN',
          'error',
          `Direct external fetch is forbidden in plugin code: "${firstArgument.text}".`,
          firstArgument.text,
          node,
          'Use ctx.http.fetch with Permission.ExternalHttp and a matching plugin.ts egress origin, or move the call behind a host-side capability.'
        );
      }

      const dynamicCapabilityAccess = describeDynamicCapabilityAccess(callee);
      if (dynamicCapabilityAccess) {
        addDynamicCapabilityDiagnostic(dynamicCapabilityAccess, node);

        for (const permission of dynamicCapabilityAccess.permissions) {
          recordPermissionUse(
            permissionUses,
            permission,
            filePath,
            node,
            `dynamic ${dynamicCapabilityAccess.accessPath}`,
            sourceFile
          );
        }

        if (dynamicCapabilityAccess.capability === 'http') {
          recordHttpFetchUse(httpFetchUses, filePath, node, sourceFile);
        }
      }

      captureCapabilityPermissions(
        permissionUses,
        httpFetchUses,
        serviceUses,
        sourceFile,
        filePath,
        node
      );
    } else if (ts.isNewExpression(node)) {
      const chain = extractAccessSegments(node.expression);
      if (chain && chain[chain.length - 1] === 'Function') {
        addImportDiagnostic(
          'PLUGIN_FUNCTION_FORBIDDEN',
          'error',
          'The Function constructor is forbidden in plugin code.',
          chain.join('.'),
          node,
          'Replace dynamic code execution with ordinary module code.'
        );
      }
    }

    ts.forEachChild(node, scanNode);
  }

  scanNode(sourceFile);

  return {
    diagnostics,
    permissionUses,
    httpFetchUses,
    serviceUses,
    fileCount: 1,
  };
}

export function discoverPluginRoots(targetPath: string): string[] {
  if (!fs.existsSync(targetPath)) {
    return [];
  }

  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return path.basename(targetPath) === 'plugin.ts' ? [path.dirname(targetPath)] : [];
  }

  const directEntry = path.join(targetPath, 'plugin.ts');
  if (fs.existsSync(directEntry)) {
    return [targetPath];
  }

  const roots: string[] = [];
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || isIgnoredDirectory(entry.name)) {
      continue;
    }

    roots.push(...discoverPluginRoots(path.join(targetPath, entry.name)));
  }

  return roots;
}

function discoverLegacyPluginRoots(targetPath: string): string[] {
  if (!fs.existsSync(targetPath)) {
    return [];
  }

  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    const pluginRoot = path.dirname(targetPath);
    const fileName = path.basename(targetPath);
    return LEGACY_PLUGIN_ENTRY_FILES.includes(fileName) &&
      !fs.existsSync(path.join(pluginRoot, 'plugin.ts'))
      ? [pluginRoot]
      : [];
  }

  const pluginContractPath = path.join(targetPath, 'plugin.ts');
  if (fs.existsSync(pluginContractPath)) {
    return [];
  }

  if (hasLegacyPluginEntry(targetPath)) {
    return [targetPath];
  }

  const roots: string[] = [];
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || isIgnoredDirectory(entry.name)) {
      continue;
    }

    roots.push(...discoverLegacyPluginRoots(path.join(targetPath, entry.name)));
  }

  return roots;
}

function checkLegacyPluginRoot(pluginRoot: string): PluginCheckResult {
  const entries = listLegacyPluginEntries(pluginRoot);
  const diagnostics = [
    createDiagnostic(
      'LEGACY_PLUGIN_ENTRY_FORBIDDEN',
      'error',
      `Legacy plugin entry files are forbidden without plugin.ts: ${entries.join(', ')}.`,
      relativeToCwd(pluginRoot),
      '.',
      'Rewrite the plugin as plugins/{pluginId}/plugin.ts with definePlugin(...).',
      {
        entries,
      }
    ),
  ];

  return {
    pluginId: path.basename(pluginRoot),
    pluginPath: relativeToCwd(pluginRoot),
    filesScanned: listPluginFiles(pluginRoot).length,
    diagnostics,
    success: false,
  };
}

export function listPluginFiles(pluginRoot: string): string[] {
  const files: string[] = [];

  function walk(currentPath: string): void {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (isIgnoredDirectory(entry.name)) {
          continue;
        }

        walk(entryPath);
        continue;
      }

      if (entry.isFile() && isSourceFile(entry.name)) {
        files.push(entryPath);
      }
    }
  }

  walk(pluginRoot);
  return files;
}

function loadDependencyPolicy(pluginRoot: string): PluginDependencyPolicy {
  const manifestPath = path.join(pluginRoot, 'plugin.dependencies.json');

  if (!fs.existsSync(manifestPath)) {
    return { allowedExternalImports: [], dependencies: {} };
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
      dependencies?: unknown;
      allowedExternalImports?: unknown;
    };
    const dependencyNames =
      manifest.dependencies && typeof manifest.dependencies === 'object'
        ? Object.keys(manifest.dependencies)
        : [];
    const allowedExternalImports = Array.isArray(manifest.allowedExternalImports)
      ? manifest.allowedExternalImports.filter(
          (item): item is string => typeof item === 'string' && item.trim().length > 0
        )
      : [];

    return {
      manifestPath,
      dependencies:
        manifest.dependencies && typeof manifest.dependencies === 'object'
          ? Object.fromEntries(
              Object.entries(manifest.dependencies as Record<string, unknown>).filter(
                (entry): entry is [string, string] =>
                  typeof entry[0] === 'string' &&
                  entry[0].trim().length > 0 &&
                  typeof entry[1] === 'string' &&
                  entry[1].trim().length > 0
              )
            )
          : {},
      allowedExternalImports: [...new Set([...dependencyNames, ...allowedExternalImports])],
    };
  } catch {
    return { allowedExternalImports: [], dependencies: {}, manifestPath, malformed: true };
  }
}

let hostRequire: RuntimeRequire | null = null;
let hostRuntimeDependencies: Set<string> | null = null;

function getHostRequire(): RuntimeRequire {
  hostRequire ??= getRuntimeModuleApi().createRequire(path.join(process.cwd(), 'package.json'));
  return hostRequire;
}

function getHostRuntimeDependencies(): Set<string> {
  if (hostRuntimeDependencies) {
    return hostRuntimeDependencies;
  }

  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')
    ) as {
      dependencies?: Record<string, unknown>;
      optionalDependencies?: Record<string, unknown>;
    };
    hostRuntimeDependencies = new Set([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.optionalDependencies ?? {}),
    ]);
  } catch {
    hostRuntimeDependencies = new Set();
  }

  return hostRuntimeDependencies;
}

function buildDependencyPolicyDiagnostics(
  dependencyPolicy: PluginDependencyPolicy
): PluginDiagnostic[] {
  if (!dependencyPolicy.manifestPath) {
    return [];
  }

  if (dependencyPolicy.malformed) {
    return [
      createDiagnostic(
        'PLUGIN_DEPENDENCY_MANIFEST_INVALID',
        'error',
        'plugin.dependencies.json is not valid JSON.',
        relativeToCwd(dependencyPolicy.manifestPath),
        '.',
        'Fix plugin.dependencies.json so it can be parsed.'
      ),
    ];
  }

  const diagnostics: PluginDiagnostic[] = [];
  const hostDependencies = getHostRuntimeDependencies();

  for (const [packageName, versionRange] of Object.entries(dependencyPolicy.dependencies)) {
    try {
      getHostRequire().resolve(packageName);
    } catch {
      diagnostics.push(
        createDiagnostic(
          'PLUGIN_DEPENDENCY_NOT_INSTALLED',
          'error',
          `Plugin dependency "${packageName}" is declared but is not installed by the host.`,
          relativeToCwd(dependencyPolicy.manifestPath),
          `dependencies.${packageName}`,
          `Add "${packageName}": "${versionRange}" to the host package.json dependencies and run npm install, or remove the import.`
        )
      );
      continue;
    }

    if (!hostDependencies.has(packageName)) {
      diagnostics.push(
        createDiagnostic(
          'PLUGIN_DEPENDENCY_NOT_DECLARED_BY_HOST',
          'error',
          `Plugin dependency "${packageName}" is installed but is not declared in the host package.json runtime dependencies.`,
          relativeToCwd(dependencyPolicy.manifestPath),
          `dependencies.${packageName}`,
          `Move "${packageName}": "${versionRange}" into the host package.json dependencies, or remove it from plugin.dependencies.json.`
        )
      );
    }
  }

  return diagnostics;
}

export async function loadPluginDefinition(
  pluginRoot: string,
  entryFile: string
): Promise<DefinedPlugin> {
  const importedModule = await loadPluginModule(entryFile);
  const candidate = getPluginDefinitionCandidate(importedModule);

  if (!isDefinedPlugin(candidate)) {
    throw new Error(
      `Plugin "${path.basename(pluginRoot)}" does not export a definePlugin() contract from plugin.ts.`
    );
  }

  return candidate;
}

function getPluginDefinitionCandidate(importedModule: unknown): unknown {
  const moduleRecord =
    importedModule && typeof importedModule === 'object'
      ? (importedModule as PluginModule)
      : ({} as PluginModule);
  const defaultRecord =
    moduleRecord.default && typeof moduleRecord.default === 'object'
      ? (moduleRecord.default as PluginModule)
      : ({} as PluginModule);

  return [
    moduleRecord.default,
    defaultRecord.default,
    moduleRecord.plugin,
    defaultRecord.plugin,
    importedModule,
  ].find(isDefinedPlugin);
}

async function loadPluginModule(entryFile: string): Promise<unknown> {
  try {
    return await import(/* webpackIgnore: true */ pathToFileURL(entryFile).href);
  } catch (nativeImportError) {
    try {
      return loadPluginModuleWithTranspile(entryFile, new Map());
    } catch (fallbackImportError) {
      const nativeMessage =
        nativeImportError instanceof Error ? nativeImportError.message : String(nativeImportError);
      const fallbackMessage =
        fallbackImportError instanceof Error
          ? fallbackImportError.message
          : String(fallbackImportError);
      throw new Error(`${nativeMessage}; transpile fallback failed: ${fallbackMessage}`);
    }
  }
}

function loadPluginModuleWithTranspile(
  entryFile: string,
  moduleCache: Map<string, RuntimeCommonJsModule>
): unknown {
  const moduleApi = getRuntimeModuleApi();
  const projectPackageJson = path.join(process.cwd(), 'package.json');
  const projectRequire = moduleApi.createRequire(projectPackageJson);
  const resolvedEntry = resolveTranspiledPath(entryFile) ?? entryFile;

  return loadTranspiledModule(resolvedEntry, moduleApi, projectRequire, moduleCache);
}

function loadTranspiledModule(
  modulePath: string,
  moduleApi: RuntimeModuleApi,
  projectRequire: RuntimeRequire,
  moduleCache: Map<string, RuntimeCommonJsModule>
): unknown {
  const resolvedPath = resolveTranspiledPath(modulePath) ?? modulePath;
  const cachedModule = moduleCache.get(resolvedPath);

  if (cachedModule) {
    return cachedModule.exports;
  }

  if (!isTranspilableModule(resolvedPath)) {
    return projectRequire(resolvedPath);
  }

  const runtimeModule = new moduleApi.Module(resolvedPath);
  runtimeModule.filename = resolvedPath;
  runtimeModule.paths = [];
  moduleCache.set(resolvedPath, runtimeModule);

  const runtimeRequire = ((specifier: string) => {
    const sdkAlias = resolveSdkAlias(specifier);

    if (sdkAlias) {
      return loadTranspiledModule(sdkAlias, moduleApi, projectRequire, moduleCache);
    }

    if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
      const basePath = path.isAbsolute(specifier)
        ? specifier
        : path.resolve(path.dirname(resolvedPath), specifier);
      const nextPath = resolveTranspiledPath(basePath);

      if (nextPath) {
        return loadTranspiledModule(nextPath, moduleApi, projectRequire, moduleCache);
      }
    }

    return projectRequire(specifier);
  }) as RuntimeRequire;

  runtimeRequire.resolve = (specifier: string) => {
    const sdkAlias = resolveSdkAlias(specifier);

    if (sdkAlias) {
      return sdkAlias;
    }

    if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
      const basePath = path.isAbsolute(specifier)
        ? specifier
        : path.resolve(path.dirname(resolvedPath), specifier);
      const nextPath = resolveTranspiledPath(basePath);

      if (nextPath) {
        return nextPath;
      }
    }

    return projectRequire.resolve(specifier);
  };

  runtimeModule.require = runtimeRequire;

  const source = fs.readFileSync(resolvedPath, 'utf-8');
  const output = ts.transpileModule(source, {
    fileName: resolvedPath,
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  runtimeModule._compile(output, resolvedPath);
  return runtimeModule.exports;
}

function resolveSdkAlias(specifier: string): string | null {
  const sdkRoot = path.join(process.cwd(), 'src/plugin-sdk');
  const aliases: Record<string, string> = {
    '@ploykit/plugin-sdk': path.join(sdkRoot, 'index.ts'),
    '@ploykit/plugin-sdk/react': path.join(sdkRoot, 'react.ts'),
    '@ploykit/plugin-sdk/testing': path.join(sdkRoot, 'testing.ts'),
  };

  return aliases[specifier] ?? null;
}

function resolveTranspiledPath(basePath: string): string | null {
  const candidates = [
    basePath,
    ...SOURCE_EXTENSIONS.map((extension) => `${basePath}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(basePath, `index${extension}`)),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

function isTranspilableModule(modulePath: string): boolean {
  return SOURCE_EXTENSIONS.some((extension) => modulePath.endsWith(extension));
}

function getRuntimeModuleApi(): RuntimeModuleApi {
  const processWithBuiltin = process as typeof process & {
    getBuiltinModule?: (moduleName: string) => unknown;
  };
  const moduleApi = processWithBuiltin.getBuiltinModule?.('module') as unknown as
    | RuntimeModuleApi
    | undefined;

  if (typeof moduleApi?.createRequire === 'function' && typeof moduleApi.Module === 'function') {
    return moduleApi;
  }

  throw new Error('Node module API is unavailable.');
}

function buildDeclaredPermissionUses(
  pluginRoot: string,
  contract: PluginCheckContract
): Map<PermissionValue, PluginCheckPermissionUse> {
  const permissionUses = new Map<PermissionValue, PluginCheckPermissionUse>();
  const entryFile = path.join(pluginRoot, 'plugin.ts');

  for (const [routeIndex, route] of (contract.routes?.pages ?? []).entries()) {
    for (const [permissionIndex, permission] of (route.permissions ?? []).entries()) {
      recordDeclaredPermissionUse(
        permissionUses,
        permission,
        entryFile,
        `routes.pages.${routeIndex}.permissions.${permissionIndex}`
      );
    }
  }

  for (const [routeIndex, route] of (contract.routes?.tools ?? []).entries()) {
    for (const [permissionIndex, permission] of (route.permissions ?? []).entries()) {
      recordDeclaredPermissionUse(
        permissionUses,
        permission,
        entryFile,
        `routes.tools.${routeIndex}.permissions.${permissionIndex}`
      );
    }
  }

  for (const [routeIndex, route] of (contract.routes?.apis ?? []).entries()) {
    for (const [permissionIndex, permission] of (route.permissions ?? []).entries()) {
      recordDeclaredPermissionUse(
        permissionUses,
        permission,
        entryFile,
        `routes.apis.${routeIndex}.permissions.${permissionIndex}`
      );
    }
  }

  if ((contract.events?.publishes ?? []).length > 0) {
    recordDeclaredPermissionUse(
      permissionUses,
      Permission.EventsEmit,
      entryFile,
      'events.publishes'
    );
  }

  if (Object.keys(contract.events?.subscribes ?? {}).length > 0) {
    recordDeclaredPermissionUse(
      permissionUses,
      Permission.EventsSubscribe,
      entryFile,
      'events.subscribes'
    );
  }

  if (Object.keys(contract.jobs ?? {}).length > 0) {
    recordDeclaredPermissionUse(permissionUses, Permission.JobsRegister, entryFile, 'jobs');
  }

  if (Object.keys(contract.webhooks ?? {}).length > 0) {
    recordDeclaredPermissionUse(permissionUses, Permission.WebhookReceive, entryFile, 'webhooks');
  }

  if ((contract.egress ?? []).length > 0) {
    recordDeclaredPermissionUse(permissionUses, Permission.ExternalHttp, entryFile, 'egress');
  }

  if ((contract.serviceRequirements ?? []).length > 0) {
    recordDeclaredPermissionUse(
      permissionUses,
      Permission.ServicesInvoke,
      entryFile,
      'serviceRequirements'
    );
  }

  if (getContractMenus(contract).length > 0) {
    recordDeclaredPermissionUse(permissionUses, Permission.NavigationExtend, entryFile, 'menu');
  }

  if ((contract.hostPages?.slots ?? []).length > 0) {
    recordDeclaredPermissionUse(
      permissionUses,
      Permission.HostPageExtend,
      entryFile,
      'hostPages.slots'
    );
  }

  if ((contract.hostPages?.overrides ?? []).length > 0) {
    recordDeclaredPermissionUse(
      permissionUses,
      Permission.HostPageOverride,
      entryFile,
      'hostPages.overrides'
    );
  }

  if ((contract.resourceBindings ?? []).length > 0) {
    recordDeclaredPermissionUse(
      permissionUses,
      Permission.ResourceBindingsRead,
      entryFile,
      'resourceBindings'
    );
    recordDeclaredPermissionUse(
      permissionUses,
      Permission.ResourceBindingsWrite,
      entryFile,
      'resourceBindings'
    );
  }

  return permissionUses;
}

function buildPermissionDiagnostics(
  pluginRoot: string,
  contract: PluginCheckContract,
  codePermissionUses: Map<PermissionValue, PluginCheckPermissionUse>
): PluginDiagnostic[] {
  const diagnostics: PluginDiagnostic[] = [];
  const declaredPermissions = new Set(contract.permissions ?? []);
  const permissionUses = new Map<PermissionValue, PluginCheckPermissionUse>();

  for (const [permission, use] of codePermissionUses.entries()) {
    permissionUses.set(permission, use);
  }

  for (const [permission, use] of buildDeclaredPermissionUses(pluginRoot, contract).entries()) {
    if (!permissionUses.has(permission)) {
      permissionUses.set(permission, use);
    }
  }

  for (const [permission, use] of permissionUses.entries()) {
    if (declaredPermissions.has(permission)) {
      continue;
    }

    diagnostics.push(
      createDiagnostic(
        'PLUGIN_CAPABILITY_PERMISSION_MISSING',
        'error',
        `Plugin requires "${permission}" via ${use.reason} in ${use.file}:${use.line}:${use.column}, but plugin.ts does not declare it.`,
        relativeToCwd(path.join(pluginRoot, 'plugin.ts')),
        'permissions',
        `Add ${formatPermissionReference(permission)} to plugin.ts permissions.`,
        {
          permission,
          usedIn: use.file,
          line: use.line,
          column: use.column,
          reason: use.reason,
        }
      )
    );
  }

  for (const permission of declaredPermissions) {
    if (permissionUses.has(permission)) {
      continue;
    }

    diagnostics.push(
      createDiagnostic(
        'PLUGIN_PERMISSION_UNUSED',
        'warning',
        `plugin.ts declares "${permission}", but plugin check did not find a matching capability use or contract declaration.`,
        relativeToCwd(path.join(pluginRoot, 'plugin.ts')),
        'permissions',
        `Remove ${formatPermissionReference(permission)} from plugin.ts permissions if it is not needed.`,
        {
          permission,
        }
      )
    );
  }

  return diagnostics;
}

function buildDeclaredHandlerDiagnostics(
  pluginRoot: string,
  contract: PluginCheckContract
): PluginDiagnostic[] {
  const diagnostics: PluginDiagnostic[] = [];
  const entryFile = path.join(pluginRoot, 'plugin.ts');

  function checkHandler(
    code: string,
    label: string,
    name: string,
    handler: string,
    diagnosticPath: string
  ): void {
    const resolution = resolveRelativeImport(entryFile, handler);
    if (!isInsideRoot(resolution.resolvedPath, pluginRoot)) {
      diagnostics.push(
        createDiagnostic(
          'PLUGIN_HANDLER_OUTSIDE_ROOT',
          'error',
          `${label} handler "${handler}" escapes the plugin directory.`,
          relativeToCwd(entryFile),
          diagnosticPath,
          'Use a ./ path that stays inside the plugin root.',
          {
            name,
            handler,
            resolvedPath: relativeToCwd(resolution.resolvedPath),
          }
        )
      );
      return;
    }

    if (!resolution.exists) {
      diagnostics.push(
        createDiagnostic(
          code,
          'error',
          `${label} handler "${handler}" was not found.`,
          relativeToCwd(entryFile),
          diagnosticPath,
          `Create ${handler} inside the plugin directory or update plugin.ts.`,
          {
            name,
            handler,
            resolvedPath: relativeToCwd(resolution.resolvedPath),
          }
        )
      );
    }
  }

  for (const [index, page] of (contract.routes?.pages ?? []).entries()) {
    checkHandler(
      'PLUGIN_PAGE_COMPONENT_NOT_FOUND',
      'Page component',
      page.path,
      page.component,
      `routes.pages.${index}.component`
    );
  }

  for (const [index, tool] of (contract.routes?.tools ?? []).entries()) {
    checkHandler(
      'PLUGIN_PAGE_COMPONENT_NOT_FOUND',
      'Tool component',
      tool.path,
      tool.component,
      `routes.tools.${index}.component`
    );
  }

  for (const [index, api] of (contract.routes?.apis ?? []).entries()) {
    checkHandler(
      'PLUGIN_API_HANDLER_NOT_FOUND',
      'API handler',
      api.path,
      api.handler,
      `routes.apis.${index}.handler`
    );
  }

  for (const [name, handler] of Object.entries(contract.lifecycle ?? {})) {
    checkHandler(
      'PLUGIN_LIFECYCLE_HANDLER_NOT_FOUND',
      'Lifecycle',
      name,
      handler,
      `lifecycle.${name}`
    );
  }

  if (contract.config?.component) {
    checkHandler(
      'PLUGIN_CONFIG_COMPONENT_NOT_FOUND',
      'Config component',
      'config.component',
      contract.config.component,
      'config.component'
    );
  }

  for (const [slotName, slotDeclaration] of Object.entries(contract.slots ?? {})) {
    const declarations = Array.isArray(slotDeclaration) ? slotDeclaration : [slotDeclaration];

    declarations.forEach((declaration, index) => {
      const component = typeof declaration === 'string' ? declaration : declaration?.component;
      if (typeof component !== 'string') {
        return;
      }

      checkHandler(
        'PLUGIN_SLOT_COMPONENT_NOT_FOUND',
        'Slot component',
        slotName,
        component,
        `slots.${slotName}.${index}.component`
      );
    });
  }

  for (const [index, slot] of (contract.hostPages?.slots ?? []).entries()) {
    checkHandler(
      'PLUGIN_HOST_PAGE_SLOT_COMPONENT_NOT_FOUND',
      'Host page slot component',
      `${slot.page}:${slot.position}`,
      slot.component,
      `hostPages.slots.${index}.component`
    );
  }

  for (const [index, override] of (contract.hostPages?.overrides ?? []).entries()) {
    checkHandler(
      'PLUGIN_HOST_PAGE_OVERRIDE_COMPONENT_NOT_FOUND',
      'Host page override component',
      override.page,
      override.component,
      `hostPages.overrides.${index}.component`
    );
  }

  if (contract.hooks?.renderHead) {
    checkHandler(
      'PLUGIN_HOOK_HANDLER_NOT_FOUND',
      'Hook',
      'renderHead',
      contract.hooks.renderHead.handler,
      'hooks.renderHead.handler'
    );
  }

  if (contract.hooks?.sitemap) {
    checkHandler(
      'PLUGIN_HOOK_HANDLER_NOT_FOUND',
      'Hook',
      'sitemap',
      contract.hooks.sitemap.handler,
      'hooks.sitemap.handler'
    );
  }

  for (const [name, job] of Object.entries(contract.jobs ?? {})) {
    checkHandler('PLUGIN_JOB_HANDLER_NOT_FOUND', 'Job', name, job.handler, `jobs.${name}.handler`);
  }

  for (const [event, handler] of Object.entries(contract.events?.subscribes ?? {})) {
    checkHandler(
      'PLUGIN_EVENT_HANDLER_NOT_FOUND',
      'Event subscription',
      event,
      handler,
      `events.subscribes.${event}`
    );
  }

  for (const [name, webhook] of Object.entries(contract.webhooks ?? {})) {
    checkHandler(
      'PLUGIN_WEBHOOK_HANDLER_NOT_FOUND',
      'Webhook',
      name,
      webhook.handler,
      `webhooks.${name}.handler`
    );
  }

  return diagnostics;
}

function getDeclaredAssetPath(asset: unknown): string | null {
  if (typeof asset === 'string') {
    return asset;
  }

  if (
    asset &&
    typeof asset === 'object' &&
    typeof (asset as { path?: unknown }).path === 'string'
  ) {
    return (asset as { path: string }).path;
  }

  return null;
}

function getDeclaredAssetMaxBytes(asset: unknown): number | undefined {
  if (!asset || typeof asset !== 'object') {
    return undefined;
  }

  const value = (asset as { maxBytes?: unknown }).maxBytes;
  return typeof value === 'number' ? value : undefined;
}

function buildAssetDiagnostics(
  pluginRoot: string,
  contract: PluginCheckContract
): PluginDiagnostic[] {
  const diagnostics: PluginDiagnostic[] = [];
  const entryFile = path.join(pluginRoot, 'plugin.ts');
  const assets = contract.resources?.assets ?? [];

  for (const [index, asset] of assets.entries()) {
    const rawPath = getDeclaredAssetPath(asset);
    const diagnosticPath = `resources.assets.${index}${typeof asset === 'string' ? '' : '.path'}`;

    if (!rawPath) {
      continue;
    }

    let assetPath: string;
    try {
      assetPath = normalizePluginAssetPath(rawPath);
    } catch {
      continue;
    }

    const absolutePath = path.resolve(pluginRoot, assetPath);
    if (!isInsideRoot(absolutePath, pluginRoot)) {
      diagnostics.push(
        createDiagnostic(
          'PLUGIN_ASSET_OUTSIDE_ROOT',
          'error',
          `Asset "${rawPath}" escapes the plugin directory.`,
          relativeToCwd(entryFile),
          diagnosticPath,
          'Use a ./assets/... path that stays inside the plugin root.',
          {
            assetPath: rawPath,
            resolvedPath: relativeToCwd(absolutePath),
          }
        )
      );
      continue;
    }

    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      diagnostics.push(
        createDiagnostic(
          'PLUGIN_ASSET_FILE_NOT_FOUND',
          'error',
          `Declared asset "${rawPath}" was not found.`,
          relativeToCwd(entryFile),
          diagnosticPath,
          'Create the file under ./assets/ or remove the declaration.',
          {
            assetPath,
            resolvedPath: relativeToCwd(absolutePath),
          }
        )
      );
      continue;
    }

    const stats = fs.statSync(absolutePath);
    const maxBytes = getDeclaredAssetMaxBytes(asset);
    if (maxBytes !== undefined && stats.size > maxBytes) {
      diagnostics.push(
        createDiagnostic(
          'PLUGIN_ASSET_SIZE_EXCEEDED',
          'error',
          `Declared asset "${rawPath}" is ${stats.size} bytes, above maxBytes ${maxBytes}.`,
          relativeToCwd(entryFile),
          typeof asset === 'string' ? diagnosticPath : `resources.assets.${index}.maxBytes`,
          'Reduce the asset size or raise resources.assets[].maxBytes within the allowed limit.',
          {
            assetPath,
            size: stats.size,
            maxBytes,
          }
        )
      );
    }
  }

  return diagnostics;
}

function pageRouteArea(layout: unknown): 'admin' | 'public' {
  return layout === 'dashboard-admin' ? 'admin' : 'public';
}

function normalizeToolRuntimePath(path: string): string {
  const routePath = normalizeRuntimePath(path);
  if (routePath === '/tools' || routePath.startsWith('/tools/')) {
    return routePath;
  }

  return normalizeRuntimePath(`/tools${routePath}`);
}

function normalizeApiMethod(method: unknown): PluginHttpMethod {
  return String(method).toUpperCase() as PluginHttpMethod;
}

function buildRuntimeRouteDiagnostics(
  pluginRoot: string,
  contract: PluginCheckContract
): PluginDiagnostic[] {
  const diagnostics: PluginDiagnostic[] = [];
  const entryFile = path.join(pluginRoot, 'plugin.ts');
  const pageRoutes: Array<{ path: string; area: string; declaration: string }> = [];
  const apiRoutes: Array<{ path: string; method: PluginHttpMethod; declaration: string }> = [];
  const webhookRoutes: Array<{ path: string; method: PluginHttpMethod; declaration: string }> = [];

  for (const [index, page] of (contract.routes?.pages ?? []).entries()) {
    const routePath = normalizeRuntimePath(page.path);
    const area = pageRouteArea(page.layout);
    const existing = pageRoutes.find(
      (route) => route.area === area && findPluginRoutePatternConflict(route.path, routePath)
    );
    const conflict = existing ? findPluginRoutePatternConflict(existing.path, routePath) : null;

    if (existing && conflict) {
      diagnostics.push(
        createDiagnostic(
          'PLUGIN_RUNTIME_PAGE_ROUTE_CONFLICT',
          'error',
          `Page route "${routePath}" overlaps with "${existing.path}" for ${area} plugin pages; both can match "${conflict.samplePath}".`,
          relativeToCwd(entryFile),
          `routes.pages.${index}.path`,
          `Make the page route unambiguous or remove the overlapping declaration. First declaration: ${existing.declaration}.`,
          {
            path: routePath,
            area,
            firstPath: existing.path,
            firstDeclaration: existing.declaration,
            samplePath: conflict.samplePath,
            reason: conflict.reason,
          }
        )
      );
    }

    pageRoutes.push({ path: routePath, area, declaration: `routes.pages.${index}` });
  }

  for (const [index, tool] of (contract.routes?.tools ?? []).entries()) {
    const routePath = normalizeToolRuntimePath(tool.path);
    const area = 'public';
    const existing = pageRoutes.find(
      (route) => route.area === area && findPluginRoutePatternConflict(route.path, routePath)
    );
    const conflict = existing ? findPluginRoutePatternConflict(existing.path, routePath) : null;

    if (existing && conflict) {
      diagnostics.push(
        createDiagnostic(
          'PLUGIN_RUNTIME_PAGE_ROUTE_CONFLICT',
          'error',
          `Tool route "${routePath}" overlaps with "${existing.path}" for public plugin pages; both can match "${conflict.samplePath}".`,
          relativeToCwd(entryFile),
          `routes.tools.${index}.path`,
          `Make the tool route unambiguous or remove the overlapping declaration. First declaration: ${existing.declaration}.`,
          {
            path: routePath,
            area,
            firstPath: existing.path,
            firstDeclaration: existing.declaration,
            samplePath: conflict.samplePath,
            reason: conflict.reason,
          }
        )
      );
    }

    pageRoutes.push({ path: routePath, area, declaration: `routes.tools.${index}` });
  }

  for (const [index, api] of (contract.routes?.apis ?? []).entries()) {
    const routePath = normalizeRuntimePath(api.path);
    const methods = api.methods?.length ? api.methods : (['GET'] as const);

    for (const [methodIndex, methodValue] of methods.entries()) {
      const method = normalizeApiMethod(methodValue);
      const existing = apiRoutes.find(
        (route) => route.method === method && findPluginRoutePatternConflict(route.path, routePath)
      );
      const conflict = existing ? findPluginRoutePatternConflict(existing.path, routePath) : null;

      if (existing && conflict) {
        diagnostics.push(
          createDiagnostic(
            'PLUGIN_RUNTIME_API_ROUTE_CONFLICT',
            'error',
            `API route "${method} ${routePath}" overlaps with "${method} ${existing.path}"; both can match "${conflict.samplePath}".`,
            relativeToCwd(entryFile),
            `routes.apis.${index}.methods.${methodIndex}`,
            `Make the API route unambiguous or remove the overlapping declaration. First declaration: ${existing.declaration}.`,
            {
              path: routePath,
              method,
              firstPath: existing.path,
              firstDeclaration: existing.declaration,
              samplePath: conflict.samplePath,
              reason: conflict.reason,
            }
          )
        );
      }

      apiRoutes.push({ path: routePath, method, declaration: `routes.apis.${index}` });
    }
  }

  for (const [name, webhook] of Object.entries(contract.webhooks ?? {})) {
    const routePath = normalizeRuntimePath(webhook.path);
    const methods = webhook.methods?.length ? webhook.methods : (['POST'] as const);

    for (const [methodIndex, methodValue] of methods.entries()) {
      const method = normalizeApiMethod(methodValue);
      const existing = webhookRoutes.find(
        (route) => route.method === method && findPluginRoutePatternConflict(route.path, routePath)
      );
      const conflict = existing ? findPluginRoutePatternConflict(existing.path, routePath) : null;

      if (existing && conflict) {
        diagnostics.push(
          createDiagnostic(
            'PLUGIN_RUNTIME_WEBHOOK_ROUTE_CONFLICT',
            'error',
            `Webhook route "${method} ${routePath}" overlaps with "${method} ${existing.path}"; both can match "${conflict.samplePath}".`,
            relativeToCwd(entryFile),
            `webhooks.${name}.methods.${methodIndex}`,
            `Make the webhook route unambiguous or remove the overlapping declaration. First declaration: ${existing.declaration}.`,
            {
              path: routePath,
              method,
              firstPath: existing.path,
              firstDeclaration: existing.declaration,
              samplePath: conflict.samplePath,
              reason: conflict.reason,
            }
          )
        );
      }

      webhookRoutes.push({ path: routePath, method, declaration: `webhooks.${name}` });
    }
  }

  return diagnostics;
}

function getContractMenus(contract: PluginCheckContract) {
  if (!contract.menu) {
    return [];
  }

  return Array.isArray(contract.menu) ? contract.menu : [contract.menu];
}

function getPublicAliasPaths(contract: PluginCheckContract): string[] {
  return [
    ...(contract.routes?.pages ?? []).flatMap((route) =>
      (route.publicAliases ?? []).map((alias) =>
        normalizeRuntimePath(typeof alias === 'string' ? alias : alias.path)
      )
    ),
    ...(contract.routes?.tools ?? []).flatMap((route) =>
      (route.publicAliases ?? []).map((alias) =>
        normalizeRuntimePath(typeof alias === 'string' ? alias : alias.path)
      )
    ),
  ];
}

function buildMenuRouteDiagnostics(
  pluginRoot: string,
  contract: PluginCheckContract
): PluginDiagnostic[] {
  const diagnostics: PluginDiagnostic[] = [];
  const entryFile = path.join(pluginRoot, 'plugin.ts');
  const pagePaths = new Set([
    ...(contract.routes?.pages ?? []).map((route) => normalizeRuntimePath(route.path)),
    ...(contract.routes?.tools ?? []).map((route) => normalizeToolRuntimePath(route.path)),
  ]);
  const publicAliasPaths = new Set(getPublicAliasPaths(contract));

  for (const [index, menu] of getContractMenus(contract).entries()) {
    if (!menu.path.startsWith('/')) {
      continue;
    }

    const menuPath = normalizeRuntimePath(menu.path);
    if (pagePaths.has(menuPath) || publicAliasPaths.has(menuPath)) {
      continue;
    }

    diagnostics.push(
      createDiagnostic(
        'PLUGIN_MENU_ROUTE_UNKNOWN',
        'error',
        `Menu path "${menu.path}" must point to a declared page route or public alias in plugin.ts.`,
        relativeToCwd(entryFile),
        `menu.${index}.path`,
        'Use the same path as one of routes.pages, routes.tools, or publicAliases entries.',
        {
          path: menu.path,
          normalizedPath: menuPath,
          declaredPageRoutes: [...pagePaths],
          declaredPublicAliases: [...publicAliasPaths],
        }
      )
    );
  }

  return diagnostics;
}

function buildEgressDiagnostics(
  pluginRoot: string,
  contract: PluginCheckContract,
  httpFetchUses: readonly PluginCheckHttpFetchUse[]
): PluginDiagnostic[] {
  const diagnostics: PluginDiagnostic[] = [];
  const entryFile = path.join(pluginRoot, 'plugin.ts');
  const declaredOrigins = new Map<string, string>();

  for (const origin of contract.egress ?? []) {
    const normalizedOrigin = normalizeHttpOrigin(origin);
    if (normalizedOrigin) {
      declaredOrigins.set(normalizedOrigin, origin);
    }
  }

  const staticOriginsUsed = new Set<string>();

  for (const use of httpFetchUses) {
    if (use.dynamic) {
      if (declaredOrigins.size === 0) {
        diagnostics.push(
          createDiagnostic(
            'PLUGIN_EGRESS_REQUIRED_FOR_HTTP',
            'error',
            `ctx.http.fetch is used in ${use.file}:${use.line}:${use.column}, but plugin.ts egress is empty.`,
            relativeToCwd(entryFile),
            'egress',
            'Add every allowed external origin to plugin.ts egress.',
            {
              usedIn: use.file,
              line: use.line,
              column: use.column,
              reason: use.reason,
            }
          )
        );
      } else {
        diagnostics.push(
          createDiagnostic(
            'PLUGIN_EGRESS_DYNAMIC_URL_UNVERIFIED',
            'warning',
            `ctx.http.fetch uses a dynamic URL in ${use.file}:${use.line}:${use.column}; plugin check cannot prove it matches plugin.ts egress.`,
            relativeToCwd(entryFile),
            'egress',
            'Prefer a static absolute URL when possible, or keep egress narrow and rely on the runtime egress gate for this dynamic URL.',
            {
              usedIn: use.file,
              line: use.line,
              column: use.column,
              reason: use.reason,
              declaredOrigins: [...declaredOrigins.keys()],
            }
          )
        );
      }

      continue;
    }

    if (!use.url || !use.origin) {
      diagnostics.push(
        createDiagnostic(
          'PLUGIN_HTTP_URL_INVALID',
          'error',
          `ctx.http.fetch URL must be an absolute http(s) URL in ${use.file}:${use.line}:${use.column}.`,
          relativeToCwd(entryFile),
          'egress',
          'Use an absolute http(s) URL and declare its origin in plugin.ts egress.',
          {
            url: use.url,
            usedIn: use.file,
            line: use.line,
            column: use.column,
          }
        )
      );
      continue;
    }

    staticOriginsUsed.add(use.origin);

    if (!declaredOrigins.has(use.origin)) {
      diagnostics.push(
        createDiagnostic(
          'PLUGIN_EGRESS_ORIGIN_MISSING',
          'error',
          `ctx.http.fetch uses "${use.origin}" in ${use.file}:${use.line}:${use.column}, but plugin.ts egress does not declare it.`,
          relativeToCwd(entryFile),
          'egress',
          `Add "${use.origin}" to plugin.ts egress and keep Permission.ExternalHttp declared.`,
          {
            origin: use.origin,
            url: use.url,
            usedIn: use.file,
            line: use.line,
            column: use.column,
            declaredOrigins: [...declaredOrigins.keys()],
          }
        )
      );
    }
  }

  const hasDynamicFetch = httpFetchUses.some((use) => use.dynamic);
  if (!hasDynamicFetch) {
    for (const [origin, declaredValue] of declaredOrigins.entries()) {
      if (staticOriginsUsed.has(origin)) {
        continue;
      }

      diagnostics.push(
        createDiagnostic(
          'PLUGIN_EGRESS_ORIGIN_UNUSED',
          'warning',
          `plugin.ts egress declares "${declaredValue}", but no static ctx.http.fetch URL uses that origin.`,
          relativeToCwd(entryFile),
          'egress',
          'Remove the origin or keep it only if a dynamic URL can use it at runtime.',
          {
            origin,
            declaredValue,
            staticOriginsUsed: [...staticOriginsUsed],
          }
        )
      );
    }
  }

  return diagnostics;
}

function servicePathAllowed(pattern: string, pathValue: string): boolean {
  const normalizedPattern = normalizeRuntimePath(pattern.replace(/\/\*\*$/, '/[...rest]'));
  return matchRuntimePathWithParams(normalizedPattern, normalizeRuntimePath(pathValue)) !== null;
}

function buildServiceDiagnostics(
  pluginRoot: string,
  contract: PluginCheckContract,
  serviceUses: readonly PluginCheckServiceUse[]
): PluginDiagnostic[] {
  const diagnostics: PluginDiagnostic[] = [];
  const entryFile = path.join(pluginRoot, 'plugin.ts');
  const serviceDeclarations = new Map(
    (contract.serviceRequirements ?? []).map((service) => [service.name, service])
  );
  const staticUses = new Set<string>();

  for (const use of serviceUses) {
    if (use.dynamic) {
      diagnostics.push(
        createDiagnostic(
          'PLUGIN_SERVICE_DYNAMIC_USE_UNVERIFIED',
          'warning',
          `ctx.services use in ${use.file}:${use.line}:${use.column} is dynamic; plugin check cannot prove service/path coverage.`,
          relativeToCwd(entryFile),
          'serviceRequirements',
          'Prefer static service name and path literals when possible; runtime guards will still enforce plugin.ts serviceRequirements.',
          {
            usedIn: use.file,
            line: use.line,
            column: use.column,
          }
        )
      );
      continue;
    }

    const serviceName = use.service!;
    const servicePath = normalizeRuntimePath(use.path!);
    const method = (use.method ?? 'GET').toUpperCase();
    const declaration = serviceDeclarations.get(serviceName);
    staticUses.add(`${serviceName}:${method}:${servicePath}`);

    if (!declaration) {
      diagnostics.push(
        createDiagnostic(
          'PLUGIN_SERVICE_UNDECLARED',
          'error',
          `ctx.services uses service "${serviceName}" in ${use.file}:${use.line}:${use.column}, but plugin.ts does not declare it.`,
          relativeToCwd(entryFile),
          'serviceRequirements',
          `Add a serviceRequirements entry for "${serviceName}" with method "${method}" and path "${servicePath}".`,
          {
            service: serviceName,
            path: servicePath,
            method,
            usedIn: use.file,
          }
        )
      );
      continue;
    }

    const methods = new Set(declaration.methods.map((item) => item.toUpperCase()));
    if (!methods.has(method)) {
      diagnostics.push(
        createDiagnostic(
          'PLUGIN_SERVICE_METHOD_FORBIDDEN',
          'error',
          `ctx.services uses "${method}" for service "${serviceName}", but plugin.ts does not allow that method.`,
          relativeToCwd(entryFile),
          'serviceRequirements',
          `Add "${method}" to serviceRequirements[].methods for "${serviceName}" or change the call method.`,
          {
            service: serviceName,
            path: servicePath,
            method,
            allowedMethods: [...methods],
          }
        )
      );
    }

    const pathAllowed = declaration.paths.some((pattern) =>
      servicePathAllowed(pattern, servicePath)
    );
    if (!pathAllowed) {
      diagnostics.push(
        createDiagnostic(
          'PLUGIN_SERVICE_PATH_FORBIDDEN',
          'error',
          `ctx.services uses "${servicePath}" for service "${serviceName}", but plugin.ts does not allow that path.`,
          relativeToCwd(entryFile),
          'serviceRequirements',
          `Add "${servicePath}" or a matching template to serviceRequirements[].paths for "${serviceName}".`,
          {
            service: serviceName,
            path: servicePath,
            method,
            allowedPaths: declaration.paths,
          }
        )
      );
    }
  }

  for (const declaration of contract.serviceRequirements ?? []) {
    const used = [...staticUses].some((key) => key.startsWith(`${declaration.name}:`));
    if (!used && serviceUses.every((use) => !use.dynamic)) {
      diagnostics.push(
        createDiagnostic(
          'PLUGIN_SERVICE_UNUSED',
          'warning',
          `plugin.ts declares service "${declaration.name}", but no static ctx.services call uses it.`,
          relativeToCwd(entryFile),
          'serviceRequirements',
          `Remove service "${declaration.name}" if it is not needed.`,
          { service: declaration.name }
        )
      );
    }
  }

  return diagnostics;
}

function extractPluginDiagnosticError(error: unknown, entryFile: string): PluginDiagnostic | null {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const messages = rawMessage
    .split('; transpile fallback failed: ')
    .map((message) => message.trim())
    .filter(Boolean);

  for (const message of messages) {
    const match = message.match(/^([A-Z0-9_]+)(?: at ([^:]+))?: ([\s\S]*)$/);

    if (!match) {
      continue;
    }

    const [, code, diagnosticPath, body] = match;
    if (!code?.startsWith('PLUGIN_') || !body) {
      continue;
    }

    const fixPrefix = ' Fix: ';
    const fixIndex = body.indexOf(fixPrefix);
    const diagnosticMessage = fixIndex >= 0 ? body.slice(0, fixIndex) : body;
    const fix = fixIndex >= 0 ? body.slice(fixIndex + fixPrefix.length) : undefined;

    return createDiagnostic(
      code,
      'error',
      diagnosticMessage.trim(),
      relativeToCwd(entryFile),
      diagnosticPath ?? 'plugin.ts',
      fix?.trim()
    );
  }

  return null;
}

async function checkPluginRoot(
  pluginRoot: string,
  options: PluginCheckOptions = {}
): Promise<PluginCheckResult> {
  const diagnostics: PluginDiagnostic[] = [];
  const pluginFiles = listPluginFiles(pluginRoot);
  const legacyEntryFiles = listLegacyPluginEntries(pluginRoot);
  const dependencyPolicy = loadDependencyPolicy(pluginRoot);
  diagnostics.push(...buildDependencyPolicyDiagnostics(dependencyPolicy));
  const allowedExternalImports = [
    ...new Set([
      ...(options.allowedExternalImports ?? []),
      ...dependencyPolicy.allowedExternalImports,
    ]),
  ];
  const permissionUses = new Map<PermissionValue, PluginCheckPermissionUse>();
  const httpFetchUses: PluginCheckHttpFetchUse[] = [];
  const serviceUses: PluginCheckServiceUse[] = [];
  let entryFile: string | undefined;

  if (legacyEntryFiles.length > 0) {
    diagnostics.push(
      createDiagnostic(
        'LEGACY_PLUGIN_ENTRY_FORBIDDEN',
        'error',
        `Legacy plugin entry files are forbidden in definePlugin plugins: ${legacyEntryFiles.join(', ')}.`,
        relativeToCwd(pluginRoot),
        '.',
        'Move all plugin declarations into plugin.ts and remove legacy entry files.',
        {
          entries: legacyEntryFiles,
        }
      )
    );
  }

  for (const filePath of pluginFiles) {
    const scanned = scanFile(filePath, pluginRoot, allowedExternalImports);
    diagnostics.push(...scanned.diagnostics);
    scanned.permissionUses.forEach((use, permission) => {
      if (!permissionUses.has(permission)) {
        permissionUses.set(permission, use);
      }
    });
    httpFetchUses.push(...scanned.httpFetchUses);
    serviceUses.push(...scanned.serviceUses);
    if (path.basename(filePath) === 'plugin.ts') {
      entryFile = filePath;
    }
  }

  if (!entryFile) {
    diagnostics.push(
      createDiagnostic(
        'PLUGIN_ENTRY_MISSING',
        'error',
        'Plugin entry file plugin.ts was not found.',
        relativeToCwd(pluginRoot),
        '.',
        'Create plugin.ts and export default definePlugin(...).'
      )
    );

    return {
      pluginPath: relativeToCwd(pluginRoot),
      filesScanned: pluginFiles.length,
      diagnostics,
      success: false,
    };
  }

  if (hasPluginDiagnosticErrors(diagnostics)) {
    return {
      pluginPath: relativeToCwd(pluginRoot),
      entryFile: relativeToCwd(entryFile),
      filesScanned: pluginFiles.length,
      diagnostics,
      success: false,
    };
  }

  try {
    const contract = options.loadContract
      ? await options.loadContract(pluginRoot, entryFile)
      : await loadPluginDefinition(pluginRoot, entryFile);

    if (!contract) {
      throw new Error('plugin.ts did not return a plugin contract.');
    }

    if (path.basename(pluginRoot) !== contract.id) {
      diagnostics.push(
        createDiagnostic(
          'PLUGIN_ID_MISMATCH',
          'error',
          `Plugin id "${contract.id}" does not match the plugin directory name "${path.basename(pluginRoot)}".`,
          relativeToCwd(entryFile),
          'id',
          'Make plugin.ts id match the plugin directory name.'
        )
      );
    }

    if (contract.trustLevel === 'system' && !isSystemPluginRoot(pluginRoot)) {
      diagnostics.push(
        createDiagnostic(
          'PLUGIN_SYSTEM_TRUST_FORBIDDEN',
          'error',
          'Ordinary plugins cannot declare trustLevel: "system".',
          relativeToCwd(entryFile),
          'trustLevel',
          'Use "trusted" or "untrusted", or move the plugin into src/system-plugins.'
        )
      );
    }

    diagnostics.push(...buildPermissionDiagnostics(pluginRoot, contract, permissionUses));
    diagnostics.push(...buildRuntimeRouteDiagnostics(pluginRoot, contract));
    diagnostics.push(...buildMenuRouteDiagnostics(pluginRoot, contract));
    diagnostics.push(...buildEgressDiagnostics(pluginRoot, contract, httpFetchUses));
    diagnostics.push(...buildServiceDiagnostics(pluginRoot, contract, serviceUses));
    diagnostics.push(...buildDeclaredHandlerDiagnostics(pluginRoot, contract));
    diagnostics.push(...buildAssetDiagnostics(pluginRoot, contract));
  } catch (error) {
    diagnostics.push(
      extractPluginDiagnosticError(error, entryFile) ??
        createDiagnostic(
          'PLUGIN_CONTRACT_LOAD_FAILED',
          'error',
          `Failed to load plugin.ts: ${error instanceof Error ? error.message : String(error)}`,
          relativeToCwd(entryFile),
          'plugin.ts',
          'Export default definePlugin(...) from plugin.ts and rerun plugin check.'
        )
    );
  }

  return {
    pluginId: path.basename(pluginRoot),
    pluginPath: relativeToCwd(pluginRoot),
    entryFile: relativeToCwd(entryFile),
    filesScanned: pluginFiles.length,
    diagnostics,
    success: !hasPluginDiagnosticErrors(diagnostics),
  };
}

export async function checkPluginTargets(
  targetPath: string,
  options: PluginCheckOptions = {}
): Promise<PluginCheckReport> {
  const absoluteTarget = path.resolve(targetPath);
  const discoveredRoots = discoverPluginRoots(absoluteTarget);
  const legacyRoots = discoverLegacyPluginRoots(absoluteTarget);
  const plugins: PluginCheckResult[] = [];
  const diagnostics: PluginDiagnostic[] = [];

  if (discoveredRoots.length === 0 && legacyRoots.length === 0) {
    return {
      targetPath: relativeToCwd(absoluteTarget),
      checked: 0,
      diagnostics: [],
      plugins: [],
      success: true,
    };
  }

  for (const root of discoveredRoots) {
    const result = await checkPluginRoot(root, options);
    plugins.push(result);
    diagnostics.push(...result.diagnostics);
  }

  for (const root of legacyRoots) {
    const result = checkLegacyPluginRoot(root);
    plugins.push(result);
    diagnostics.push(...result.diagnostics);
  }

  return {
    targetPath: relativeToCwd(absoluteTarget),
    checked: plugins.length,
    diagnostics,
    plugins,
    success: plugins.every((plugin) => plugin.success),
  };
}
