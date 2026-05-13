/* eslint-disable no-console */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from 'dotenv';
import { chromium, type Browser, type Page } from 'playwright';

config({ path: path.resolve(process.cwd(), '.env') });

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const BASE_URL =
  process.env.PLOYKIT_MEDIA_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.PLOYKIT_MEDIA_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.PLOYKIT_MEDIA_ADMIN_PASSWORD ?? 'Admin@123456';

const BRAND_DIR = path.join(ROOT, 'public/brand');
const SCREENSHOT_DIR = path.join(ROOT, 'public/media/screenshots');
const SOCIAL_DIR = path.join(ROOT, 'public/media/social');
const DEMO_DIR = path.join(ROOT, 'public/media/demo');
const FRAME_DIR = path.join(ROOT, '.data/open-source-media-frames');
const NAVIGATION_TIMEOUT_MS = 60_000;

async function ensureDirs() {
  await Promise.all(
    [BRAND_DIR, SCREENSHOT_DIR, SOCIAL_DIR, DEMO_DIR, FRAME_DIR].map((dir) =>
      fs.mkdir(dir, { recursive: true })
    )
  );
}

async function writeText(filePath: string, content: string) {
  await fs.writeFile(filePath, content, 'utf8');
  console.log(`wrote ${path.relative(ROOT, filePath)}`);
}

function markSvg(size = 96) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 96 96" role="img" aria-label="PloyKit mark">
  <rect x="8" y="8" width="80" height="80" rx="18" fill="#0f172a"/>
  <path d="M28 66V30h22c9 0 16 6 16 15s-7 15-16 15H39v6H28Zm11-16h10c4 0 7-2 7-5s-3-5-7-5H39v10Z" fill="#f8fafc"/>
  <circle cx="69" cy="26" r="6" fill="#14b8a6"/>
  <circle cx="74" cy="70" r="6" fill="#f59e0b"/>
  <path d="M64 31l-9 9M60 57l10 9" stroke="#e2e8f0" stroke-width="4" stroke-linecap="round"/>
</svg>`;
}

function logoSvg() {
  const embeddedMark = markSvg(96)
    .replace(
      '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="PloyKit mark">',
      '<g>'
    )
    .replace('</svg>', '</g>');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="96" viewBox="0 0 420 96" role="img" aria-label="PloyKit logo">
  ${embeddedMark}
  <text x="116" y="59" fill="#0f172a" font-family="Inter, Arial, sans-serif" font-size="42" font-weight="800" letter-spacing="0">PloyKit</text>
  <text x="118" y="80" fill="#475569" font-family="Inter, Arial, sans-serif" font-size="15" font-weight="600" letter-spacing="0">Plugin-first SaaS and tool-site host</text>
</svg>`;
}

function shellFrame(title: string, subtitle: string, body: string, width: number, height: number) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #e5e7eb; font-family: Inter, Arial, sans-serif; }
  .asset {
    width: ${width}px;
    height: ${height}px;
    position: relative;
    overflow: hidden;
    background:
      linear-gradient(135deg, rgba(20,184,166,.16), transparent 34%),
      linear-gradient(315deg, rgba(245,158,11,.18), transparent 36%),
      #f8fafc;
    color: #0f172a;
  }
  .top { position: absolute; left: 64px; top: 52px; display: flex; align-items: center; gap: 18px; }
  .mark { width: 58px; height: 58px; }
  .brand { font-size: 31px; font-weight: 800; line-height: 1; }
  .tag { color: #475569; font-size: 15px; font-weight: 700; margin-top: 8px; }
  .headline { position: absolute; left: 70px; top: ${height > 640 ? 170 : 150}px; width: 560px; font-size: ${height > 640 ? 58 : 50}px; line-height: 1.02; font-weight: 850; letter-spacing: 0; }
  .subtitle { position: absolute; left: 74px; top: ${height > 640 ? 330 : 292}px; width: 520px; color: #334155; font-size: ${height > 640 ? 24 : 22}px; line-height: 1.35; font-weight: 600; }
  .stage { position: absolute; right: 62px; top: ${height > 640 ? 122 : 104}px; width: ${width > 1220 ? 520 : 470}px; height: ${height > 640 ? 660 : 470}px; border: 1px solid #cbd5e1; border-radius: 8px; background: #ffffff; box-shadow: 0 24px 70px rgba(15,23,42,.16); overflow: hidden; }
  .bar { height: 46px; background: #0f172a; display: flex; align-items: center; gap: 8px; padding: 0 16px; }
  .dot { width: 10px; height: 10px; border-radius: 99px; background: #64748b; }
  .dot:nth-child(1) { background: #f97316; }
  .dot:nth-child(2) { background: #f59e0b; }
  .dot:nth-child(3) { background: #14b8a6; }
  .content { padding: 22px; display: grid; gap: 14px; }
  .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; background: #f8fafc; }
  .eyebrow { color: #0f766e; font-size: 12px; text-transform: uppercase; font-weight: 800; }
  .card-title { margin-top: 6px; font-size: 19px; font-weight: 800; }
  .line { height: 10px; border-radius: 99px; background: #cbd5e1; margin-top: 10px; }
  .line.short { width: 62%; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .pill { display: inline-flex; align-items: center; padding: 6px 10px; border-radius: 999px; background: #ccfbf1; color: #115e59; font-size: 13px; font-weight: 800; }
  .footer { position: absolute; left: 74px; bottom: 54px; display: flex; gap: 12px; }
  .chip { border: 1px solid #cbd5e1; background: rgba(255,255,255,.75); padding: 10px 14px; border-radius: 8px; font-weight: 750; color: #334155; }
  ${body}
</style>
</head>
<body>
<div class="asset">
  <div class="top">
    <div class="mark">${markSvg(58)}</div>
    <div><div class="brand">PloyKit</div><div class="tag">AI-ready plugin host</div></div>
  </div>
  <div class="headline">${title}</div>
  <div class="subtitle">${subtitle}</div>
  <div class="stage">
    <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
    <div class="content">
      <div class="card"><div class="eyebrow">contract</div><div class="card-title">plugin.ts declares routes, data, permissions, and egress</div><div class="line"></div><div class="line short"></div></div>
      <div class="grid">
        <div class="card"><div class="eyebrow">ctx</div><div class="card-title">Capabilities</div><div class="line"></div></div>
        <div class="card"><div class="eyebrow">doctor</div><div class="card-title">JSON diagnostics</div><div class="line"></div></div>
      </div>
      <div class="card"><span class="pill">plugin:doctor success</span><div class="line"></div><div class="line short"></div></div>
    </div>
  </div>
  <div class="footer"><div class="chip">Next.js</div><div class="chip">TypeScript</div><div class="chip">Plugin SDK</div></div>
</div>
</body>
</html>`;
}

function docsPreviewHtml(width: number, height: number) {
  return shellFrame(
    'Docs that help agents ship plugins',
    'Contracts, capabilities, diagnostics, templates, and a reusable Codex skill.',
    `.stage .content { grid-template-columns: 1fr; }
     .stage .card:nth-child(1) .eyebrow::after { content: " / docs"; }
     .footer .chip:nth-child(1)::after { content: " docs"; }`,
    width,
    height
  );
}

function workflowHtml(width: number, height: number) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Inter, Arial, sans-serif; background: #f8fafc; }
  .asset { width: ${width}px; height: ${height}px; padding: 56px; color: #0f172a; background: #f8fafc; overflow: hidden; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 42px; }
  .brand { display: flex; align-items: center; gap: 18px; font-size: 32px; font-weight: 850; }
  .tag { color: #475569; font-weight: 700; font-size: 18px; }
  h1 { font-size: 56px; line-height: 1.02; margin: 0 0 18px; letter-spacing: 0; max-width: 900px; }
  .lede { color: #334155; font-size: 23px; line-height: 1.38; max-width: 900px; margin-bottom: 38px; }
  .flow { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; align-items: stretch; }
  .step { min-height: 365px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; padding: 24px; box-shadow: 0 16px 36px rgba(15,23,42,.08); position: relative; }
  .num { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 8px; background: #0f172a; color: #fff; font-weight: 850; }
  .step h2 { margin: 18px 0 12px; font-size: 25px; line-height: 1.12; }
  .step p { color: #475569; font-size: 16px; line-height: 1.45; margin: 0; }
  .code { margin-top: 20px; border-radius: 8px; background: #0f172a; color: #e2e8f0; padding: 16px; font-family: Consolas, monospace; font-size: 15px; line-height: 1.5; }
  .accent { position: absolute; left: 24px; right: 24px; bottom: 24px; height: 8px; border-radius: 99px; background: linear-gradient(90deg, #14b8a6, #f59e0b); }
  .footer { display: flex; gap: 12px; margin-top: 32px; }
  .pill { border: 1px solid #cbd5e1; border-radius: 999px; padding: 10px 14px; color: #334155; font-weight: 750; background: #fff; }
</style>
</head>
<body>
<div class="asset">
  <div class="header">
    <div class="brand">${markSvg(64)}<span>PloyKit AI Plugin Workflow</span></div>
    <div class="tag">contract first, diagnostics tight</div>
  </div>
  <h1>Product intent becomes a typed plugin, then converges through JSON diagnostics.</h1>
  <div class="lede">The AI agent works in one plugin directory, updates the contract first, uses host capabilities through ctx, and repairs with plugin:doctor.</div>
  <div class="flow">
    <div class="step"><div class="num">1</div><h2>Declare plugin.ts</h2><p>Routes, storage, permissions, resources, jobs, events, webhooks, and egress live in one contract.</p><div class="code">definePlugin({<br/> id: "invoice-helper",<br/> permissions: [...]<br/>})</div><div class="accent"></div></div>
    <div class="step"><div class="num">2</div><h2>Implement locally</h2><p>Pages and handlers stay under plugins/&lt;id&gt;. Platform behavior goes through ctx capabilities.</p><div class="code">ctx.storage<br/>ctx.audit<br/>ctx.http.fetch</div><div class="accent"></div></div>
    <div class="step"><div class="num">3</div><h2>Test with fake host</h2><p>Plugin tests assert capability calls without a full deployment, real billing provider, or external service.</p><div class="code">testPlugin(plugin,<br/> async ({ ctx }) =&gt; { ... })</div><div class="accent"></div></div>
    <div class="step"><div class="num">4</div><h2>Repair by doctor</h2><p>The command returns structured check, test, inspect, diagnostics, and next commands.</p><div class="code">npm run plugin:doctor<br/>success: true</div><div class="accent"></div></div>
  </div>
  <div class="footer"><div class="pill">AGENTS.md</div><div class="pill">AI_TASK.md</div><div class="pill">Codex Skill</div><div class="pill">plugin:doctor</div></div>
</div>
</body>
</html>`;
}

function demoFrameHtml(index: number, title: string, command: string, output: string) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { margin: 0; background: #0f172a; font-family: Inter, Arial, sans-serif; }
  .asset { width: 960px; height: 540px; padding: 34px; color: #e2e8f0; background: #0f172a; }
  .top { display: flex; justify-content: space-between; align-items: center; color: #94a3b8; font-size: 16px; font-weight: 700; }
  .brand { display: flex; align-items: center; gap: 12px; color: #fff; font-size: 22px; font-weight: 850; }
  .terminal { margin-top: 28px; border: 1px solid #334155; border-radius: 8px; overflow: hidden; background: #020617; box-shadow: 0 24px 60px rgba(0,0,0,.35); }
  .bar { height: 38px; background: #111827; display: flex; align-items: center; gap: 8px; padding: 0 14px; }
  .dot { width: 10px; height: 10px; border-radius: 999px; background: #64748b; }
  .dot:nth-child(1) { background: #f97316; }
  .dot:nth-child(2) { background: #f59e0b; }
  .dot:nth-child(3) { background: #14b8a6; }
  .screen { padding: 26px; min-height: 360px; font-family: Consolas, monospace; font-size: 22px; line-height: 1.55; }
  .prompt { color: #14b8a6; }
  .cmd { color: #f8fafc; }
  .out { color: #cbd5e1; margin-top: 18px; white-space: pre-line; }
  .step { color: #f59e0b; }
</style>
</head>
<body>
<div class="asset">
  <div class="top"><div class="brand">${markSvg(36)}PloyKit</div><div>plugin workflow ${index}/6</div></div>
  <div class="terminal">
    <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
    <div class="screen">
      <div class="step">${title}</div>
      <div><span class="prompt">$</span> <span class="cmd">${command}</span></div>
      <div class="out">${output}</div>
    </div>
  </div>
</div>
</body>
</html>`;
}

async function renderHtml(
  browser: Browser,
  html: string,
  outputPath: string,
  width: number,
  height: number
) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.locator('.asset').screenshot({ path: outputPath });
  await page.close();
  console.log(`wrote ${path.relative(ROOT, outputPath)}`);
}

async function generateBrand(browser: Browser) {
  await writeText(path.join(BRAND_DIR, 'ploykit-mark.svg'), markSvg(96));
  await writeText(path.join(BRAND_DIR, 'favicon.svg'), markSvg(96));
  await writeText(path.join(BRAND_DIR, 'ploykit-logo.svg'), logoSvg());

  await renderHtml(
    browser,
    `<!doctype html><html><body style="margin:0"><div class="asset" style="width:180px;height:180px;display:grid;place-items:center;background:#f8fafc">${markSvg(148)}</div></body></html>`,
    path.join(BRAND_DIR, 'apple-touch-icon.png'),
    180,
    180
  );

  await renderHtml(
    browser,
    shellFrame(
      'Plugin-first SaaS and public tool-site host',
      'Typed plugin contracts, host capabilities, billing, files, SEO, jobs, operations, and AI-ready diagnostics.',
      '',
      1200,
      630
    ),
    path.join(BRAND_DIR, 'og-default.png'),
    1200,
    630
  );

  await renderHtml(
    browser,
    shellFrame(
      'Build SaaS tools as typed plugins',
      'A Next.js host with plugin contracts, capability boundaries, billing, files, operations, and AI-assisted development.',
      '',
      1280,
      640
    ),
    path.join(SOCIAL_DIR, 'github-preview.png'),
    1280,
    640
  );

  await renderHtml(
    browser,
    docsPreviewHtml(1200, 630),
    path.join(SOCIAL_DIR, 'docs-preview.png'),
    1200,
    630
  );

  await renderHtml(
    browser,
    workflowHtml(1440, 960),
    path.join(SCREENSHOT_DIR, 'ai-plugin-workflow.png'),
    1440,
    960
  );
}

async function serverReachable() {
  try {
    const response = await fetch(BASE_URL);
    return response.ok;
  } catch {
    return false;
  }
}

async function loginAsAdmin(page: Page) {
  page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

  const response = await page.request.post(`${BASE_URL}/api/auth/sign-in/email`, {
    headers: {
      origin: BASE_URL,
      referer: `${BASE_URL}/en/login`,
    },
    data: {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      callbackURL: `${BASE_URL}/en`,
    },
  });

  if (!response.ok()) {
    throw new Error(`Admin sign-in failed: ${response.status()} ${await response.text()}`);
  }
}

async function ensureSamplePluginEnabled(page: Page) {
  const readPlugins = async () => {
    const response = await page.request.get(`${BASE_URL}/api/admin/plugins`);
    const body = await response.json().catch(() => ({}));

    if (!response.ok()) {
      throw new Error(
        `GET /api/admin/plugins failed: ${response.status()} ${JSON.stringify(body)}`
      );
    }

    return body as { plugins?: Array<{ id?: string; installed?: boolean; enabled?: boolean }> };
  };

  let body = await readPlugins();
  let sample = body.plugins?.find((plugin) => plugin.id === 'sample-internal');

  if (!sample) {
    throw new Error(`sample-internal plugin not found: ${JSON.stringify(body)}`);
  }

  if (!sample.installed) {
    const install = await page.request.post(
      `${BASE_URL}/api/admin/plugins/sample-internal/install`,
      {
        data: {},
      }
    );
    const installBody = await install.json().catch(() => ({}));

    if (!install.ok()) {
      throw new Error(
        `POST /api/admin/plugins/sample-internal/install failed: ${install.status()} ${JSON.stringify(installBody)}`
      );
    }

    body = await readPlugins();
    sample = body.plugins?.find((plugin) => plugin.id === 'sample-internal');
  }

  if (!sample?.enabled) {
    const enable = await page.request.post(`${BASE_URL}/api/admin/plugins/sample-internal/enable`, {
      data: {},
    });
    const enableBody = await enable.json().catch(() => ({}));

    if (!enable.ok()) {
      throw new Error(
        `POST /api/admin/plugins/sample-internal/enable failed: ${enable.status()} ${JSON.stringify(enableBody)}`
      );
    }
  }
}

async function preparePage(page: Page) {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('theme', 'light');
  });
}

async function capturePage(
  browser: Browser,
  route: string,
  outputName: string,
  expectedText: string,
  options: { auth?: boolean; before?: (page: Page) => Promise<void> } = {}
) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  await preparePage(page);

  try {
    if (options.auth) {
      await loginAsAdmin(page);
    }
    if (options.before) {
      await options.before(page);
    }

    await page.goto(`${BASE_URL}${route}`, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page
      .getByText(expectedText, { exact: false })
      .first()
      .waitFor({ timeout: NAVIGATION_TIMEOUT_MS });
    await page.addStyleTag({
      content:
        '*{animation:none!important;transition:none!important;caret-color:transparent!important} input,textarea{caret-color:transparent!important}',
    });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, outputName), fullPage: false });
    console.log(`wrote ${path.join('public/media/screenshots', outputName)}`);
  } finally {
    await page.close();
  }
}

async function captureScreenshots(browser: Browser) {
  if (!(await serverReachable())) {
    console.warn(`skipped product screenshots because ${BASE_URL} is not reachable`);
    return;
  }

  const captures: Array<Parameters<typeof capturePage>> = [
    [browser, '/en/admin', 'dashboard-admin.png', 'System Status', { auth: true }],
    [
      browser,
      '/en/admin/plugins/dev',
      'plugin-dev-console.png',
      'Plugin Dev Console',
      { auth: true },
    ],
    [browser, '/en/admin/plugins', 'plugin-management.png', 'Sample Internal', { auth: true }],
    [browser, '/en/json', 'public-json-tool.png', 'JSON Formatter'],
    [
      browser,
      '/en/plugins/sample-internal',
      'plugin-runtime-sample.png',
      'Sample Internal',
      { auth: true, before: ensureSamplePluginEnabled },
    ],
  ];

  for (const capture of captures) {
    try {
      await capturePage(...capture);
    } catch (error) {
      console.warn(
        `skipped ${capture[2]}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

async function generateDemo(browser: Browser) {
  const frames = [
    [
      'Create from the smallest template',
      'npm run plugin:create -- invoice-helper --template tool',
      'created plugins/invoice-helper\ncopied template files\nnext: edit plugin.ts first',
    ],
    [
      'Declare the contract',
      'code plugins/invoice-helper/plugin.ts',
      'routes.pages: /\nroutes.apis: POST /run\npermissions: storage, audit, usage',
    ],
    [
      'Run the tight loop',
      'npm run plugin:doctor -- plugins/invoice-helper',
      'checked: 1\ndiagnostics.error: 0\ntests.success: true',
    ],
    [
      'Inspect machine-readable output',
      'npm run plugin:inspect -- plugins/invoice-helper',
      'routes: pages 1, apis 1\nstorage collections: 1\ncommands: check, test, build',
    ],
    [
      'Reconcile host runtime map',
      'npm run plugins:scan',
      'src/lib/plugin-map.ts updated\nplugin manifest updated',
    ],
    [
      'Ready for review',
      'npm run plugin:build -- plugins/invoice-helper',
      'artifact signed\nreport emitted\nplugin ready',
    ],
  ] as const;

  for (const [index, frame] of frames.entries()) {
    await renderHtml(
      browser,
      demoFrameHtml(index + 1, frame[0], frame[1], frame[2]),
      path.join(FRAME_DIR, `frame-${String(index + 1).padStart(2, '0')}.png`),
      960,
      540
    );
  }

  const inputPattern = path.join(FRAME_DIR, 'frame-%02d.png');
  const mp4Path = path.join(DEMO_DIR, 'plugin-create-doctor-loop.mp4');
  const gifPath = path.join(DEMO_DIR, 'plugin-create-doctor-loop.gif');

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-framerate',
      '1',
      '-i',
      inputPattern,
      '-vf',
      'fps=24,format=yuv420p',
      '-movflags',
      '+faststart',
      mp4Path,
    ]);
    console.log(`wrote ${path.relative(ROOT, mp4Path)}`);

    await execFileAsync('ffmpeg', [
      '-y',
      '-framerate',
      '1',
      '-i',
      inputPattern,
      '-vf',
      'fps=8,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer',
      '-loop',
      '0',
      gifPath,
    ]);
    console.log(`wrote ${path.relative(ROOT, gifPath)}`);
  } catch (error) {
    console.warn(`skipped demo video generation because ffmpeg failed: ${String(error)}`);
  }
}

async function main() {
  await ensureDirs();
  const browser = await chromium.launch();

  try {
    await generateBrand(browser);
    await generateDemo(browser);
    await captureScreenshots(browser);
  } finally {
    await browser.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
