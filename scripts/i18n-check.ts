import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import productPresentation from '../product.presentation';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from '../apps/host-next/lib/i18n';
import { MODULE_MAP_ARTIFACT } from '../src/lib/module-map';
import { loadModuleRuntimeContracts } from '../src/lib/module-runtime/loader/load-module-contracts';

type DiagnosticSeverity = 'error' | 'warning';

interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  path: string;
  fix?: string;
}

type JsonRecord = Record<string, unknown>;

const required = process.argv.includes('--required');
const projectRoot = process.cwd();
const diagnostics: Diagnostic[] = [];
const inlineCopyInventory: InlineCopyInventoryItem[] = [];
const hostLocaleSummaries: LocaleSummary[] = [];
const moduleLocaleSummaries: ModuleLocaleSummary[] = [];

interface InlineCopyInventoryItem {
  file: string;
  line: number;
  kind: string;
  area: 'admin' | 'dashboard' | 'site' | 'auth' | 'public' | 'shell' | 'layout';
  productArea: string;
  priority: 'P1' | 'P2' | 'P3';
  migrationAction: string;
  snippet: string;
}

interface LocaleSummary {
  language: string;
  path: string;
  leafCount: number;
  arrayCount: number;
}

interface ModuleLocaleSummary {
  moduleId: string;
  defaultLanguage: string;
  requiredLanguages: string[];
  namespaces: string[];
  locales: LocaleSummary[];
}

const visibleCopyAttributes = [
  'title',
  'description',
  'label',
  'helper',
  'placeholder',
  'empty',
  'confirmation',
  'aria-label',
  'badge',
  'detail',
] as const;

function addDiagnostic(
  severity: DiagnosticSeverity,
  code: string,
  message: string,
  diagnosticPath: string,
  fix?: string
): void {
  diagnostics.push({ severity, code, message, path: diagnosticPath, fix });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonFile(filePath: string, diagnosticPath: string): JsonRecord | null {
  if (!fs.existsSync(filePath)) {
    addDiagnostic(
      'error',
      'I18N_FILE_MISSING',
      `Locale file is missing: ${path.relative(projectRoot, filePath)}`,
      diagnosticPath,
      'Create the locale file or remove the language declaration.'
    );
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!isRecord(parsed)) {
      addDiagnostic(
        'error',
        'I18N_FILE_NOT_OBJECT',
        `Locale file must contain a JSON object: ${path.relative(projectRoot, filePath)}`,
        diagnosticPath
      );
      return null;
    }
    return parsed;
  } catch (error) {
    addDiagnostic(
      'error',
      'I18N_FILE_INVALID_JSON',
      `Locale file contains invalid JSON: ${path.relative(projectRoot, filePath)}`,
      diagnosticPath,
      error instanceof Error ? error.message : undefined
    );
    return null;
  }
}

function localeValueSignature(value: unknown): string {
  if (Array.isArray(value)) {
    return `array:${value.length}`;
  }
  if (isRecord(value)) {
    return 'object';
  }
  return value === null ? 'null' : typeof value;
}

function flattenLocaleShape(value: unknown, prefix = ''): Map<string, string> {
  const shape = new Map<string, string>();

  function visit(child: unknown, keyPath: string): void {
    if (!keyPath && isRecord(child)) {
      for (const [key, nested] of Object.entries(child)) {
        visit(nested, key);
      }
      return;
    }

    if (Array.isArray(child)) {
      shape.set(keyPath, localeValueSignature(child));
      child.forEach((nested, index) => visit(nested, `${keyPath}.${index}`));
      return;
    }

    if (isRecord(child)) {
      shape.set(keyPath, localeValueSignature(child));
      for (const [key, nested] of Object.entries(child)) {
        visit(nested, `${keyPath}.${key}`);
      }
      return;
    }

    shape.set(keyPath, localeValueSignature(child));
  }

  visit(value, prefix);
  return shape;
}

function localeSummary(language: string, filePath: string, messages: JsonRecord): LocaleSummary {
  const shape = flattenLocaleShape(messages);
  return {
    language,
    path: path.relative(projectRoot, filePath).replace(/\\/g, '/'),
    leafCount: [...shape.values()].filter((signature) => signature !== 'object').length,
    arrayCount: [...shape.values()].filter((signature) => signature.startsWith('array:')).length,
  };
}

function flattenLocaleValues(value: unknown, prefix = ''): Array<{ key: string; value: string }> {
  const values: Array<{ key: string; value: string }> = [];

  function visit(child: unknown, keyPath: string): void {
    if (typeof child === 'string') {
      values.push({ key: keyPath, value: child });
      return;
    }
    if (Array.isArray(child)) {
      child.forEach((nested, index) => visit(nested, `${keyPath}.${index}`));
      return;
    }
    if (isRecord(child)) {
      for (const [key, nested] of Object.entries(child)) {
        visit(nested, keyPath ? `${keyPath}.${key}` : key);
      }
    }
  }

  visit(value, prefix);
  return values;
}

function stripAllowedTechnicalTokens(value: string): string {
  return value
    .replace(/\{[a-zA-Z0-9_.-]+\}/g, ' ')
    .replace(/\bnpm\s+run\s+[A-Za-z0-9:_./@-]+/g, ' ')
    .replace(/\b(?:API|URL|ID|SKU|AI|MDC|RC|P95|P50|MRR|S3|CSV|JSON|HTTP|HTTPS|UI|CRUD|RAG)\b/g, ' ')
    .replace(/\b(?:GET|POST|PUT|PATCH|DELETE)\b/g, ' ')
    .replace(/\b(?:Webhook|Webhooks|Outbox|Worker|README|Stripe|Postgres|PloyKit)\b/g, ' ')
    .replace(/\b[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+|:[A-Za-z0-9_-]+|\/[A-Za-z0-9_.@/-]+)+\b/g, ' ')
    .replace(/\b[A-Z][A-Z0-9_*-]{2,}\b/g, ' ');
}

function checkMixedLanguageLocale(language: string, messages: JsonRecord, pathPrefix: string): void {
  if (language !== 'zh') {
    return;
  }

  for (const item of flattenLocaleValues(messages)) {
    if (!/[\u4e00-\u9fff]/.test(item.value) || !/[A-Za-z]/.test(item.value)) {
      continue;
    }

    if (/\bnpm\s+run\s+[^\s，。；;]*[\u4e00-\u9fff]/.test(item.value)) {
      addDiagnostic(
        'error',
        'I18N_COMMAND_TOKEN_TRANSLATED',
        `Chinese locale command appears to contain translated command tokens: "${item.value}".`,
        `${pathPrefix}.${language}.${item.key}`,
        'Keep commands, package scripts, route ids, and environment variable names byte-for-byte.'
      );
      continue;
    }

    const withoutAllowed = stripAllowedTechnicalTokens(item.value);
    const englishWords = withoutAllowed.match(/\b[A-Za-z][A-Za-z0-9_-]{2,}\b/g) ?? [];
    const hasEnglishClause = /[A-Za-z][A-Za-z0-9_-]+(?:\s+[A-Za-z][A-Za-z0-9_-]+){2,}/.test(
      withoutAllowed
    );
    if (hasEnglishClause || englishWords.length >= 4) {
      addDiagnostic(
        'warning',
        'I18N_MIXED_LANGUAGE_COPY',
        `Chinese locale value contains a high-risk mixed-language sentence: "${item.value}".`,
        `${pathPrefix}.${language}.${item.key}`,
        'Rewrite the sentence as full Chinese and keep only approved code/protocol/product tokens.'
      );
    }
  }
}

function readPathValue(source: JsonRecord, key: string): unknown {
  return key.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current)) {
      return undefined;
    }
    return current[segment];
  }, source);
}

function compareLocaleKeys(input: {
  baseName: string;
  defaultLanguage: string;
  defaultMessages: JsonRecord;
  language: string;
  messages: JsonRecord;
  pathPrefix: string;
}): void {
  const defaultShape = flattenLocaleShape(input.defaultMessages);
  const candidateShape = flattenLocaleShape(input.messages);

  for (const [key, defaultSignature] of defaultShape.entries()) {
    const candidateSignature = candidateShape.get(key);
    if (!candidateSignature) {
      addDiagnostic(
        'error',
        'I18N_KEY_MISSING',
        `${input.baseName} locale "${input.language}" is missing locale shape key "${key}".`,
        `${input.pathPrefix}.${input.language}.${key}`,
        `Add the same key from default locale "${input.defaultLanguage}".`
      );
      continue;
    }

    if (candidateSignature !== defaultSignature) {
      addDiagnostic(
        'error',
        'I18N_KEY_TYPE_MISMATCH',
        `${input.baseName} locale "${input.language}" key "${key}" has shape "${candidateSignature}", expected "${defaultSignature}".`,
        `${input.pathPrefix}.${input.language}.${key}`,
        `Keep the same JSON structure as default locale "${input.defaultLanguage}".`
      );
    }
  }
}

function checkProductHostLanguageAlignment(): void {
  const productLanguages = productPresentation.definition.supportedLanguages.map(String);
  const hostLanguages = SUPPORTED_LANGUAGES.map(String);
  const hostLanguageSet = new Set(hostLanguages);

  if (productPresentation.definition.defaultLanguage !== DEFAULT_LANGUAGE) {
    addDiagnostic(
      'error',
      'I18N_DEFAULT_LANGUAGE_HOST_MISMATCH',
      `Product default language "${productPresentation.definition.defaultLanguage}" does not match host default language "${DEFAULT_LANGUAGE}".`,
      'product.defaultLanguage',
      'Keep product.presentation.ts and apps/host-next/lib/i18n.ts aligned.'
    );
  }

  for (const language of productLanguages) {
    if (!hostLanguageSet.has(language)) {
      addDiagnostic(
        'error',
        'I18N_PRODUCT_LANGUAGE_UNSUPPORTED_BY_HOST',
        `Product language "${language}" is not supported by the host route language catalog.`,
        `product.supportedLanguages.${language}`,
        `Add "${language}" to SUPPORTED_LANGUAGES or remove it from product.presentation.ts.`
      );
    }
  }
}

async function checkHostLocales(): Promise<void> {
  const definition = productPresentation.definition;
  const defaultLanguage = String(definition.defaultLanguage);
  const languages = definition.supportedLanguages.map(String);
  const hostLocaleDir = path.join(projectRoot, 'apps', 'host-next', 'locales');
  const defaultMessages = readJsonFile(
    path.join(hostLocaleDir, `${defaultLanguage}.json`),
    `host.locales.${defaultLanguage}`
  );

  if (!defaultMessages) {
    return;
  }
  hostLocaleSummaries.push(
    localeSummary(defaultLanguage, path.join(hostLocaleDir, `${defaultLanguage}.json`), defaultMessages)
  );
  checkMixedLanguageLocale(defaultLanguage, defaultMessages, 'host.locales');

  for (const language of languages) {
    const localePath = path.join(hostLocaleDir, `${language}.json`);
    const messages = readJsonFile(localePath, `host.locales.${language}`);
    if (!messages || language === defaultLanguage) {
      continue;
    }
    hostLocaleSummaries.push(localeSummary(language, localePath, messages));
    checkMixedLanguageLocale(language, messages, 'host.locales');
    compareLocaleKeys({
      baseName: 'Host',
      defaultLanguage,
      defaultMessages,
      language,
      messages,
      pathPrefix: 'host.locales',
    });
  }
}

async function checkModuleLocales(): Promise<void> {
  const contracts = await loadModuleRuntimeContracts(MODULE_MAP_ARTIFACT);
  const productLanguages = productPresentation.definition.supportedLanguages.map(String);

  for (const contract of contracts) {
    const i18n = contract.definition.i18n;
    if (!i18n) {
      continue;
    }

    const entry = MODULE_MAP_ARTIFACT.modules[contract.id];
    const moduleRoot = path.resolve(projectRoot, entry.rootDir ?? path.join('modules', contract.id));
    const defaultLanguage = String(i18n.defaultLanguage ?? productPresentation.definition.defaultLanguage);
    const requiredLanguages = [
      ...new Set([
        ...(i18n.requiredLanguages ?? [defaultLanguage]).map(String),
        ...(contract.definition.presentation?.whiteLabel ? productLanguages : []),
      ]),
    ];
    const defaultResource = contract.resources.locales?.[defaultLanguage];
    const moduleSummary: ModuleLocaleSummary = {
      moduleId: contract.id,
      defaultLanguage,
      requiredLanguages,
      namespaces: [...(i18n.namespaces ?? [])],
      locales: [],
    };
    moduleLocaleSummaries.push(moduleSummary);

    if (!defaultResource) {
      addDiagnostic(
        'error',
        'MODULE_I18N_DEFAULT_RESOURCE_MISSING',
        `Module "${contract.id}" does not declare a locale resource for default language "${defaultLanguage}".`,
        `modules.${contract.id}.resources.locales.${defaultLanguage}`
      );
      continue;
    }

    const defaultMessages = readJsonFile(
      path.join(moduleRoot, defaultResource),
      `modules.${contract.id}.locales.${defaultLanguage}`
    );
    if (!defaultMessages) {
      continue;
    }
    moduleSummary.locales.push(
      localeSummary(defaultLanguage, path.join(moduleRoot, defaultResource), defaultMessages)
    );

    for (const namespace of i18n.namespaces ?? []) {
      if (readPathValue(defaultMessages, namespace) === undefined) {
        addDiagnostic(
          'error',
          'MODULE_I18N_NAMESPACE_MESSAGES_MISSING',
          `Module "${contract.id}" declares i18n namespace "${namespace}" but the default locale does not contain that namespace.`,
          `modules.${contract.id}.i18n.namespaces.${namespace}`,
          `Add "${namespace}" to the module default locale JSON.`
        );
      }
    }

    for (const language of requiredLanguages) {
      const resource = contract.resources.locales?.[language];
      if (!resource) {
        addDiagnostic(
          'error',
          'MODULE_I18N_REQUIRED_RESOURCE_MISSING',
          `Module "${contract.id}" does not declare a locale resource for required language "${language}".`,
          `modules.${contract.id}.resources.locales.${language}`
        );
        continue;
      }

      const messages = readJsonFile(
        path.join(moduleRoot, resource),
        `modules.${contract.id}.locales.${language}`
      );
      if (!messages || language === defaultLanguage) {
        continue;
      }
      moduleSummary.locales.push(localeSummary(language, path.join(moduleRoot, resource), messages));

      compareLocaleKeys({
        baseName: `Module "${contract.id}"`,
        defaultLanguage,
        defaultMessages,
        language,
        messages,
        pathPrefix: `modules.${contract.id}.locales`,
      });
    }
  }
}

function collectSourceFiles(relativeRoot: string): string[] {
  const root = path.join(projectRoot, relativeRoot);
  if (!fs.existsSync(root)) {
    return [];
  }
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!['.next', '.runtime', 'node_modules'].includes(entry.name)) {
          visit(path.join(dir, entry.name));
        }
        continue;
      }
      if (['.ts', '.tsx'].includes(path.extname(entry.name))) {
        files.push(path.join(dir, entry.name));
      }
    }
  };
  visit(root);
  return files;
}

function inventoryInlineCopy(): void {
  const roots = [
    path.join('apps', 'host-next', 'components', 'admin'),
    path.join('apps', 'host-next', 'components', 'dashboard'),
    path.join('apps', 'host-next', 'components', 'public'),
    path.join('apps', 'host-next', 'components', 'site'),
    path.join('apps', 'host-next', 'components', 'auth'),
    path.join('apps', 'host-next', 'components', 'layout'),
  ];
  const explicitFiles = [
    path.join(projectRoot, 'apps', 'host-next', 'components', 'ProductShell.tsx'),
  ].filter((filePath) => fs.existsSync(filePath));
  const sourceFiles = [
    ...roots.flatMap(collectSourceFiles),
    ...collectPublicLanguagePageFiles(),
    ...explicitFiles,
  ];
  for (const filePath of [...new Set(sourceFiles)]) {
    const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const kinds = detectInlineCopyKinds(line);
      if (kinds.length === 0) {
        return;
      }
      for (const kind of kinds) {
        const classification = classifyInlineCopy(relativePath, kind);
        inlineCopyInventory.push({
          file: relativePath,
          line: index + 1,
          kind,
          ...classification,
          snippet: line.trim(),
        });
      }
    });
    inventoryAstVisibleCopy(filePath, relativePath);
  }
}

function collectPublicLanguagePageFiles(): string[] {
  const langRoot = path.join('apps', 'host-next', 'app', '[lang]');
  return collectSourceFiles(langRoot).filter((filePath) => {
    const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
    return (
      relativePath.endsWith('/page.tsx') &&
      !relativePath.includes('/app/[lang]/admin/') &&
      !relativePath.includes('/app/[lang]/dashboard/')
    );
  });
}

function inventoryAstVisibleCopy(filePath: string, relativePath: string): void {
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const ignoredText = new Set([
    'K',
    'Ctrl',
    'P',
    'PK',
    'zh',
    'en',
    '24h',
    '7d',
    '30d',
    '90d',
    'S3',
    'English',
    'Demo Pro',
    '· v',
    'ms ·',
    '· max',
    '· actor',
  ]);
  const visibleAttributeNames = new Set<string>(visibleCopyAttributes);

  function push(kind: string, node: ts.Node, snippet: string): void {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const classification = classifyInlineCopy(relativePath, kind);
    inlineCopyInventory.push({
      file: relativePath,
      line: position.line + 1,
      kind,
      ...classification,
      snippet,
    });
  }

  function cleanText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  function hasVisibleCopy(text: string): boolean {
    return /[A-Za-z\u4e00-\u9fff]/.test(text) && !ignoredText.has(text);
  }

  function isInsideLocalizer(node: ts.Node): boolean {
    let current: ts.Node | undefined = node.parent;
    while (current) {
      if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
        if (
          ['adminInlineText', 'adminInlineColumns', 'readHostMessageValue', 'localizedPath'].includes(
            current.expression.text
          )
        ) {
          return true;
        }
      }
      if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isSourceFile(current)) {
        return false;
      }
      current = current.parent;
    }
    return false;
  }

  function visit(node: ts.Node): void {
    if (ts.isJsxText(node)) {
      const text = cleanText(node.getText(sourceFile));
      if (hasVisibleCopy(text)) {
        push('hardcodedJsxText', node, text);
      }
    }

    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      visibleAttributeNames.has(node.name.text) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    ) {
      const text = cleanText(node.initializer.text);
      if (hasVisibleCopy(text) && !isInsideLocalizer(node)) {
        push(`hardcodedJsxAttribute:${node.name.text}`, node, `${node.name.text}="${text}"`);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

function detectInlineCopyKinds(line: string): string[] {
  const kinds = new Set<string>();
  if (line.includes('selectLanguageCopy(')) {
    kinds.add('selectLanguageCopy');
  }
  if (line.includes('const dashboardCopy =') || line.includes('export const dashboardCopy =')) {
    kinds.add('inlineCopyCatalog');
  }
  if (
    (line.includes("lang === 'zh'") || line.includes('lang === "zh"')) &&
    /[\u4e00-\u9fff]/.test(line)
  ) {
    kinds.add('languageBranchCopy');
  }
  if (line.includes('userText(') && /[\u4e00-\u9fff]/.test(line)) {
    kinds.add('userTextInlineCopy');
  }
  if (/\b(titleZh|bodyZh|labelZh|descriptionZh)\b/.test(line) && /[\u4e00-\u9fff]/.test(line)) {
    kinds.add('bilingualFieldCopy');
  }
  for (const attribute of visibleCopyAttributes) {
    const attributePattern = new RegExp(`\\b${attribute}="[^"]*[A-Za-z\\u4e00-\\u9fff][^"]*"`);
    if (attributePattern.test(line)) {
      kinds.add(`hardcodedJsxAttribute:${attribute}`);
    }
  }
  if (
    /\b(columns|tabs|options|items)\s*=\s*\{\s*\[/.test(line) &&
    /['"`][^'"`]*[A-Za-z\u4e00-\u9fff][^'"`]*['"`]/.test(line)
  ) {
    kinds.add('hardcodedStringArray');
  }
  return [...kinds];
}

function classifyInlineCopy(
  file: string,
  kind: string
): Pick<InlineCopyInventoryItem, 'area' | 'productArea' | 'priority' | 'migrationAction'> {
  const area = classifyInlineCopyArea(file);
  const productArea =
    file.endsWith('/dashboard-copy.ts')
      ? 'dashboard'
      : languageRouteProductArea(file) ?? file.match(/pages\/([^/]+)\//)?.[1] ?? area;
  const priority: InlineCopyInventoryItem['priority'] =
    area === 'dashboard' ||
    area === 'site' ||
    area === 'auth' ||
    area === 'public' ||
    area === 'shell' ||
    area === 'layout' ||
    ['overview', 'settings'].includes(productArea)
      ? 'P1'
      : ['identity', 'modules', 'operations'].includes(productArea)
        ? 'P2'
        : 'P3';
  const migrationAction =
    kind === 'inlineCopyCatalog'
      ? 'Move the page-level copy catalog into apps/host-next/locales and replace selectors with host translator keys.'
      : kind.startsWith('hardcodedJsxAttribute:')
        ? 'Move this visible JSX attribute into apps/host-next/locales or a scoped bilingual copy catalog.'
        : kind === 'hardcodedStringArray'
          ? 'Move this visible string array into apps/host-next/locales or a scoped bilingual copy catalog.'
          : kind === 'languageBranchCopy' || kind === 'bilingualFieldCopy'
            ? 'Move this language-specific branch or bilingual field into apps/host-next/locales and read it through host locale helpers.'
            : kind === 'userTextInlineCopy'
              ? 'Move this user-facing dashboard copy into apps/host-next/locales and replace userText with scoped host locale keys.'
          : 'Replace selectLanguageCopy usage with scoped host locale keys and formatter variables.';

  return {
    area,
    productArea,
    priority,
    migrationAction,
  };
}

function classifyInlineCopyArea(file: string): InlineCopyInventoryItem['area'] {
  if (file.includes('/components/dashboard/') || file.includes('/app/[lang]/dashboard/')) {
    return 'dashboard';
  }
  if (file.includes('/components/admin/') || file.includes('/app/[lang]/admin/')) {
    return 'admin';
  }
  if (file.includes('/components/auth/') || isAuthLanguageRoute(file)) {
    return 'auth';
  }
  if (file.includes('/components/public/')) {
    return 'public';
  }
  if (file.endsWith('/components/ProductShell.tsx')) {
    return 'shell';
  }
  if (file.includes('/components/layout/')) {
    return 'layout';
  }
  return 'site';
}

function isAuthLanguageRoute(file: string): boolean {
  return /\/app\/\[lang\]\/(login|register|forgot-password|reset-password)\//.test(file);
}

function languageRouteProductArea(file: string): string | null {
  if (file.endsWith('/app/[lang]/page.tsx')) {
    return 'home';
  }
  const match = file.match(/\/app\/\[lang\]\/([^/]+)\/page\.tsx$/);
  return match?.[1] ?? null;
}

function summarizeInlineCopyInventory(items: readonly InlineCopyInventoryItem[]) {
  const countBy = <T extends string>(values: readonly T[]) =>
    values.reduce<Record<T, number>>((summary, value) => {
      summary[value] = (summary[value] ?? 0) + 1;
      return summary;
    }, {} as Record<T, number>);

  return {
    total: items.length,
    byArea: countBy(items.map((item) => item.area)),
    byPriority: countBy(items.map((item) => item.priority)),
    byProductArea: countBy(items.map((item) => item.productArea)),
  };
}

checkProductHostLanguageAlignment();
await checkHostLocales();
await checkModuleLocales();
inventoryInlineCopy();

const inlineCopyCandidateCount = inlineCopyInventory.filter(
  (item) => item.kind !== 'inlineCopyCatalog'
).length;
if (inlineCopyCandidateCount > 0) {
  addDiagnostic(
    'warning',
    'I18N_INLINE_COPY_INVENTORY',
    `Found ${inlineCopyCandidateCount} inline host copy candidates in admin, dashboard, public, site, auth, shell, and layout surfaces.`,
    'host.inlineCopyInventory',
    'Review .runtime/i18n-inline-copy-inventory.json and migrate P1/P2 items first.'
  );
}

const inventoryPath = path.join(projectRoot, '.runtime', 'i18n-inline-copy-inventory.json');
fs.mkdirSync(path.dirname(inventoryPath), { recursive: true });
fs.writeFileSync(
  inventoryPath,
  `${JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      summary: summarizeInlineCopyInventory(inlineCopyInventory),
      items: inlineCopyInventory,
    },
    null,
    2
  )}\n`
);

const outputPaths = [
  path.join(projectRoot, '.runtime', 'i18n-manifest.json'),
  path.join(projectRoot, '.ploykit', 'generated', 'i18n.manifest.json'),
];
const manifest = {
  kind: 'ploykit.i18n.manifest',
  checkedAt: new Date().toISOString(),
  product: {
    defaultLanguage: productPresentation.definition.defaultLanguage,
    supportedLanguages: productPresentation.definition.supportedLanguages,
  },
  host: {
    defaultLanguage: DEFAULT_LANGUAGE,
    supportedLanguages: SUPPORTED_LANGUAGES,
    locales: hostLocaleSummaries,
  },
  modules: moduleLocaleSummaries,
  inlineCopyInventory: {
    path: inventoryPath,
    count: inlineCopyInventory.length,
    summary: summarizeInlineCopyInventory(inlineCopyInventory),
  },
  diagnostics,
};
for (const outputPath of outputPaths) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const ok = diagnostics.every((item) => item.severity !== 'error');
const result = {
  ok: required ? ok : true,
  required,
  outputPath: outputPaths[0],
  outputPaths,
  inlineCopyInventoryPath: inventoryPath,
  inlineCopyInventoryCount: inlineCopyInventory.length,
  inlineCopyInventorySummary: summarizeInlineCopyInventory(inlineCopyInventory),
  diagnostics,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 1;
