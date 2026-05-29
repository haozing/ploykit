import fs from 'node:fs';
import path from 'node:path';
import {
  getProductThemeDiagnosticsView,
  type ProductThemeScopeView,
} from '../apps/host-next/lib/product-composition';

const required = process.argv.includes('--required');
const projectRoot = process.cwd();
const view = await getProductThemeDiagnosticsView();
const diagnostics: { severity: 'error' | 'warning'; code: string; message: string; path: string }[] = [];
const contrastChecks: {
  scope: string;
  mode: 'light' | 'dark';
  foreground: string;
  background: string;
  ratio: number | null;
  threshold: number;
  ok: boolean;
  reason?: string;
}[] = [];

function addDiagnostic(
  severity: 'error' | 'warning',
  code: string,
  message: string,
  diagnosticPath: string
): void {
  diagnostics.push({ severity, code, message, path: diagnosticPath });
}

function collectFiles(relativeRoot: string): string[] {
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
      const ext = path.extname(entry.name);
      if (['.css', '.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
        files.push(path.join(dir, entry.name));
      }
    }
  };
  visit(root);
  return files;
}

function hasLegacyVariable(content: string, token: string): boolean {
  return (
    content.includes(`var(${token}`) ||
    new RegExp(`(^|\\s)${token.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*:`, 'm').test(
      content
    )
  );
}

function unsafeTokenValue(value: string | number): boolean {
  const text = String(value).trim();
  return !text || text.includes('</') || /[{};]/.test(text);
}

function normalizeHexColor(value: string | number | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(text);
  if (short) {
    return `#${short[1]
      .split('')
      .map((char) => `${char}${char}`)
      .join('')}`.toLowerCase();
  }
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : null;
}

function hexToRgb(value: string): { r: number; g: number; b: number } {
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  };
}

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(value: string): number {
  const rgb = hexToRgb(value);
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  );
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function addScopeDiagnostics(scope: ProductThemeScopeView, basePath: string): void {
  for (const message of scope.diagnostics) {
    const severity = message === 'THEME_SCOPE_DISABLED' ? 'warning' : 'error';
    addDiagnostic(
      severity,
      'THEME_SCOPE_DIAGNOSTIC',
      `${scope.scope} theme scope reported "${message}".`,
      `${basePath}.diagnostics`
    );
  }
}

function checkUnsafeAcceptedTokens(
  tokens: Record<string, string | number>,
  code: string,
  basePath: string
): void {
  for (const [token, value] of Object.entries(tokens)) {
    if (unsafeTokenValue(value)) {
      addDiagnostic(
        'error',
        code,
        `Theme token "${token}" contains unsafe CSS characters.`,
        `${basePath}.${token}`
      );
    }
  }
}

function recordContrastCheck(input: {
  scope: string;
  path: string;
  mode: 'light' | 'dark';
  tokens: Record<string, string | number>;
  foregroundToken: string;
  backgroundToken: string;
  threshold: number;
}): void {
  if (!(input.foregroundToken in input.tokens) || !(input.backgroundToken in input.tokens)) {
    return;
  }
  const foreground = normalizeHexColor(input.tokens[input.foregroundToken]);
  const background = normalizeHexColor(input.tokens[input.backgroundToken]);
  if (!foreground || !background) {
    contrastChecks.push({
      scope: input.scope,
      mode: input.mode,
      foreground: input.foregroundToken,
      background: input.backgroundToken,
      ratio: null,
      threshold: input.threshold,
      ok: false,
      reason: 'unsupported-color-format',
    });
    addDiagnostic(
      'warning',
      'THEME_CONTRAST_UNCHECKED',
      `Contrast for "${input.foregroundToken}" on "${input.backgroundToken}" could not be checked because one value is not a hex color.`,
      `${input.path}.${input.mode}.${input.foregroundToken}`
    );
    return;
  }

  const ratio = Number(contrastRatio(foreground, background).toFixed(2));
  const ok = ratio >= input.threshold;
  contrastChecks.push({
    scope: input.scope,
    mode: input.mode,
    foreground: input.foregroundToken,
    background: input.backgroundToken,
    ratio,
    threshold: input.threshold,
    ok,
  });
  if (!ok) {
    addDiagnostic(
      'error',
      'THEME_CONTRAST_LOW',
      `Contrast for "${input.foregroundToken}" on "${input.backgroundToken}" is ${ratio}:1, below ${input.threshold}:1.`,
      `${input.path}.${input.mode}.${input.foregroundToken}`
    );
  }
}

function checkScopeContrast(input: {
  scope: string;
  path: string;
  lightTokens: Record<string, string | number>;
  darkTokens: Record<string, string | number>;
}): void {
  for (const [mode, tokens] of [
    ['light', input.lightTokens],
    ['dark', input.darkTokens],
  ] as const) {
    for (const pair of [
      ['colorForeground', 'colorBackground', 4.5],
      ['colorSurfaceForeground', 'colorSurface', 4.5],
      ['colorPrimaryForeground', 'colorPrimary', 4.5],
      ['colorMutedForeground', 'colorSurface', 3],
      ['focusRing', 'colorBackground', 3],
    ] as const) {
      recordContrastCheck({
        scope: input.scope,
        path: input.path,
        mode,
        tokens,
        foregroundToken: pair[0],
        backgroundToken: pair[1],
        threshold: pair[2],
      });
    }
  }
}

function themeScopeManifest(scope: ProductThemeScopeView) {
  return {
    scope: scope.scope,
    workspaceId: scope.workspaceId,
    themeProfileId: scope.themeProfileId,
    profileName: scope.profileName,
    profileExists: scope.profileExists,
    modeDefault: scope.modeDefault,
    density: scope.density,
    acceptedTokens: scope.acceptedTokens,
    rejectedTokens: scope.rejectedTokens,
    acceptedDarkTokens: scope.acceptedDarkTokens,
    rejectedDarkTokens: scope.rejectedDarkTokens,
    cssVariables: scope.cssVariables,
    darkCssVariables: scope.darkCssVariables,
    localeTypography: scope.localeTypography,
    diagnostics: scope.diagnostics,
  };
}

addScopeDiagnostics(view.productProfile, 'theme.product');
checkUnsafeAcceptedTokens(
  view.productProfile.acceptedTokens,
  'THEME_PRODUCT_TOKEN_VALUE_UNSAFE',
  'theme.product.tokens'
);
checkUnsafeAcceptedTokens(
  view.productProfile.acceptedDarkTokens,
  'THEME_PRODUCT_DARK_TOKEN_VALUE_UNSAFE',
  'theme.product.darkTokens'
);

for (const token of Object.keys(view.productProfile.rejectedTokens)) {
  addDiagnostic(
    'error',
    'THEME_PRODUCT_TOKEN_REJECTED',
    `Product theme token "${token}" is not allowed.`,
    `theme.product.${token}`
  );
}

for (const token of Object.keys(view.productProfile.rejectedDarkTokens)) {
  addDiagnostic(
    'error',
    'THEME_PRODUCT_DARK_TOKEN_REJECTED',
    `Product dark theme token "${token}" is not allowed.`,
    `theme.product.dark.${token}`
  );
}

for (const language of view.supportedLanguages) {
  const typography = view.productProfile.localeTypography[language];
  if (!typography) {
    addDiagnostic(
      'error',
      'THEME_LOCALE_TYPOGRAPHY_MISSING',
      `Product theme profile is missing localeTypography for "${language}".`,
      `theme.product.localeTypography.${language}`
    );
  }
}

checkScopeContrast({
  scope: 'product',
  path: 'theme.product.contrast',
  lightTokens: view.productProfile.acceptedTokens,
  darkTokens: view.productProfile.acceptedDarkTokens,
});

for (const workspace of view.workspaceProfiles) {
  addScopeDiagnostics(workspace, `theme.workspace.${workspace.workspaceId}`);
  checkUnsafeAcceptedTokens(
    workspace.acceptedTokens,
    'THEME_WORKSPACE_TOKEN_VALUE_UNSAFE',
    `theme.workspace.${workspace.workspaceId}.tokens`
  );
  checkUnsafeAcceptedTokens(
    workspace.acceptedDarkTokens,
    'THEME_WORKSPACE_DARK_TOKEN_VALUE_UNSAFE',
    `theme.workspace.${workspace.workspaceId}.darkTokens`
  );
  for (const token of Object.keys(workspace.rejectedTokens)) {
    addDiagnostic(
      'error',
      'THEME_WORKSPACE_TOKEN_REJECTED',
      `Workspace "${workspace.workspaceId}" theme token "${token}" is not allowed.`,
      `theme.workspace.${workspace.workspaceId}.${token}`
    );
  }
  for (const token of Object.keys(workspace.rejectedDarkTokens)) {
    addDiagnostic(
      'error',
      'THEME_WORKSPACE_DARK_TOKEN_REJECTED',
      `Workspace "${workspace.workspaceId}" dark theme token "${token}" is not allowed.`,
      `theme.workspace.${workspace.workspaceId}.dark.${token}`
    );
  }

  checkScopeContrast({
    scope: `workspace:${workspace.workspaceId ?? 'unknown'}`,
    path: `theme.workspace.${workspace.workspaceId}.contrast`,
    lightTokens: {
      ...view.productProfile.acceptedTokens,
      ...workspace.acceptedTokens,
    },
    darkTokens: {
      ...view.productProfile.acceptedDarkTokens,
      ...workspace.acceptedDarkTokens,
    },
  });
}

for (const module of view.modules) {
  if (!module.declaredThemeWrite) {
    addDiagnostic(
      'error',
      'THEME_MODULE_PERMISSION_MISSING',
      `Module "${module.moduleId}" declares theme tokens without ThemeWrite.`,
      `modules.${module.moduleId}.permissions`
    );
  }
  if (module.hasCss) {
    addDiagnostic(
      'error',
      'THEME_MODULE_CSS_UNSUPPORTED',
      `Module "${module.moduleId}" declares theme.css, which is not part of the global theme path.`,
      `modules.${module.moduleId}.theme.css`
    );
  }
  checkUnsafeAcceptedTokens(
    module.acceptedTokens,
    'THEME_MODULE_TOKEN_VALUE_UNSAFE',
    `modules.${module.moduleId}.theme.tokens`
  );
  for (const token of Object.keys(module.rejectedTokens)) {
    addDiagnostic(
      'error',
      'THEME_MODULE_TOKEN_REJECTED',
      `Module "${module.moduleId}" theme token "${token}" is not allowed.`,
      `modules.${module.moduleId}.theme.tokens.${token}`
    );
  }
}

for (const filePath of [
  ...collectFiles('apps/host-next/app'),
  ...collectFiles('apps/host-next/components'),
  ...collectFiles('apps/host-next/lib'),
  ...collectFiles('modules'),
  ...collectFiles('templates'),
  ...collectFiles('src'),
]) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const token of ['--bg', '--panel', '--accent']) {
    if (hasLegacyVariable(content, token)) {
      addDiagnostic(
        'error',
        'THEME_LEGACY_CSS_VARIABLE',
        `Legacy CSS variable "${token}" is not allowed in the theme kernel.`,
        path.relative(projectRoot, filePath).replace(/\\/g, '/')
      );
    }
  }
}

const outputPaths = [
  path.join(projectRoot, '.runtime', 'theme-manifest.json'),
  path.join(projectRoot, '.ploykit', 'generated', 'theme.manifest.json'),
];
const manifest = {
  kind: 'ploykit.theme.manifest',
  checkedAt: new Date().toISOString(),
  allowedTokens: view.allowedTokens,
  supportedLanguages: view.supportedLanguages,
  productProfile: themeScopeManifest(view.productProfile),
  workspaceProfiles: view.workspaceProfiles.map(themeScopeManifest),
  modules: view.modules,
  contrastChecks,
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
  allowedTokens: view.allowedTokens,
  supportedLanguages: view.supportedLanguages,
  productProfile: view.productProfile.themeProfileId,
  localeTypography: Object.keys(view.productProfile.localeTypography),
  workspaceProfiles: view.workspaceProfiles.map((item) => item.workspaceId),
  modules: view.modules.map((item) => item.moduleId),
  contrastChecks,
  diagnostics,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 1;
