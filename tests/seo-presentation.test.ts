import assert from 'node:assert/strict';
import test from 'node:test';
import sitemap from '../apps/host-next/app/sitemap';
import { createBrandAssetManifest } from '../apps/host-next/lib/presentation/brand-assets';
import {
  createProductSeoMetadata,
  createProductStructuredData,
  createProductViewport,
  getProductBrandPresentation,
  getProductWebManifest,
} from '../apps/host-next/lib/presentation/seo-presentation';
import { resolvePagePresentation } from '../apps/host-next/lib/presentation/page-presentation';
import { siteModuleMetadata } from '../apps/host-next/lib/site-module-page';

test('product SEO metadata uses locale catalog, brand assets and hreflang alternates', () => {
  const metadata = createProductSeoMetadata({
    lang: 'zh',
    path: '/pricing',
    pageKey: 'pricing',
  });
  const alternates = metadata.alternates as {
    canonical?: string;
    languages?: Record<string, string>;
  };
  const openGraph = metadata.openGraph as {
    siteName?: string;
    images?: Array<{ url: string }>;
  };

  assert.equal(metadata.title, '价格');
  assert.equal(metadata.description, '选择套餐，开发阶段可先用本地结账跑通流程。');
  assert.equal(alternates.canonical, 'http://localhost:3000/zh/pricing');
  assert.equal(alternates.languages?.en, 'http://localhost:3000/en/pricing');
  assert.equal(openGraph.siteName, 'PloyKit');
  assert.equal(openGraph.images?.[0]?.url, 'http://localhost:3000/brand/og-zh.png');
  assert.equal('themeColor' in metadata, false);
  assert.equal(createProductViewport('zh').themeColor, getProductBrandPresentation('zh').themeColor);
});

test('product brand resolver localizes OpenGraph image and manifest assets', () => {
  const brand = getProductBrandPresentation('en');
  const manifest = getProductWebManifest();

  assert.equal(brand.productName, 'PloyKit');
  assert.equal(brand.openGraphImage, 'http://localhost:3000/brand/og-en.png');
  assert.equal(manifest.name, 'PloyKit');
  assert.equal(manifest.icons?.[0]?.src, '/brand/icon-512.png');
});

test('product brand asset manifest validates dimensions, digest and SVG safety', () => {
  const manifest = createBrandAssetManifest();
  const byKey = new Map(manifest.entries.map((entry) => [entry.key, entry]));
  const icon = byKey.get('manifestIcon');
  const ogZh = byKey.get('openGraphImage.zh');
  const logo = byKey.get('logo.light');

  assert.deepEqual(manifest.diagnostics, []);
  assert.equal(icon?.mimeType, 'image/png');
  assert.equal(icon?.width, 512);
  assert.equal(icon?.height, 512);
  assert.equal(ogZh?.width, 1200);
  assert.equal(ogZh?.height, 630);
  assert.equal(logo?.mimeType, 'image/png');
  assert.equal(logo?.width, 1000);
  assert.equal(logo?.height, 380);
  assert.match(icon?.sha256 ?? '', /^[a-f0-9]{64}$/);
});

test('product structured data exposes localized website identity', () => {
  const structuredData = createProductStructuredData('en');

  assert.equal(structuredData['@type'], 'WebSite');
  assert.equal(structuredData.name, 'PloyKit');
  assert.equal(structuredData.inLanguage, 'en-US');
  assert.equal(structuredData.publisher.name, 'PloyKit');
  assert.match(structuredData.url, /\/en$/);
});

test('host sitemap emits localized static pages with alternates', async () => {
  const entries = await sitemap();
  const zhDocs = entries.find((entry) => entry.url.endsWith('/zh/docs')) as
    | {
        alternates?: {
          languages?: Record<string, string>;
        };
      }
    | undefined;
  const zhSuccess = entries.find((entry) => entry.url.endsWith('/zh/success'));

  assert.ok(zhDocs);
  assert.ok(zhSuccess);
  assert.equal(zhDocs.alternates?.languages?.zh, 'http://localhost:3000/zh/docs');
  assert.equal(zhDocs.alternates?.languages?.en, 'http://localhost:3000/en/docs');
});

test('host sitemap emits localized module routes and aliases with alternates', async () => {
  const entries = await sitemap();
  const zhPublicTool = entries.find((entry) => entry.url.endsWith('/zh/public-tool-smoke')) as
    | {
        alternates?: {
          languages?: Record<string, string>;
        };
      }
    | undefined;
  const zhJsonTool = entries.find((entry) => entry.url.endsWith('/zh/tools/json')) as
    | {
        alternates?: {
          languages?: Record<string, string>;
        };
      }
    | undefined;

  assert.ok(zhPublicTool);
  assert.ok(zhJsonTool);
  assert.equal(
    zhPublicTool.alternates?.languages?.en,
    'http://localhost:3000/en/public-tool-smoke'
  );
  assert.equal(zhJsonTool.alternates?.languages?.zh, 'http://localhost:3000/zh/tools/json');
  assert.equal(zhJsonTool.alternates?.languages?.en, 'http://localhost:3000/en/tools/json');
});

test('host sitemap emits only localized URLs with complete language alternates', async () => {
  const entries = await sitemap();

  for (const entry of entries) {
    const pathname = new URL(entry.url).pathname;
    assert.match(pathname, /^\/(zh|en)(\/|$)/);
    assert.ok(entry.alternates?.languages?.zh);
    assert.ok(entry.alternates?.languages?.en);
  }
});

test('non-site route presentation forces noindex and non-public cache', async () => {
  const auth = await resolvePagePresentation({
    pageId: 'auth.login',
    pathname: '/zh/login',
    lang: 'zh',
  });
  const dashboard = await resolvePagePresentation({
    pageId: 'dashboard.billing',
    pathname: '/zh/dashboard/billing',
    lang: 'zh',
    workspaceId: 'demo-workspace',
  });
  const admin = await resolvePagePresentation({
    pageId: 'admin.overview',
    pathname: '/zh/admin',
    lang: 'zh',
  });
  const dev = await resolvePagePresentation({
    pageId: 'dev.console',
    pathname: '/zh/admin/module-dev-console',
    lang: 'zh',
  });

  for (const presentation of [auth, dashboard, admin, dev]) {
    const robots = presentation.seo.robots as { index?: boolean; follow?: boolean };
    assert.equal(robots.index, false);
    assert.equal(robots.follow, false);
    assert.notEqual(presentation.cache.mode, 'public');
  }
  assert.equal(auth.cache.mode, 'no-store');
});

test('localized module site metadata resolves language-prefixed aliases', async () => {
  const metadata = await siteModuleMetadata('/en/tools/json');
  const alternates = metadata.alternates as {
    canonical?: string;
    languages?: Record<string, string>;
  };
  const openGraph = metadata.openGraph as {
    url?: string;
  };

  assert.equal(metadata.title, 'Public Tool Smoke');
  assert.equal(alternates.canonical, 'http://localhost:3000/en/tools/json');
  assert.equal(alternates.languages?.zh, 'http://localhost:3000/zh/tools/json');
  assert.equal(alternates.languages?.en, 'http://localhost:3000/en/tools/json');
  assert.equal(openGraph.url, 'http://localhost:3000/en/tools/json');
});
