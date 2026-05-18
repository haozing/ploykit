/* eslint-disable no-console */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  checkPluginTargets,
  discoverPluginRoots,
  listPluginFiles,
  loadPluginDefinition,
} from '@/lib/plugin-runtime/checks';
import { getPluginSourceTargets } from '@/lib/plugin-runtime/plugin-source-dirs';
import type { PluginContext, PluginDiagnostic } from '@/plugin-sdk';
import { createPluginTestHost, type PluginTestHost } from '@/plugin-sdk/testing';

const PROJECT_ROOT = process.cwd();
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'templates/plugins');
const DEFAULT_BUILD_DIR = path.join(PROJECT_ROOT, '.ploykit-build');
const PLUGIN_ID_PATTERN = /^[a-z0-9-]+$/;
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
  '.css',
]);
const SOURCE_EXTENSIONS_FOR_BUILD = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

interface ParsedArgs {
  command?: string;
  positionals: string[];
  flags: Map<string, string | boolean>;
}

interface PluginBuildArtifact {
  pluginId: string;
  outputDir: string;
  packageDir: string;
  signature: string;
  files: Array<{ path: string; bytes: number; sha256: string }>;
}

interface PluginDependencyManifest {
  path?: string;
  dependencies: Record<string, string>;
  allowedExternalImports: string[];
}

interface PluginTestResult {
  pluginId: string;
  pluginPath: string;
  testFiles: string[];
  scenarios: number;
  success: boolean;
  error?: string;
}

interface PluginInspectPluginReport {
  pluginId: string;
  pluginPath: string;
  contract: {
    name: string;
    version: string;
    kind?: string;
    trustLevel?: string;
    permissions: readonly string[];
  };
  routes: {
    pages: number;
    apis: number;
  };
  menu: number;
  dataCollections: number;
  jobs: number;
  events: {
    publishes: number;
    subscribes: number;
  };
  webhooks: number;
  hostPages: {
    slots: number;
    overrides: number;
  };
  egress: readonly string[];
  serviceRequirements: number;
  resourceBindings: number;
  files: {
    scanned: number;
    source: string[];
  };
  tests: {
    files: string[];
    ready: boolean;
  };
  dependencies: PluginDependencyManifest;
  build: {
    artifactDir: string;
    reportExists: boolean;
    signatureExists: boolean;
  };
  commands: {
    check: string;
    test: string;
    build: string;
    dev: string;
  };
}

interface PluginScenarioModule {
  default?: unknown;
  run?: unknown;
  runPluginTests?: unknown;
  tests?: unknown;
}

function printUsage(): void {
  console.error(`Usage:
  ploykit plugin create <name> --template <crud|tool|dashboard|connector|service> [--dir plugins]
  ploykit plugin check [path]
  ploykit plugin test [path]
  ploykit plugin build [path] [--out .ploykit-build]
  ploykit plugin inspect [path] [--out .ploykit-build]
  ploykit plugin doctor [path] [--out .ploykit-build]
  ploykit plugin dev [path] [--watch]
  ploykit plugin service-client --service <name> --openapi <file.json> --out <generated.ts>
`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split('=', 2);
    if (inlineValue !== undefined) {
      flags.set(rawKey, inlineValue);
      continue;
    }

    const next = rest[index + 1];
    if (next && !next.startsWith('--')) {
      flags.set(rawKey, next);
      index += 1;
      continue;
    }

    flags.set(rawKey, true);
  }

  return { command, positionals, flags };
}

function getFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

function getTargetPath(args: ParsedArgs, fallback = 'plugins'): string {
  return path.resolve(PROJECT_ROOT, args.positionals[0] ?? fallback);
}

function getTargetPaths(args: ParsedArgs): string[] {
  if (args.positionals[0]) {
    return [path.resolve(PROJECT_ROOT, args.positionals[0])];
  }

  return getPluginSourceTargets({ cwd: PROJECT_ROOT })
    .filter((target) => target.exists)
    .map((target) => target.path);
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

function toPluginName(pluginId: string): string {
  return pluginId
    .split('-')
    .filter(Boolean)
    .map((segment) => `${segment[0]?.toUpperCase() ?? ''}${segment.slice(1)}`)
    .join(' ');
}

function toPascalCase(pluginId: string): string {
  return pluginId
    .split('-')
    .filter(Boolean)
    .map((segment) => `${segment[0]?.toUpperCase() ?? ''}${segment.slice(1)}`)
    .join('');
}

function ensurePluginId(pluginId: string): void {
  if (!PLUGIN_ID_PATTERN.test(pluginId)) {
    throw new Error('Plugin name must contain only lowercase letters, numbers, and hyphens.');
  }
}

function listTemplateNames(): string[] {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    return [];
  }

  return fs
    .readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function replaceTemplateTokens(content: string, pluginId: string, templateName: string): string {
  const pluginName = toPluginName(pluginId);
  const pascalName = toPascalCase(pluginId);
  const templateId = templateName;
  const templatePluginName = `${toPluginName(templateName)} Template`;
  const templatePascalName = `${toPascalCase(templateName)}Template`;
  const templateCollection = `${templateName.replaceAll('-', '_')}_template`;

  return content
    .replaceAll('__PLUGIN_ID__', pluginId)
    .replaceAll('__PLUGIN_NAME__', pluginName)
    .replaceAll('__PLUGIN_PASCAL__', pascalName)
    .replaceAll('__PLUGIN_COLLECTION__', pluginId.replaceAll('-', '_'))
    .replaceAll(`id: '${templateId}'`, `id: '${pluginId}'`)
    .replaceAll(`id: "${templateId}"`, `id: "${pluginId}"`)
    .replaceAll(`${templateId}.`, `${pluginId}.`)
    .replaceAll(templatePluginName, pluginName)
    .replaceAll(templatePascalName, pascalName)
    .replaceAll(templateCollection, pluginId.replaceAll('-', '_'));
}

function copyTemplateDirectory(
  templateDir: string,
  targetDir: string,
  pluginId: string,
  templateName: string
): void {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(templateDir, { withFileTypes: true })) {
    const sourcePath = path.join(templateDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyTemplateDirectory(sourcePath, targetPath, pluginId, templateName);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name);
    if (TEXT_EXTENSIONS.has(extension)) {
      const content = fs.readFileSync(sourcePath, 'utf-8');
      fs.writeFileSync(targetPath, replaceTemplateTokens(content, pluginId, templateName), 'utf-8');
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
  }
}

async function runCreate(args: ParsedArgs): Promise<void> {
  const pluginId = args.positionals[0];
  const templateName = getFlag(args, 'template') ?? 'crud';
  const targetBaseDir = path.resolve(PROJECT_ROOT, getFlag(args, 'dir') ?? 'plugins');

  if (!pluginId) {
    throw new Error('Missing plugin name. Example: ploykit plugin create todo --template crud');
  }

  ensurePluginId(pluginId);

  const templateDir = path.join(TEMPLATES_DIR, templateName);
  if (!fs.existsSync(templateDir)) {
    throw new Error(
      `Unknown template "${templateName}". Available templates: ${listTemplateNames().join(', ')}`
    );
  }

  const targetDir = path.join(targetBaseDir, pluginId);
  if (fs.existsSync(targetDir)) {
    throw new Error(
      `Target plugin directory already exists: ${toPosix(path.relative(PROJECT_ROOT, targetDir))}`
    );
  }

  copyTemplateDirectory(templateDir, targetDir, pluginId, templateName);

  const report = await checkPluginTargets(targetDir);
  console.log(
    JSON.stringify(
      {
        success: report.success,
        pluginId,
        template: templateName,
        path: toPosix(path.relative(PROJECT_ROOT, targetDir)),
        diagnostics: report.diagnostics,
      },
      null,
      2
    )
  );

  if (!report.success) {
    process.exitCode = 1;
  }
}

async function runCheck(args: ParsedArgs): Promise<void> {
  const reports = await Promise.all(
    getTargetPaths(args).map((targetPath) => checkPluginTargets(targetPath))
  );
  if (reports.length === 1) {
    console.log(JSON.stringify(reports[0], null, 2));
    process.exitCode = reports[0]?.success ? 0 : 1;
    return;
  }

  const result = {
    targetPaths: reports.map((report) => report.targetPath),
    checked: reports.reduce((total, report) => total + report.checked, 0),
    diagnostics: reports.flatMap((report) => report.diagnostics),
    plugins: reports.flatMap((report) => report.plugins),
    success: reports.every((report) => report.success),
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.success ? 0 : 1;
}

function discoverTestFiles(pluginRoot: string): string[] {
  const testDir = path.join(pluginRoot, 'tests');
  const files: string[] = [];

  if (!fs.existsSync(testDir)) {
    return files;
  }

  function walk(currentPath: string): void {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }

      if (entry.isFile() && /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        files.push(entryPath);
      }
    }
  }

  walk(testDir);
  return files;
}

function normalizeScenarioExports(module: PluginScenarioModule): unknown[] {
  const candidates = [module.default, module.run, module.runPluginTests, module.tests].filter(
    (candidate) => candidate !== undefined
  );

  return candidates.flatMap((candidate) => (Array.isArray(candidate) ? candidate : [candidate]));
}

async function runPluginTestFile(
  filePath: string,
  plugin: Awaited<ReturnType<typeof loadPluginDefinition>>,
  ctx: PluginContext,
  host: PluginTestHost
): Promise<number> {
  const module = (await import(pathToFileURL(filePath).href)) as PluginScenarioModule;
  let scenarioCount = 0;

  for (const candidate of normalizeScenarioExports(module)) {
    if (typeof candidate === 'function') {
      await candidate({ plugin, ctx, host });
      scenarioCount += 1;
      continue;
    }

    if (
      candidate &&
      typeof candidate === 'object' &&
      'scenario' in candidate &&
      typeof (candidate as { scenario?: unknown }).scenario === 'function'
    ) {
      await (
        candidate as {
          scenario: (helpers: {
            plugin: unknown;
            ctx: PluginContext;
            host: PluginTestHost;
          }) => unknown;
        }
      ).scenario({
        plugin,
        ctx,
        host,
      });
      scenarioCount += 1;
    }
  }

  if (scenarioCount === 0) {
    throw new Error(
      `${toPosix(path.relative(PROJECT_ROOT, filePath))} did not export a testPlugin(...) scenario.`
    );
  }

  return scenarioCount;
}

async function runPluginTestsForTarget(
  targetPath: string,
  checkReport?: Awaited<ReturnType<typeof checkPluginTargets>>
): Promise<{ success: boolean; checked: number; check?: unknown; tests: PluginTestResult[] }> {
  checkReport ??= await checkPluginTargets(targetPath);

  if (!checkReport.success) {
    return { success: false, checked: checkReport.checked, check: checkReport, tests: [] };
  }

  const roots = discoverPluginRoots(targetPath);
  const tests: PluginTestResult[] = [];

  for (const root of roots) {
    const entryFile = path.join(root, 'plugin.ts');
    const plugin = await loadPluginDefinition(root, entryFile);
    const testFiles = discoverTestFiles(root);
    const host = createPluginTestHost(plugin);
    let scenarios = 0;

    try {
      for (const filePath of testFiles) {
        scenarios += await runPluginTestFile(filePath, plugin, host.ctx, host);
      }

      tests.push({
        pluginId: plugin.id,
        pluginPath: toPosix(path.relative(PROJECT_ROOT, root)),
        testFiles: testFiles.map((filePath) => toPosix(path.relative(PROJECT_ROOT, filePath))),
        scenarios,
        success: testFiles.length > 0 && scenarios > 0,
      });
    } catch (error) {
      tests.push({
        pluginId: plugin.id,
        pluginPath: toPosix(path.relative(PROJECT_ROOT, root)),
        testFiles: testFiles.map((filePath) => toPosix(path.relative(PROJECT_ROOT, filePath))),
        scenarios,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const success = tests.every((result) => result.success);
  return { success, checked: roots.length, tests };
}

async function runTest(args: ParsedArgs): Promise<void> {
  const targetPath = getTargetPath(args);
  const result = await runPluginTestsForTarget(targetPath);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.success ? 0 : 1;
}

function listArtifactFiles(pluginRoot: string): string[] {
  const files: string[] = [];
  const ignored = new Set(['node_modules', '.git', '.next', '.ploykit-build', 'coverage']);

  function walk(currentPath: string): void {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) {
          walk(entryPath);
        }
        continue;
      }

      if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }

  walk(pluginRoot);
  return files;
}

function hashFile(filePath: string): { bytes: number; sha256: string } {
  const content = fs.readFileSync(filePath);
  return {
    bytes: content.byteLength,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
}

function readDependencyManifest(pluginRoot: string): PluginDependencyManifest {
  const manifestPath = path.join(pluginRoot, 'plugin.dependencies.json');

  if (!fs.existsSync(manifestPath)) {
    return { dependencies: {}, allowedExternalImports: [] };
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
    dependencies?: Record<string, string>;
    allowedExternalImports?: string[];
  };

  return {
    path: toPosix(path.relative(pluginRoot, manifestPath)),
    dependencies: manifest.dependencies ?? {},
    allowedExternalImports: manifest.allowedExternalImports ?? [],
  };
}

function copyFileEnsuringDir(sourcePath: string, targetPath: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function copyBuildSourcePackage(pluginRoot: string, outputDir: string, files: string[]): string {
  const packageDir = path.join(outputDir, 'package');
  const sourceDir = path.join(packageDir, 'source');

  fs.rmSync(packageDir, { recursive: true, force: true });
  fs.mkdirSync(sourceDir, { recursive: true });

  for (const filePath of files) {
    copyFileEnsuringDir(filePath, path.join(sourceDir, path.relative(pluginRoot, filePath)));
  }

  return packageDir;
}

function writeTranspiledBundle(pluginRoot: string, packageDir: string, files: string[]): void {
  const distDir = path.join(packageDir, 'dist');
  fs.mkdirSync(distDir, { recursive: true });

  for (const filePath of files) {
    const extension = path.extname(filePath);
    const relativePath = path.relative(pluginRoot, filePath);
    const targetRelativePath = SOURCE_EXTENSIONS_FOR_BUILD.has(extension)
      ? relativePath.replace(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, '.js')
      : relativePath;
    const outputPath = path.join(distDir, targetRelativePath);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    if (SOURCE_EXTENSIONS_FOR_BUILD.has(extension)) {
      const output = ts.transpileModule(fs.readFileSync(filePath, 'utf-8'), {
        fileName: filePath,
        compilerOptions: {
          esModuleInterop: true,
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2020,
        },
      }).outputText;
      fs.writeFileSync(outputPath, output, 'utf-8');
      continue;
    }

    fs.copyFileSync(filePath, outputPath);
  }
}

function signPackageManifest(manifest: unknown): {
  algorithm: string;
  signed: boolean;
  signature: string;
} {
  const payload = stableStringify(manifest);
  const signingKey = process.env.PLUGIN_BUILD_SIGNING_KEY;

  if (signingKey) {
    return {
      algorithm: 'hmac-sha256',
      signed: true,
      signature: crypto.createHmac('sha256', signingKey).update(payload).digest('hex'),
    };
  }

  return {
    algorithm: 'sha256',
    signed: false,
    signature: crypto.createHash('sha256').update(payload).digest('hex'),
  };
}

function ensureBuildOutputPath(buildRoot: string, pluginId: string): string {
  const outputDir = path.resolve(buildRoot, pluginId);
  const relative = path.relative(path.resolve(buildRoot), outputDir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Invalid build output path for plugin "${pluginId}".`);
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  return outputDir;
}

async function runBuild(args: ParsedArgs): Promise<void> {
  const targetPath = getTargetPath(args);
  const buildRoot = path.resolve(PROJECT_ROOT, getFlag(args, 'out') ?? '.ploykit-build');
  const checkReport = await checkPluginTargets(targetPath);

  if (!checkReport.success) {
    console.log(JSON.stringify({ success: false, check: checkReport, artifacts: [] }, null, 2));
    process.exitCode = 1;
    return;
  }

  const artifacts: PluginBuildArtifact[] = [];

  for (const root of discoverPluginRoots(targetPath)) {
    const plugin = await loadPluginDefinition(root, path.join(root, 'plugin.ts'));
    const outputDir = ensureBuildOutputPath(buildRoot, plugin.id);
    const dependencyManifest = readDependencyManifest(root);
    const sourceFiles = listPluginFiles(root).map((filePath) =>
      toPosix(path.relative(root, filePath))
    );
    const artifactFilePaths = listArtifactFiles(root);
    const files = artifactFilePaths.map((filePath) => {
      const hash = hashFile(filePath);
      return {
        path: toPosix(path.relative(root, filePath)),
        ...hash,
      };
    });
    const packageDir = copyBuildSourcePackage(root, outputDir, artifactFilePaths);
    writeTranspiledBundle(root, packageDir, artifactFilePaths);
    const contractHash = crypto.createHash('sha256').update(JSON.stringify(plugin)).digest('hex');
    const dependencyWarnings = checkReport.diagnostics.filter(
      (diagnostic) => diagnostic.code === 'PLUGIN_IMPORT_EXTERNAL_UNDECLARED'
    );
    const packageManifest = {
      format: 'ploykit-plugin-package-v1',
      pluginId: plugin.id,
      version: plugin.version,
      builtAt: new Date().toISOString(),
      sourcePath: toPosix(path.relative(PROJECT_ROOT, root)),
      contractHash,
      files,
      dependencies: dependencyManifest,
      bundle: {
        sourceDir: 'package/source',
        distDir: 'package/dist',
        module: 'esm',
        target: 'es2020',
      },
    };
    const signature = signPackageManifest(packageManifest);

    fs.writeFileSync(
      path.join(outputDir, 'contract.json'),
      JSON.stringify(plugin, null, 2),
      'utf-8'
    );
    fs.writeFileSync(path.join(outputDir, 'files.json'), JSON.stringify(files, null, 2), 'utf-8');
    fs.writeFileSync(
      path.join(outputDir, 'dependency-report.json'),
      JSON.stringify(
        {
          policy: 'external imports must be declared in plugin.dependencies.json',
          manifest: dependencyManifest,
          diagnostics: dependencyWarnings,
          sourceFiles,
        },
        null,
        2
      ),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(outputDir, 'build-report.json'),
      JSON.stringify(
        {
          pluginId: plugin.id,
          builtAt: new Date().toISOString(),
          sourcePath: toPosix(path.relative(PROJECT_ROOT, root)),
          files: files.length,
          permissions: plugin.permissions ?? [],
          contractHash,
          packageDir: toPosix(path.relative(outputDir, packageDir)),
          packageSignature: signature,
        },
        null,
        2
      ),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(outputDir, 'package-manifest.json'),
      JSON.stringify(packageManifest, null, 2),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(outputDir, 'signature.json'),
      JSON.stringify(signature, null, 2),
      'utf-8'
    );

    artifacts.push({
      pluginId: plugin.id,
      outputDir: toPosix(path.relative(PROJECT_ROOT, outputDir)),
      packageDir: toPosix(path.relative(PROJECT_ROOT, packageDir)),
      signature: signature.signature,
      files,
    });
  }

  console.log(JSON.stringify({ success: true, artifacts }, null, 2));
}

function countMenuItems(menu: unknown): number {
  if (!menu) {
    return 0;
  }

  return Array.isArray(menu) ? menu.length : 1;
}

function getBuildInspectStatus(buildRoot: string, pluginId: string) {
  const artifactDir = path.join(buildRoot, pluginId);

  return {
    artifactDir: toPosix(path.relative(PROJECT_ROOT, artifactDir)),
    reportExists: fs.existsSync(path.join(artifactDir, 'build-report.json')),
    signatureExists: fs.existsSync(path.join(artifactDir, 'signature.json')),
  };
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readMessageKey(messages: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, messages);
}

function collectHostPageOverrideDiagnostics(
  root: string,
  pluginPath: string,
  plugin: Awaited<ReturnType<typeof loadPluginDefinition>>
): PluginDiagnostic[] {
  const diagnostics: PluginDiagnostic[] = [];

  for (const [index, override] of (plugin.hostPages?.overrides ?? []).entries()) {
    const basePath = `hostPages.overrides.${index}`;
    const requiredKeys = [override.seo.titleKey, override.seo.descriptionKey];

    for (const locale of override.i18n.requiredLocales ?? []) {
      const localePath = plugin.resources?.locales?.[locale];
      if (!localePath) {
        diagnostics.push({
          code: 'PLUGIN_HOST_PAGE_I18N_RESOURCE_MISSING',
          severity: 'error',
          message: `Host page override requires locale "${locale}" but resources.locales does not declare it.`,
          file: pluginPath,
          path: `${basePath}.i18n.requiredLocales`,
          fix: `Add resources.locales.${locale} or remove the locale from requiredLocales.`,
        });
        continue;
      }

      const messages = readJsonFile(path.resolve(root, localePath));
      if (!messages) {
        diagnostics.push({
          code: 'PLUGIN_HOST_PAGE_I18N_RESOURCE_INVALID',
          severity: 'error',
          message: `Host page override locale "${locale}" could not be read as JSON.`,
          file: pluginPath,
          path: `resources.locales.${locale}`,
          fix: 'Create a valid JSON locale file at the declared plugin-local path.',
        });
        continue;
      }

      for (const key of requiredKeys) {
        if (typeof readMessageKey(messages, key) !== 'string') {
          diagnostics.push({
            code: 'PLUGIN_HOST_PAGE_I18N_KEY_MISSING',
            severity: 'error',
            message: `Host page override locale "${locale}" is missing key "${key}".`,
            file: pluginPath,
            path: `${basePath}.seo`,
            fix: `Add "${key}" to ${localePath}.`,
          });
        }
      }
    }
  }

  return diagnostics;
}

async function inspectPluginRoot(
  root: string,
  buildRoot: string
): Promise<PluginInspectPluginReport> {
  const plugin = await loadPluginDefinition(root, path.join(root, 'plugin.ts'));
  const pluginPath = toPosix(path.relative(PROJECT_ROOT, root));
  const sourceFiles = listPluginFiles(root).map((filePath) =>
    toPosix(path.relative(root, filePath))
  );
  const testFiles = discoverTestFiles(root).map((filePath) =>
    toPosix(path.relative(PROJECT_ROOT, filePath))
  );
  const events = plugin.events ?? {};

  return {
    pluginId: plugin.id,
    pluginPath,
    contract: {
      name: plugin.name,
      version: plugin.version,
      kind: plugin.kind,
      trustLevel: plugin.trustLevel,
      permissions: plugin.permissions ?? [],
    },
    routes: {
      pages: plugin.routes?.pages?.length ?? 0,
      apis: plugin.routes?.apis?.length ?? 0,
    },
    menu: countMenuItems(plugin.menu),
    dataCollections: plugin.data?.collections ? Object.keys(plugin.data.collections).length : 0,
    jobs: plugin.jobs ? Object.keys(plugin.jobs).length : 0,
    events: {
      publishes: events.publishes?.length ?? 0,
      subscribes: events.subscribes ? Object.keys(events.subscribes).length : 0,
    },
    webhooks: plugin.webhooks ? Object.keys(plugin.webhooks).length : 0,
    hostPages: {
      slots: plugin.hostPages?.slots?.length ?? 0,
      overrides: plugin.hostPages?.overrides?.length ?? 0,
    },
    egress: plugin.egress ?? [],
    serviceRequirements: plugin.serviceRequirements?.length ?? 0,
    resourceBindings: plugin.resourceBindings?.length ?? 0,
    files: {
      scanned: sourceFiles.length,
      source: sourceFiles,
    },
    tests: {
      files: testFiles,
      ready: testFiles.length > 0,
    },
    dependencies: readDependencyManifest(root),
    build: getBuildInspectStatus(buildRoot, plugin.id),
    commands: {
      check: `npm run plugin:check -- ${pluginPath}`,
      test: `npm run plugin:test -- ${pluginPath}`,
      build: `npm run plugin:build -- ${pluginPath}`,
      dev: `npm run plugin:dev -- ${pluginPath}`,
    },
  };
}

async function runInspect(args: ParsedArgs): Promise<void> {
  const targetPath = getTargetPath(args);
  const buildRoot = path.resolve(PROJECT_ROOT, getFlag(args, 'out') ?? '.ploykit-build');
  const check = await checkPluginTargets(targetPath);
  const roots = discoverPluginRoots(targetPath);
  const plugins: PluginInspectPluginReport[] = [];

  for (const root of roots) {
    plugins.push(await inspectPluginRoot(root, buildRoot));
  }

  const diagnosticsBySeverity = check.diagnostics.reduce(
    (counts, diagnostic) => ({
      ...counts,
      [diagnostic.severity]: counts[diagnostic.severity] + 1,
    }),
    { error: 0, warning: 0, info: 0 }
  );

  console.log(
    JSON.stringify(
      {
        success: check.success,
        targetPath: toPosix(path.relative(PROJECT_ROOT, targetPath)),
        checked: check.checked,
        diagnostics: diagnosticsBySeverity,
        plugins,
        check,
      },
      null,
      2
    )
  );
  process.exitCode = check.success ? 0 : 1;
}

interface OpenApiOperation {
  operationId?: string;
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
}

interface OpenApiDocument {
  paths?: Record<
    string,
    Partial<Record<'get' | 'post' | 'put' | 'patch' | 'delete', OpenApiOperation>>
  >;
  components?: {
    schemas?: Record<string, unknown>;
  };
}

function toIdentifier(value: string): string {
  const words = value
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const identifier = words
    .map((word, index) => {
      const stripped = word.replace(/^[0-9]+/, '');
      if (!stripped) return '';
      return index === 0
        ? `${stripped[0]?.toLowerCase() ?? ''}${stripped.slice(1)}`
        : `${stripped[0]?.toUpperCase() ?? ''}${stripped.slice(1)}`;
    })
    .join('');
  return identifier || 'operation';
}

function toTypeName(value: string): string {
  const identifier = toIdentifier(value);
  return `${identifier[0]?.toUpperCase() ?? 'T'}${identifier.slice(1)}`;
}

function schemaToType(schema: unknown): string {
  if (!schema || typeof schema !== 'object') return 'unknown';
  const record = schema as Record<string, unknown>;
  if (typeof record.$ref === 'string') {
    return toTypeName(record.$ref.split('/').at(-1) ?? 'Schema');
  }
  if (record.type === 'array') return `${schemaToType(record.items)}[]`;
  if (record.type === 'integer' || record.type === 'number') return 'number';
  if (record.type === 'boolean') return 'boolean';
  if (record.type === 'string') return 'string';
  if (record.type === 'object') {
    const properties = record.properties as Record<string, unknown> | undefined;
    if (!properties) return 'Record<string, unknown>';
    const required = new Set((record.required as string[] | undefined) ?? []);
    return `{\n${Object.entries(properties)
      .map(
        ([key, value]) =>
          `  ${JSON.stringify(key)}${required.has(key) ? '' : '?'}: ${schemaToType(value)};`
      )
      .join('\n')}\n}`;
  }
  return 'unknown';
}

function operationResponseType(operation: OpenApiOperation): string {
  const successResponse = Object.entries(operation.responses ?? {}).find(([status]) =>
    /^2\d\d$/.test(status)
  )?.[1];
  const schema =
    successResponse?.content?.['application/json']?.schema ??
    successResponse?.content?.['application/*+json']?.schema;
  return schemaToType(schema);
}

function pathExpression(pathTemplate: string): { args: string[]; expression: string } {
  const args: string[] = [];
  const expression = pathTemplate.replace(
    /\{([^}]+)\}|:([A-Za-z0-9_]+)/g,
    (_match, braced, colon) => {
      const name = String(braced ?? colon);
      args.push(name);
      return `\${encodeURIComponent(String(${name}))}`;
    }
  );
  const uniqueArgs = [...new Set(args)];
  return uniqueArgs.length
    ? { args: uniqueArgs, expression: `\`${expression}\`` }
    : { args: [], expression: JSON.stringify(pathTemplate) };
}

function readOpenApiDocument(filePath: string): OpenApiDocument {
  if (!filePath.endsWith('.json')) {
    throw new Error('The built-in service-client generator currently supports JSON OpenAPI files.');
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as OpenApiDocument;
}

function generateServiceClient(service: string, document: OpenApiDocument): string {
  const types = Object.entries(document.components?.schemas ?? {}).map(
    ([name, schema]) => `export type ${toTypeName(name)} = ${schemaToType(schema)};`
  );
  const operations: string[] = [];

  for (const [template, methods] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!operation) continue;
      const name = toIdentifier(operation.operationId ?? `${method} ${template}`);
      const { args, expression } = pathExpression(template);
      const signature = args.map((arg) => `${arg}: string`).join(', ');
      operations.push(`    ${name}(${signature}) {
      return ctx.services.json<${operationResponseType(operation)}>(${JSON.stringify(service)}, ${expression}, {
        method: ${JSON.stringify(method.toUpperCase())},
      });
    }`);
    }
  }

  return `import type { PluginContext } from '@ploykit/plugin-sdk';

${types.join('\n\n')}

export function create${toTypeName(service)}Client(ctx: PluginContext) {
  return {
${operations.join(',\n\n')}
  };
}
`;
}

async function runServiceClient(args: ParsedArgs): Promise<void> {
  const service = getFlag(args, 'service');
  const openapi = getFlag(args, 'openapi');
  const out = getFlag(args, 'out');
  if (!service || !openapi || !out) {
    throw new Error('Missing required flags: --service, --openapi, and --out.');
  }
  const document = readOpenApiDocument(path.resolve(PROJECT_ROOT, openapi));
  const output = generateServiceClient(service, document);
  const outputPath = path.resolve(PROJECT_ROOT, out);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output, 'utf-8');
  console.log(
    JSON.stringify(
      { success: true, service, out: toPosix(path.relative(PROJECT_ROOT, outputPath)) },
      null,
      2
    )
  );
}

async function runDoctor(args: ParsedArgs): Promise<void> {
  const targetPath = getTargetPath(args);
  const buildRoot = path.resolve(PROJECT_ROOT, getFlag(args, 'out') ?? DEFAULT_BUILD_DIR);
  const check = await checkPluginTargets(targetPath);
  const tests = await runPluginTestsForTarget(targetPath, check);
  const roots = discoverPluginRoots(targetPath);
  const plugins: PluginInspectPluginReport[] = [];
  const inspectDiagnostics: PluginDiagnostic[] = [];

  for (const root of roots) {
    try {
      const plugin = await loadPluginDefinition(root, path.join(root, 'plugin.ts'));
      const pluginPath = toPosix(path.relative(PROJECT_ROOT, root));
      inspectDiagnostics.push(...collectHostPageOverrideDiagnostics(root, pluginPath, plugin));
      plugins.push(await inspectPluginRoot(root, buildRoot));
    } catch (error) {
      const pluginPath = toPosix(path.relative(PROJECT_ROOT, root));
      inspectDiagnostics.push({
        code: 'PLUGIN_DOCTOR_INSPECT_FAILED',
        severity: 'error',
        message: error instanceof Error ? error.message : String(error),
        file: pluginPath,
        path: 'inspect',
        fix: 'Fix plugin contract load errors, then rerun plugin:doctor.',
      });
    }
  }

  const allDiagnostics = [...check.diagnostics, ...inspectDiagnostics];
  const diagnosticsBySeverity = allDiagnostics.reduce(
    (counts, diagnostic) => ({
      ...counts,
      [diagnostic.severity]: counts[diagnostic.severity] + 1,
    }),
    { error: 0, warning: 0, info: 0 }
  );
  const success = check.success && tests.success && diagnosticsBySeverity.error === 0;

  console.log(
    JSON.stringify(
      {
        success,
        targetPath: toPosix(path.relative(PROJECT_ROOT, targetPath)),
        checked: check.checked,
        diagnostics: diagnosticsBySeverity,
        check,
        tests,
        inspect: {
          diagnostics: inspectDiagnostics,
          plugins,
        },
        nextCommands: [
          `npm run plugin:check -- ${toPosix(path.relative(PROJECT_ROOT, targetPath))}`,
          `npm run plugin:test -- ${toPosix(path.relative(PROJECT_ROOT, targetPath))}`,
          `npm run plugin:inspect -- ${toPosix(path.relative(PROJECT_ROOT, targetPath))}`,
        ],
      },
      null,
      2
    )
  );
  process.exitCode = success ? 0 : 1;
}

async function runDev(args: ParsedArgs): Promise<void> {
  const targetPath = getTargetPath(args);
  const watch = args.flags.has('watch');

  async function runOnce(): Promise<void> {
    const report = await checkPluginTargets(targetPath);
    console.log(
      JSON.stringify(
        {
          success: report.success,
          checked: report.checked,
          diagnostics: report.diagnostics,
          mode: watch ? 'watch' : 'once',
        },
        null,
        2
      )
    );
  }

  await runOnce();

  if (!watch) {
    return;
  }

  const { watch: watchFiles } = await import('chokidar');
  const watcher = watchFiles(targetPath, {
    ignoreInitial: true,
    ignored: /(^|[/\\])(\.git|node_modules|\.next|\.ploykit-build)([/\\]|$)/,
  });

  console.log(`Watching ${toPosix(path.relative(PROJECT_ROOT, targetPath))} for plugin changes...`);
  watcher.on('all', async () => {
    await runOnce().catch((error) => console.error(error));
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case 'create':
      await runCreate(args);
      return;
    case 'check':
      await runCheck(args);
      return;
    case 'test':
      await runTest(args);
      return;
    case 'build':
      await runBuild(args);
      return;
    case 'inspect':
      await runInspect(args);
      return;
    case 'doctor':
      await runDoctor(args);
      return;
    case 'dev':
      await runDev(args);
      return;
    case 'service-client':
      await runServiceClient(args);
      return;
    default:
      printUsage();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
