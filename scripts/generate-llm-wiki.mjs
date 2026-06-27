import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const docsRoot = path.join(projectRoot, 'docs', 'llm');
const generatedFiles = [
  path.join(docsRoot, 'capabilities.generated.md'),
  path.join(docsRoot, 'contract.generated.md'),
  path.join(docsRoot, 'errors.generated.md'),
];

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');

function slash(value) {
  return value.replace(/\\/g, '/');
}

function readProjectFile(...segments) {
  return fs.readFileSync(path.join(projectRoot, ...segments), 'utf8');
}

function projectPath(file) {
  return slash(path.relative(projectRoot, file));
}

function lineFor(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function extractBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  if (start < 0) {
    throw new Error(`Could not find ${startNeedle}`);
  }
  const end = source.indexOf(endNeedle, start);
  if (end < 0) {
    throw new Error(`Could not find ${endNeedle}`);
  }
  return source.slice(start, end);
}

function loadPermissions() {
  const source = readProjectFile('src', 'module-sdk', 'permissions.ts');
  const permissionObject = extractBetween(source, 'export const Permission = {', '} as const;');
  const permissions = new Map();
  for (const match of permissionObject.matchAll(/^\s*([A-Za-z]\w+):\s*'([^']+)'/gm)) {
    permissions.set(match[1], match[2]);
  }

  const registry = extractBetween(
    source,
    'export const PermissionRegistry:',
    'export const PermissionRegistryEntries'
  );
  const permissionsByCapability = new Map();
  const entryPattern = /\[Permission\.([A-Za-z]\w+)\]:\s*{([\s\S]*?)(?=\n\s*\[Permission\.|\n};)/g;
  for (const match of registry.matchAll(entryPattern)) {
    const permissionName = match[1];
    const body = match[2];
    const capabilityMatch = /ctxCapability:\s*'ctx\.([^']+)'/.exec(body);
    if (!capabilityMatch) {
      continue;
    }
    const topLevel = capabilityMatch[1].split('.')[0];
    const existing = permissionsByCapability.get(topLevel) ?? [];
    existing.push(`Permission.${permissionName}`);
    permissionsByCapability.set(topLevel, existing);
  }

  return { permissions, permissionsByCapability };
}

function loadContextFields() {
  const source = readProjectFile('src', 'module-sdk', 'context.ts');
  const fields = parseInterfaceFields(source, 'export interface ModuleContext {');
  const marker = 'export interface ModuleContext {';
  const start = source.indexOf(marker);
  const methodMatch = /^\s{2}json\(([^)]*)\):\s*([^;]+);/m.exec(source.slice(start));
  if (methodMatch && !fields.some((field) => field.name === 'json')) {
    fields.push({
      name: 'json',
      required: true,
      type: `(${methodMatch[1]}) => ${methodMatch[2].trim()}`,
      line: lineFor(source, start + methodMatch.index),
    });
  }
  return fields;
}

function loadContractFields() {
  const source = readProjectFile('src', 'module-sdk', 'types.ts');
  return parseInterfaceFields(source, 'export interface ModuleDefinition {');
}

function parseInterfaceFields(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`Could not find ${marker}`);
  }
  const bodyStart = source.indexOf('{', start) + 1;
  const end = findMatchingBrace(source, bodyStart - 1);
  const body = source.slice(bodyStart, end);
  const fields = [];
  const lines = splitLinesWithOffsets(body, bodyStart);
  for (let index = 0; index < lines.length; index += 1) {
    const { text: line, offset } = lines[index];
    const match = /^\s{2}([A-Za-z]\w+)(\?)?:\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    let typeSource = match[3];
    let braceDepth = countChar(typeSource, '{') - countChar(typeSource, '}');
    while (!typeSource.trimEnd().endsWith(';') || braceDepth > 0) {
      index += 1;
      if (index >= lines.length) {
        break;
      }
      const nextLine = lines[index].text;
      typeSource += ` ${nextLine.trim()}`;
      braceDepth += countChar(nextLine, '{') - countChar(nextLine, '}');
    }
    fields.push({
      name: match[1],
      required: match[2] !== '?',
      type: typeSource.replace(/;\s*$/, '').replace(/\s+/g, ' ').trim(),
      line: lineFor(source, offset),
    });
  }
  return fields;
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  throw new Error('Could not find matching interface brace');
}

function splitLinesWithOffsets(source, startOffset) {
  const lines = [];
  const pattern = /[^\n]*(?:\n|$)/g;
  for (const match of source.matchAll(pattern)) {
    if (match[0] === '') {
      continue;
    }
    lines.push({
      text: match[0].replace(/\r?\n$/, '').replace(/\r$/, ''),
      offset: startOffset + match.index,
    });
  }
  return lines;
}

function countChar(value, char) {
  return [...value].filter((item) => item === char).length;
}

function mdCell(value) {
  return String(value).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

const capabilityDescriptions = {
  module: 'Module identity metadata such as id and version.',
  product: 'Host product context.',
  user: 'Current authenticated user, or null when unauthenticated.',
  auth: 'Authentication and subject context; do not create module-owned sessions.',
  scope: 'Product, environment, workspace, and module scope.',
  workspace: 'Current workspace context.',
  request: 'Current request metadata.',
  response: 'Response factory helpers.',
  data: 'Data v2 document, table, and transaction capabilities.',
  config: 'Module configuration reads.',
  secrets: 'Host-managed secret reads.',
  services: 'Controlled external service invocation.',
  connectors: 'Host connector read and invoke access.',
  resourceBindings: 'Host resource binding access.',
  http: 'External HTTP access constrained by permissions and egress policy.',
  files: 'Host file uploads, signed URLs, and archive helpers.',
  artifacts: 'Runtime artifact reads and writes.',
  notifications: 'In-app and email notifications.',
  runs: 'Background run records.',
  jobs: 'Background job enqueue and registration.',
  events: 'Module event publish and subscribe.',
  webhooks: 'Module webhook helper capability.',
  usage: 'Usage recording.',
  metering: 'Metering authorize, charge, and commit flows.',
  credits: 'Credits balance, reserve, and consume flows.',
  billing: 'Billing reads.',
  entitlements: 'Entitlement reads, grants, and revocations.',
  commerce: 'Order, refund, and commercial fact mapping.',
  redeemCodes: 'Redeem code capability.',
  ai: 'Host-managed AI generation and embedding.',
  rag: 'RAG indexing and retrieval.',
  apiKeys: 'API key creation and verification.',
  rateLimit: 'Rate-limit checks.',
  risk: 'Risk checks.',
  cache: 'Host cache access.',
  audit: 'Audit event recording.',
  extensions: 'Host extension points; do not invent unknown capabilities.',
  json: 'JSON response shortcut.',
};

const contractDescriptions = {
  id: 'Stable module id that must align with modules/<id>.',
  name: 'Display name.',
  version: 'Module version.',
  description: 'Short description.',
  product: 'Product page, audience, shell, and quality metadata.',
  parts: 'Contract file split declarations.',
  permissions: 'Top-level module permission allowlist.',
  scope: 'User, workspace, product scope, and role requirements.',
  data: 'Data v2 table, document, and migration definitions.',
  pages:
    'Unified TSX page manifest with id, area, path, frame, component, loader, metadata, cache, aliases, and publicAliases.',
  apis: 'Schema-backed API route manifest with id, path, methods, input, output, and handler.',
  navigation: 'Host shell navigation contributions.',
  surfaces: 'Host surface contributions or replacements.',
  assets: 'Static module assets such as locales, icons, workers, and wasm files.',
  resources: 'Business resource manifest; static module assets belong in assets.',
  i18n: 'Multilingual declaration.',
  presentation: 'White-label, SEO, themeScope, and presentation metadata.',
  theme: 'Theme tokens.',
  meters: 'Meter definitions.',
  serviceRequirements: 'Controlled external service contracts.',
  resourceBindings: 'Host resource binding requirements.',
  config: 'Module configuration fields.',
  actions: 'Module action handlers; public actions declare runtime input schema.',
  jobs: 'Background job handlers.',
  events: 'Event publish and subscribe declarations.',
  webhooks: 'Module webhook entries.',
  head: 'Page head metadata.',
  lifecycle: 'Install, enable, seed, and other lifecycle handlers.',
  dependencies: 'Module npm dependencies.',
  egress: 'Outbound origin allowlist.',
  quality: 'Module quality evidence declaration.',
};
function renderGeneratedHeader(title) {
  return `# ${title}

> Generated by \`npm run llm-wiki:generate\`. Do not edit this file by hand.
> Source of truth: \`src/module-sdk/*\`, \`scripts/*\`, and module runtime code.

`;
}

function renderCapabilities() {
  const fields = loadContextFields();
  const { permissionsByCapability } = loadPermissions();
  const rows = fields.map((field) => {
    const permissionText = (permissionsByCapability.get(field.name) ?? []).join(' / ') || '-';
    return `| \`ctx.${field.name}\` | ${mdCell(field.type)} | ${mdCell(permissionText)} | ${mdCell(capabilityDescriptions[field.name] ?? '-')} | \`src/module-sdk/context.ts:${field.line}\` |`;
  });
  return `${renderGeneratedHeader('LLM Capability Facts')}
| Capability | Type | Related permissions | Meaning | Source |
| --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
}

function renderContract() {
  const fields = loadContractFields();
  const rows = fields.map((field) => {
    const required = field.required ? 'yes' : 'no';
    return `| \`${field.name}\` | ${required} | \`${mdCell(field.type)}\` | ${mdCell(contractDescriptions[field.name] ?? '-')} | \`src/module-sdk/types.ts:${field.line}\` |`;
  });
  return `${renderGeneratedHeader('LLM Module Contract Facts')}
| Field | Required | Type | Meaning | Source |
| --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
}

function collectSourceFiles(relativeRoot) {
  const absoluteRoot = path.join(projectRoot, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) {
    return [];
  }
  const files = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', '.next', '.runtime'].includes(entry.name)) {
          visit(fullPath);
        }
        continue;
      }
      if (entry.isFile() && /\.(mjs|js|ts|tsx)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }
  visit(absoluteRoot);
  return files;
}

function renderErrors() {
  const sources = [
    ...collectSourceFiles('src/module-sdk'),
    ...collectSourceFiles('scripts/lib'),
    ...collectSourceFiles('scripts'),
  ];
  const codes = new Map();
  for (const file of sources) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/['"`](MODULE_[A-Z0-9_]+)['"`]/g)) {
      const code = match[1];
      const existing = codes.get(code) ?? new Set();
      existing.add(`${projectPath(file)}:${lineFor(source, match.index)}`);
      codes.set(code, existing);
    }
  }
  const rows = [...codes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, locations]) => {
      const sourceText = [...locations].slice(0, 3).map((item) => `\`${item}\``).join('<br>');
      return `| \`${code}\` | ${sourceText} | Read the matching validator or doctor message and fix text; do not flatten platform errors in module UI. |`;
    });
  return `${renderGeneratedHeader('LLM Platform Error Facts')}
| Code | Source | LLM handling rule |
| --- | --- | --- |
${rows.join('\n')}
`;
}

function writeOrCheck(file, content, diagnostics) {
  if (checkOnly) {
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (existing !== content) {
      diagnostics.push(`${projectPath(file)} is stale. Run npm run llm-wiki:generate.`);
    }
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function collectMarkdownFiles() {
  const files = [];
  const roots = [path.join(projectRoot, 'AGENTS.md'), docsRoot];
  function visit(target) {
    if (!fs.existsSync(target)) {
      return;
    }
    const stat = fs.statSync(target);
    if (stat.isFile()) {
      if (target.endsWith('.md')) {
        files.push(target);
      }
      return;
    }
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      visit(path.join(target, entry.name));
    }
  }
  roots.forEach(visit);
  return files.sort();
}

function validateMarkdown(diagnostics) {
  const markdownFiles = collectMarkdownFiles();
  const contextFields = new Set(loadContextFields().map((field) => field.name));
  const { permissions } = loadPermissions();
  const packageJson = JSON.parse(readProjectFile('package.json'));
  const scripts = new Set(Object.keys(packageJson.scripts ?? {}));

  for (const file of markdownFiles) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = projectPath(file);
    for (const match of source.matchAll(/\bctx\.([A-Za-z]\w*)/g)) {
      if (!contextFields.has(match[1])) {
        diagnostics.push(`${relative}:${lineFor(source, match.index)} unknown ctx capability ctx.${match[1]}`);
      }
    }
    for (const match of source.matchAll(/\bPermission\.([A-Za-z]\w*)/g)) {
      if (!permissions.has(match[1])) {
        diagnostics.push(`${relative}:${lineFor(source, match.index)} unknown Permission.${match[1]}`);
      }
    }
    for (const match of source.matchAll(/\bnpm run ([A-Za-z0-9:_-]+)/g)) {
      if (!scripts.has(match[1])) {
        diagnostics.push(`${relative}:${lineFor(source, match.index)} unknown npm script ${match[1]}`);
      }
    }
    validateMarkdownLinks(file, source, diagnostics);
    validateBacktickPaths(file, source, diagnostics);
  }
}

function validateMarkdownLinks(file, source, diagnostics) {
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) {
      continue;
    }
    const resolved = path.resolve(path.dirname(file), target);
    if (!fs.existsSync(resolved)) {
      diagnostics.push(`${projectPath(file)}:${lineFor(source, match.index)} broken markdown link ${target}`);
    }
  }
}

function validateBacktickPaths(file, source, diagnostics) {
  const pathPrefixes = ['AGENTS.md', 'docs/', 'modules/', 'scripts/', 'src/', 'tests/', 'templates/'];
  for (const match of source.matchAll(/`([^`\n]+)`/g)) {
    const token = match[1].trim().replace(/[:.,;]+$/g, '');
    if (token.includes('<') || token.includes('*') || token.includes(' ')) {
      continue;
    }
    if (!pathPrefixes.some((prefix) => token === prefix || token.startsWith(prefix))) {
      continue;
    }
    const withoutLine = token.replace(/:\d+$/, '');
    if (!fs.existsSync(path.resolve(projectRoot, withoutLine))) {
      diagnostics.push(`${projectPath(file)}:${lineFor(source, match.index)} missing referenced path ${token}`);
    }
  }
}

const diagnostics = [];
writeOrCheck(generatedFiles[0], renderCapabilities(), diagnostics);
writeOrCheck(generatedFiles[1], renderContract(), diagnostics);
writeOrCheck(generatedFiles[2], renderErrors(), diagnostics);
validateMarkdown(diagnostics);

if (diagnostics.length > 0) {
  console.error('LLM wiki check failed.');
  for (const diagnostic of diagnostics) {
    console.error(`- ${diagnostic}`);
  }
  process.exitCode = 1;
} else if (checkOnly) {
  process.stdout.write(`${JSON.stringify({ ok: true, checked: generatedFiles.map(projectPath) }, null, 2)}\n`);
} else {
  process.stdout.write(`${JSON.stringify({ ok: true, generated: generatedFiles.map(projectPath) }, null, 2)}\n`);
}
