import fs from 'node:fs';
import path from 'node:path';
import { resolvePagePresentation } from '../apps/host-next/lib/presentation/page-presentation';
import { createLocalizedSitemapEntry } from '../apps/host-next/lib/presentation/seo-presentation';

interface Diagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path: string;
}

const required = process.argv.includes('--required');
const diagnostics: Diagnostic[] = [];

function addError(code: string, message: string, path: string): void {
  diagnostics.push({ severity: 'error', code, message, path });
}

const publicPages = [
  ['site.home', '/zh'],
  ['site.pricing', '/zh/pricing'],
  ['site.about', '/zh/about'],
  ['site.contact', '/zh/contact'],
  ['site.docs', '/zh/docs'],
  ['site.privacy', '/zh/privacy'],
  ['site.terms', '/zh/terms'],
] as const;

for (const [pageId, pathname] of publicPages) {
  const presentation = await resolvePagePresentation({
    pageId,
    pathname,
    lang: 'zh',
  });

  if (presentation.renderer !== 'host') {
    addError(
      'DEFAULT_FRONTEND_PUBLIC_PAGE_NOT_HOST_RENDERED',
      `Public page "${pageId}" is not rendered by the host default.`,
      `pages.${pageId}.renderer`
    );
  }
  if (presentation.activeModuleId !== null) {
    addError(
      'DEFAULT_FRONTEND_PUBLIC_PAGE_HAS_MODULE_OWNER',
      `Public page "${pageId}" is unexpectedly owned by a module.`,
      `pages.${pageId}.activeModuleId`
    );
  }
  if (!presentation.seo.alternates?.canonical) {
    addError(
      'DEFAULT_FRONTEND_PUBLIC_PAGE_CANONICAL_MISSING',
      `Public page "${pageId}" is missing canonical metadata.`,
      `pages.${pageId}.seo.canonical`
    );
  }
}

const authPages = [
  ['auth.login', '/zh/login'],
  ['auth.register', '/zh/register'],
  ['auth.forgotPassword', '/zh/forgot-password'],
  ['auth.resetPassword', '/zh/reset-password'],
] as const;

for (const [pageId, pathname] of authPages) {
  const presentation = await resolvePagePresentation({
    pageId,
    pathname,
    lang: 'zh',
  });
  if (presentation.renderer !== 'host') {
    addError(
      'DEFAULT_FRONTEND_AUTH_PAGE_NOT_HOST_RENDERED',
      `Auth page "${pageId}" is not rendered by the host default.`,
      `pages.${pageId}.renderer`
    );
  }
  if (presentation.cache.mode !== 'no-store') {
    addError(
      'DEFAULT_FRONTEND_AUTH_CACHE_INVALID',
      `Auth page "${pageId}" must use no-store cache mode.`,
      `pages.${pageId}.cache`
    );
  }
}

const dashboard = await resolvePagePresentation({
  pageId: 'dashboard.home',
  pathname: '/zh/dashboard',
  lang: 'zh',
  workspaceId: 'demo-workspace',
});
if (dashboard.renderer !== 'host') {
  addError(
    'DEFAULT_FRONTEND_DASHBOARD_HOME_NOT_HOST_RENDERED',
    'Dashboard home is not rendered by the host default.',
    'pages.dashboard.home.renderer'
  );
}
if (dashboard.theme.workspace?.workspaceId !== 'demo-workspace') {
  addError(
    'DEFAULT_FRONTEND_WORKSPACE_THEME_MISSING',
    'Dashboard home did not resolve the workspace theme override.',
    'pages.dashboard.home.theme.workspace'
  );
}

const admin = await resolvePagePresentation({
  pageId: 'admin.modules',
  pathname: '/zh/admin/modules',
  lang: 'zh',
});
if (admin.renderer !== 'host' || admin.replacePolicy !== 'controlled') {
  addError(
    'DEFAULT_FRONTEND_ADMIN_CONTROLLED_BOUNDARY_INVALID',
    'Admin modules page must stay host-rendered and controlled.',
    'pages.admin.modules'
  );
}

const docsSitemap = createLocalizedSitemapEntry('/docs', 'zh');
if (!docsSitemap.alternates?.languages?.en || !docsSitemap.alternates.languages.zh) {
  addError(
    'DEFAULT_FRONTEND_DOCS_HREFLANG_MISSING',
    'Docs page must emit zh/en hreflang alternates.',
    'sitemap.docs.alternates'
  );
}

const ok = diagnostics.every((item) => item.severity !== 'error');
const result = {
  ok: required ? ok : true,
  required,
  checkedAt: new Date().toISOString(),
  diagnostics,
};

const outputDir = path.join(process.cwd(), '.runtime', 'white-label-smoke');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'latest.json'), `${JSON.stringify(result, null, 2)}\n`);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 1;
