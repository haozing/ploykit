import assert from 'node:assert/strict';
import test from 'node:test';
import { getHostRuntimeHealth } from '../apps/host-next/lib/create-host';
import { resolvePublicNavigation } from '../apps/host-next/lib/site-navigation';
import { dashboardHref, modulePathFromSegments, requestUrl } from '../apps/host-next/lib/paths';
import sitemap from '../apps/host-next/app/sitemap';

test('P10 path helpers map Next catch-all segments to module routes', () => {
  assert.equal(modulePathFromSegments(undefined), '/');
  assert.equal(modulePathFromSegments([]), '/');
  assert.equal(modulePathFromSegments(['hello']), '/hello');
  assert.equal(dashboardHref('/'), '/dashboard');
  assert.equal(dashboardHref('/hello'), '/dashboard/hello');
  assert.equal(dashboardHref('hello'), '/dashboard/hello');
  assert.equal(
    requestUrl(
      '/zh/dashboard',
      new Request('http://localhost:3000/api/auth/login', {
        headers: { host: '127.0.0.1:3000' },
      })
    ).toString(),
    'http://127.0.0.1:3000/zh/dashboard'
  );
});

test('R3 host sitemap includes public product pages and module aliases', async () => {
  const entries = await sitemap();
  const urls = entries.map((entry) => entry.url);

  assert.ok(urls.some((url) => url.endsWith('/zh/pricing')));
  assert.ok(urls.some((url) => url.endsWith('/zh/contact')));
  assert.ok(urls.some((url) => url.endsWith('/zh/docs')));
  assert.ok(urls.some((url) => url.endsWith('/en/pricing')));
  assert.ok(urls.some((url) => url.endsWith('/public-tools')));
  assert.ok(urls.some((url) => url.endsWith('/tools/json')));
  assert.ok(urls.some((url) => url.endsWith('/cms-demo')));
  assert.ok(urls.some((url) => url.endsWith('/blog')));
  assert.ok(urls.some((url) => url.endsWith('/shop-demo')));
  assert.ok(urls.some((url) => url.endsWith('/shop')));
});

test('R3 public navigation merges module site header and footer contributions', async () => {
  const navigation = await resolvePublicNavigation('zh');
  const englishNavigation = await resolvePublicNavigation('en');

  assert.ok(
    navigation.headerItems.some((item) => item.href === '/dashboard' && item.label === '工作台')
  );
  assert.ok(
    navigation.footerItems.some((item) => item.href === '/contact' && item.label === '支持')
  );
  assert.ok(
    englishNavigation.headerItems.some(
      (item) => item.href === '/dashboard' && item.label === 'Dashboard'
    )
  );
  assert.ok(
    englishNavigation.footerItems.some(
      (item) => item.href === '/contact' && item.label === 'Support'
    )
  );
});

test('K1 host runtime health reports the current composition root', async () => {
  const health = await getHostRuntimeHealth();

  assert.equal(health.auth.mode, 'runtime-store-signed-cookie');
  assert.equal(health.productScope.mode, 'runtime-store');
  assert.equal(health.catalog.mode, 'runtime-store');
  assert.equal(health.worker.mode, 'runtime-store-loop');
  assert.equal(health.security.routeCatalog, 'configured');
});
