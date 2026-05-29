import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appRoot = path.join(root, 'apps', 'host-next', 'app');
const modulesRoot = path.join(root, 'modules');
const testsRoot = path.join(root, 'tests');
const scriptsRoot = path.join(root, 'scripts');
const runtimeDir = path.join(root, '.runtime', 'product-inventory');
const docsDir = path.join(root, 'docs');
const checkedAt = new Date().toISOString();

function exists(filePath) {
  return fs.existsSync(filePath);
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function rel(filePath) {
  return toPosix(path.relative(root, filePath));
}

function walk(dir, predicate = () => true) {
  if (!exists(dir)) {
    return [];
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.runtime') {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath, predicate));
    } else if (predicate(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function routeSegment(segment) {
  if (segment.startsWith('(') && segment.endsWith(')')) {
    return null;
  }
  const optionalCatchAll = segment.match(/^\[\[\.\.\.(.+)\]\]$/);
  if (optionalCatchAll) {
    return `:${optionalCatchAll[1]}*`;
  }
  const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
  if (catchAll) {
    return `:${catchAll[1]}*`;
  }
  const dynamic = segment.match(/^\[(.+)\]$/);
  if (dynamic) {
    return dynamic[1] === 'lang' ? '{lang}' : `:${dynamic[1]}`;
  }
  return segment;
}

function routeFromFile(filePath) {
  const relative = toPosix(path.relative(appRoot, filePath));
  const parts = relative.split('/');
  parts.pop();
  const routeParts = parts.map(routeSegment).filter(Boolean);
  return `/${routeParts.join('/')}`.replace(/\/+/g, '/') || '/';
}

function lineCount(content) {
  return content.split(/\r?\n/).length;
}

function count(content, pattern) {
  return [...content.matchAll(pattern)].length;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function pageArea(route) {
  if (route.includes('/admin')) return 'admin';
  if (route.includes('/dashboard')) return 'dashboard';
  if (route.includes('/login') || route.includes('/register') || route.includes('password')) return 'auth';
  if (route.includes('/demo') || route.includes(':slug')) return 'module-public';
  if (route === '/' || route.includes('/pricing') || route.includes('/contact')) return 'site';
  return 'site';
}

function classifyPage(content, route) {
  const lines = lineCount(content);
  const lower = content.toLowerCase();
  const signals = [];
  const hostLib = /@host\/lib|from ['"][^'"]*\/lib\//.test(content);
  const staticPages = /StaticPages|components\/site|components\/auth|components\/dashboard|components\/admin/.test(content);
  const wrapper = lines <= 30 && /return\s+\(?\s*</.test(content);
  const hasForm = /<form\b|FormData|formAction|method=/.test(content);
  const hasFetch = /\bfetch\s*\(/.test(content);
  const hasRuntime =
    /runtime|store|createHost|resolveHostSession|adminOperations|billing|files|notifications|productScope|ConfigDoctor|hostHealth/i.test(
      content
    );
  const placeholder = /TODO|not implemented|coming soon|stub|占位|未实现|待接入|后续接入|mock/i.test(
    content
  );

  if (hostLib) signals.push('host-lib');
  if (staticPages) signals.push('component-wrapper');
  if (wrapper) signals.push('thin-wrapper');
  if (hasForm) signals.push('form');
  if (hasFetch) signals.push('fetch');
  if (hasRuntime) signals.push('runtime-signal');
  if (placeholder) signals.push('placeholder-copy');

  let status = 'static-or-ui';
  let risk = '';
  if (placeholder) {
    status = 'review-needed';
    risk = '包含占位/后续/未实现类文本，需要人工确认是否泄漏到产品体验。';
  } else if (hostLib || hasRuntime || hasFetch) {
    status = 'data-backed-candidate';
  } else if (wrapper) {
    status = 'component-wrapper';
    risk = '页面文件很薄，需要继续看组件实现是否接真实数据。';
  } else if (pageArea(route) === 'site') {
    status = 'static-content';
  }

  return {
    status,
    risk,
    signals,
  };
}

function exportedMethods(content) {
  return unique([...content.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g)].map(
    (match) => match[1]
  ));
}

function classifyApi(content, route, methods) {
  const isMutation = methods.some((method) => !['GET', 'HEAD', 'OPTIONS'].includes(method));
  const signals = [];
  const hasRouteSecurity = /checkHostRouteSecurity|requireApiSession|route security|securityResponse/i.test(
    content
  );
  const hasSession =
    /requireApiSession|resolveHostSession|session\.user|AUTH_REQUIRED|requireAdmin|requireCapability/i.test(
      content
    );
  const hasOriginGuard = /requireApiSession|same-origin|assertSameOrigin|csrf|origin/i.test(content);
  const hasWebhookSignature = /signature|webhook|raw body|Stripe-Signature|verify/i.test(content);
  const hasRateLimit = /rateLimit|login limit|machine limit|high-cost|checkHostRouteSecurity|requireApiSession/i.test(
    content
  );
  const hasStore =
    /runtimeStore|RuntimeStore|createHost|commercial|ledger|fileRuntime|admin|billing|notification|productScope|worker|outbox/i.test(
      content
    );
  const noOp = /TODO|not implemented|placeholder|stub|return\s+Response\.json\(\s*\{\s*ok:\s*true\s*\}\s*\)/i.test(
    content
  );

  if (hasRouteSecurity) signals.push('route-security');
  if (hasSession) signals.push('session');
  if (hasOriginGuard) signals.push('origin/csrf');
  if (hasWebhookSignature) signals.push('signature/webhook');
  if (hasRateLimit) signals.push('rate-limit');
  if (hasStore) signals.push('store/provider');
  if (noOp) signals.push('noop-risk');

  let status = 'thin';
  let risk = '';
  if (isMutation && !hasRouteSecurity && !hasOriginGuard && !hasWebhookSignature) {
    status = 'security-review';
    risk = 'mutation route 未在文本层面发现 route security / origin / webhook signature。';
  } else if (noOp) {
    status = 'review-needed';
    risk = '疑似 no-op 或占位响应。';
  } else if (hasStore && (hasRouteSecurity || hasSession || hasWebhookSignature)) {
    status = 'guarded-data-backed';
  } else if (hasRouteSecurity || hasSession || hasWebhookSignature) {
    status = 'guarded';
  }

  return {
    status,
    risk,
    signals,
  };
}

function inventoryPages() {
  return walk(appRoot, (filePath) => filePath.endsWith('page.tsx'))
    .map((filePath) => {
      const content = read(filePath);
      const route = routeFromFile(filePath);
      const classification = classifyPage(content, route);
      return {
        route,
        area: pageArea(route),
        file: rel(filePath),
        lines: lineCount(content),
        ...classification,
      };
    })
    .sort((left, right) => left.route.localeCompare(right.route));
}

function inventoryApis() {
  return walk(appRoot, (filePath) => filePath.endsWith('route.ts'))
    .map((filePath) => {
      const content = read(filePath);
      const route = routeFromFile(filePath);
      const methods = exportedMethods(content);
      const classification = classifyApi(content, route, methods);
      return {
        route,
        methods,
        file: rel(filePath),
        lines: lineCount(content),
        ...classification,
      };
    })
    .sort((left, right) => left.route.localeCompare(right.route));
}

function sectionBody(content, name) {
  const index = content.indexOf(`${name}:`);
  if (index < 0) {
    return '';
  }
  const nextIndexes = ['routes:', 'actions:', 'jobs:', 'events:', 'webhooks:', 'data:', 'surfaces:', 'lifecycle:']
    .filter((section) => section !== `${name}:`)
    .map((section) => content.indexOf(section, index + name.length + 1))
    .filter((sectionIndex) => sectionIndex > index);
  const end = nextIndexes.length > 0 ? Math.min(...nextIndexes) : content.length;
  return content.slice(index, end);
}

function inventoryModules() {
  if (!exists(modulesRoot)) {
    return [];
  }
  return fs
    .readdirSync(modulesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(modulesRoot, entry.name))
    .filter((dir) => exists(path.join(dir, 'module.ts')))
    .map((dir) => {
      const filePath = path.join(dir, 'module.ts');
      const content = read(filePath);
      const id = content.match(/id:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? path.basename(dir);
      const routePaths = unique([...content.matchAll(/path:\s*['"`]([^'"`]+)['"`]/g)].map((match) => match[1]));
      const actionsBody = sectionBody(content, 'actions');
      const jobsBody = sectionBody(content, 'jobs');
      const eventsBody = sectionBody(content, 'events');
      const webhooksBody = sectionBody(content, 'webhooks');
      const permissions = unique(
        [...content.matchAll(/Permission\.([A-Za-z0-9_]+)/g)].map((match) => match[1])
      );
      const testFiles = walk(path.join(dir, 'tests'), (file) => /\.(test|spec)\.(ts|tsx|js|mjs)$/.test(file));
      const migrations = walk(path.join(dir, 'migrations'), (file) => file.endsWith('.sql'));
      const hasDataPlan = exists(path.join(dir, '.ploykit', 'generated', 'data-plan.json'));
      const actionCount = count(actionsBody, /handler\s*:/g);
      const jobCount = count(jobsBody, /handler\s*:/g);
      const eventCount = count(eventsBody, /handler\s*:/g);
      const webhookCount = count(webhooksBody, /handler\s*:/g);
      const hasData = /data\s*:/.test(content);
      const status =
        testFiles.length === 0
          ? 'test-gap'
          : routePaths.length > 0 && (actionCount > 0 || jobCount > 0 || webhookCount > 0 || hasData)
            ? 'product-demo-candidate'
            : 'mvp';

      return {
        id,
        file: rel(filePath),
        routes: routePaths.length,
        routePaths,
        actions: actionCount,
        jobs: jobCount,
        events: eventCount,
        webhooks: webhookCount,
        hasData,
        hasDataPlan,
        migrations: migrations.length,
        tests: testFiles.length,
        permissions,
        status,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function inventoryProviders() {
  const aiRagModuleFiles = inventoryModules()
    .filter((moduleInfo) =>
      moduleInfo.permissions.some((permission) => permission === 'AiGenerate' || permission === 'RagRead' || permission === 'RagWrite')
    )
    .map((moduleInfo) => `${moduleInfo.root}/module.ts`);
  const providerSpecs = [
    {
      id: 'runtime-store-postgres',
      label: 'Runtime Store / Postgres',
      env: ['DATABASE_URL'],
      files: [
        'src/lib/module-runtime/stores/postgres-runtime-store.ts',
        'scripts/runtime-stores.mjs',
        'scripts/host-postgres-local-smoke.mjs',
        'docker-compose.yml',
      ],
      requiredCommand:
        'npm run host:postgres-local-smoke (local Docker Postgres) or npm run runtime:stores:verify (external)',
    },
    {
      id: 'files-s3',
      label: 'Files / S3-compatible',
      env: ['S3_BUCKET', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
      files: [
        'scripts/host-s3-smoke.ts',
        'scripts/host-s3-local-smoke.mjs',
        'docker-compose.yml',
        'src/lib/module-capabilities/files/storage-file-runtime.ts',
      ],
      requiredCommand:
        'npm run host:s3-local-smoke (local MinIO) or npm run host:s3-smoke -- --required --check-signed-url (external)',
    },
    {
      id: 'billing-stripe',
      label: 'Billing / Stripe test mode',
      env: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
      optionalEnv: ['STRIPE_PRICE_DEMO_PRO_MONTHLY'],
      files: ['scripts/host-stripe-smoke.ts', 'apps/host-next/lib/commercial-provider.ts'],
      requiredCommand:
        'npm run host:stripe-local-smoke (local mock) or npm run host:stripe-smoke -- --required --apply-ledger (external Stripe)',
    },
    {
      id: 'email',
      label: 'Email provider',
      env: ['PLOYKIT_EMAIL_PROVIDER'],
      optionalEnv: ['PLOYKIT_EMAIL_WEBHOOK_URL', 'PLOYKIT_EMAIL_WEBHOOK_SECRET'],
      files: [
        'apps/host-next/lib/email-provider.ts',
        'scripts/host-email-smoke.ts',
        'scripts/host-email-local-webhook-smoke.ts',
      ],
      requiredCommand:
        'npm run host:email-local-webhook-smoke (local webhook) or npm run host:email-smoke -- --required (external)',
    },
    {
      id: 'ai-rag',
      label: 'AI/RAG provider',
      env: ['PLOYKIT_AI_PROVIDER'],
      optionalEnv: ['OPENAI_API_KEY'],
      files: [
        'src/lib/module-capabilities/rag/rag-runtime.ts',
        ...aiRagModuleFiles,
        'scripts/host-ai-rag-local-smoke.mjs',
      ],
      requiredCommand:
        'npm run host:ai-rag-local-smoke (local provider) or npm run test:ai-provider && npm run test:rag-files',
    },
  ];

  return providerSpecs.map((provider) => {
    const presentEnv = provider.env.filter((name) => Boolean(process.env[name]));
    const missingEnv = provider.env.filter((name) => !process.env[name]);
    const fileEvidence = provider.files.filter((file) => exists(path.join(root, file)));
    let status = missingEnv.length === 0 ? 'env-present' : 'blocked-by-env';
    if (provider.id === 'email' && missingEnv.length > 0) {
      status = exists(path.join(root, 'scripts/host-email-local-webhook-smoke.ts'))
        ? 'local-webhook-default'
        : 'local-log-default';
    }
    if (
      provider.id === 'runtime-store-postgres' &&
      missingEnv.length > 0 &&
      exists(path.join(root, 'scripts/host-postgres-local-smoke.mjs'))
    ) {
      status = 'local-postgres-default';
    }
    if (
      provider.id === 'files-s3' &&
      missingEnv.length > 0 &&
      exists(path.join(root, 'scripts/host-s3-local-smoke.mjs'))
    ) {
      status = 'local-minio-default';
    }
    if (provider.id === 'billing-stripe' && missingEnv.length > 0) {
      status = 'local-mock-default';
    }
    if (provider.id === 'ai-rag' && missingEnv.length > 0) {
      status = exists(path.join(root, 'scripts/host-ai-rag-local-smoke.mjs'))
        ? 'local-ai-rag-default'
        : 'static-provider-default';
    }
    return {
      ...provider,
      presentEnv,
      missingEnv,
      fileEvidence,
      status,
    };
  });
}

function inventoryTests() {
  const testFiles = walk(testsRoot, (file) => /\.(test|spec)\.(ts|tsx|js|mjs)$/.test(file));
  const moduleTestFiles = walk(modulesRoot, (file) => /[\\/]tests[\\/].*\.(test|spec)\.(ts|tsx|js|mjs)$/.test(file));
  const scriptFiles = walk(scriptsRoot, (file) => /\.(ts|mjs|js)$/.test(file));
  const packageJson = JSON.parse(read(path.join(root, 'package.json')));
  const scripts = Object.entries(packageJson.scripts ?? {}).map(([name, command]) => ({ name, command }));
  return {
    testFiles: testFiles.map(rel).sort(),
    moduleTestFiles: moduleTestFiles.map(rel).sort(),
    scripts: scripts.sort((left, right) => left.name.localeCompare(right.name)),
    evidenceScripts: scripts
      .filter(({ name }) => /test|smoke|matrix|evidence|doctor|check|gate|verify|soak|typecheck/.test(name))
      .sort((left, right) => left.name.localeCompare(right.name)),
    scriptFiles: scriptFiles.map(rel).sort(),
  };
}

function byStatus(items) {
  return items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});
}

function markdownCell(value) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join('<br>') : '-';
  }
  return String(value ?? '-')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function writeMarkdown(report, filePath) {
  const pageRisk = report.pages.filter((page) => page.risk);
  const apiRisk = report.apis.filter((api) => api.risk);
  const blockedProviders = report.providers.filter((provider) =>
    [
      'blocked-by-env',
      'local-postgres-default',
      'local-minio-default',
      'local-mock-default',
      'local-webhook-default',
      'local-ai-rag-default',
      'local-log-default',
      'static-provider-default',
    ].includes(provider.status)
  );
  const moduleRisk = report.modules.filter((module) => module.status === 'test-gap');

  const lines = [
    '# PloyKit 真实状态盘点',
    '',
    '> 自动生成文档。该盘点使用静态启发式扫描页面、API、模块、provider 和测试证据，用来发现风险和执行优先级；它不能替代人工代码审查或真实浏览器/Provider required matrix。',
    '',
    `- 生成时间：${report.checkedAt}`,
    '- 生成命令：`npm run host:inventory`',
    `- JSON 证据：\`${toPosix(path.relative(root, report.outputJson))}\``,
    '',
    '## 总览',
    '',
    '| 项目 | 数量/状态 |',
    '| --- | --- |',
    `| 页面 | ${report.summary.pages.total} 个，状态：${markdownCell(Object.entries(report.summary.pages.byStatus).map(([key, value]) => `${key}=${value}`))} |`,
    `| API route | ${report.summary.apis.total} 个文件，${report.summary.apis.methods} 个 method，状态：${markdownCell(Object.entries(report.summary.apis.byStatus).map(([key, value]) => `${key}=${value}`))} |`,
    `| 模块 | ${report.summary.modules.total} 个，状态：${markdownCell(Object.entries(report.summary.modules.byStatus).map(([key, value]) => `${key}=${value}`))} |`,
    `| Provider | ${report.summary.providers.total} 个，blocked/local/static：${blockedProviders.length} |`,
    `| 测试文件 | host tests ${report.summary.tests.hostTestFiles} 个，module tests ${report.summary.tests.moduleTestFiles} 个 |`,
    `| 证据脚本 | ${report.summary.tests.evidenceScripts} 个 |`,
    '',
    '## R0 风险结论',
    '',
    `1. 页面风险：${pageRisk.length} 个页面需要人工确认，主要是薄 wrapper 或占位文本风险。`,
    `2. API 风险：${apiRisk.length} 个 API route 需要人工确认，主要是 mutation route 的安全保护或 no-op 风险。`,
    `3. Provider 风险：${blockedProviders.length} 个 provider 仍有外部生产 profile 或持久化 provider 证据缺口；Postgres、S3、Stripe、Email、AI/RAG 已具备本地 profile。`,
    `4. 模块风险：${moduleRisk.length} 个模块缺少 module-local test。`,
    '5. 后续阶段每完成一批能力，都应该复跑本命令并提交最新 inventory，避免再次靠感觉判断完成度。',
    '',
    '## 页面清单',
    '',
    '| Route | Area | Status | Signals | Risk | File |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const page of report.pages) {
    lines.push(
      `| ${markdownCell(page.route)} | ${markdownCell(page.area)} | ${markdownCell(page.status)} | ${markdownCell(
        page.signals
      )} | ${markdownCell(page.risk)} | \`${page.file}\` |`
    );
  }

  lines.push('', '## API 清单', '', '| Route | Methods | Status | Signals | Risk | File |', '| --- | --- | --- | --- | --- | --- |');
  for (const api of report.apis) {
    lines.push(
      `| ${markdownCell(api.route)} | ${markdownCell(api.methods)} | ${markdownCell(api.status)} | ${markdownCell(
        api.signals
      )} | ${markdownCell(api.risk)} | \`${api.file}\` |`
    );
  }

  lines.push('', '## Provider 清单', '', '| Provider | Status | Missing Env | Evidence Files | Required Command |', '| --- | --- | --- | --- | --- |');
  for (const provider of report.providers) {
    lines.push(
      `| ${markdownCell(provider.label)} | ${markdownCell(provider.status)} | ${markdownCell(
        provider.missingEnv
      )} | ${markdownCell(provider.fileEvidence)} | \`${provider.requiredCommand}\` |`
    );
  }

  lines.push('', '## 模块清单', '', '| Module | Status | Routes | Actions | Jobs | Events | Webhooks | Data | Tests | File |', '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |');
  for (const module of report.modules) {
    lines.push(
      `| ${markdownCell(module.id)} | ${markdownCell(module.status)} | ${module.routes} | ${module.actions} | ${module.jobs} | ${module.events} | ${module.webhooks} | ${module.hasData ? 'yes' : 'no'} | ${module.tests} | \`${module.file}\` |`
    );
  }

  lines.push('', '## 测试与证据脚本', '', '| Script | Command |', '| --- | --- |');
  for (const script of report.tests.evidenceScripts) {
    lines.push(`| \`${script.name}\` | \`${script.command}\` |`);
  }

  lines.push('', '## 下一步建议', '');
  if (pageRisk.length > 0) {
    lines.push('- 先处理页面风险清单中面向终端用户的 `review-needed` 和关键 `component-wrapper` 页面，尤其是 pricing/contact/dashboard/profile/admin detail。');
  }
  if (apiRisk.length > 0) {
    lines.push('- 逐个审查 `security-review` API，确认 route catalog、CSRF/origin、webhook signature 或 machine auth 是否真实覆盖。');
  }
  if (blockedProviders.length > 0) {
    lines.push('- 为 Postgres/S3/Stripe/Email/AI provider 建外部或持久化 required 证据；当前本地 profile 已覆盖主路径，仍需外部 provider 固定证据和生产运维闭环。');
  }
  if (moduleRisk.length > 0) {
    lines.push('- 给缺测试模块补 `modules/<id>/tests/smoke.test.ts`，并让 `module:test` 生成报告。');
  }
  lines.push('- 把本 inventory 作为 R0 基线，R1/R2/R3 每轮提交前复跑一次。');

  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

const pages = inventoryPages();
const apis = inventoryApis();
const modules = inventoryModules();
const providers = inventoryProviders();
const tests = inventoryTests();

ensureDir(runtimeDir);
ensureDir(docsDir);

const report = {
  ok: true,
  checkedAt,
  projectRoot: root,
  pages,
  apis,
  modules,
  providers,
  tests,
  summary: {
    pages: {
      total: pages.length,
      byStatus: byStatus(pages),
      byArea: pages.reduce((acc, page) => {
        acc[page.area] = (acc[page.area] ?? 0) + 1;
        return acc;
      }, {}),
    },
    apis: {
      total: apis.length,
      methods: apis.reduce((sum, api) => sum + api.methods.length, 0),
      byStatus: byStatus(apis),
    },
    modules: {
      total: modules.length,
      byStatus: byStatus(modules),
    },
    providers: {
      total: providers.length,
      byStatus: byStatus(providers),
    },
    tests: {
      hostTestFiles: tests.testFiles.length,
      moduleTestFiles: tests.moduleTestFiles.length,
      evidenceScripts: tests.evidenceScripts.length,
    },
  },
};

const stampedDir = path.join(runtimeDir, checkedAt.replace(/[:.]/g, '-'));
ensureDir(stampedDir);
const jsonPath = path.join(stampedDir, 'inventory.json');
const markdownPath = path.join(docsDir, 'v2-real-state-inventory.zh-CN.md');
report.outputJson = jsonPath;
report.outputMarkdown = markdownPath;

fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
fs.copyFileSync(jsonPath, path.join(runtimeDir, 'latest.json'));
writeMarkdown(report, markdownPath);

process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
