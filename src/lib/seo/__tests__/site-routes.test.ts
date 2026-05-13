import { describe, expect, it, vi } from 'vitest';
import { listLocalizedPublicSiteSitemapEntries, listPublicSiteRoutes } from '../site-routes';

vi.mock('@/lib/_core/env', () => ({
  env: {
    NEXT_PUBLIC_APP_URL: 'https://example.test',
  },
}));

describe('site SEO routes', () => {
  it('lists host-owned public site routes without auth/dashboard pages', () => {
    expect(listPublicSiteRoutes().map((route) => route.path)).toEqual(
      expect.arrayContaining(['/', '/about', '/contact', '/pricing', '/privacy', '/terms'])
    );
    expect(listPublicSiteRoutes().map((route) => route.path)).not.toContain('/success');
  });

  it('generates localized sitemap entries with hreflang alternates', () => {
    const entries = listLocalizedPublicSiteSitemapEntries();

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://example.test/zh',
          priority: 1,
          alternates: {
            languages: {
              en: 'https://example.test/en',
              zh: 'https://example.test/zh',
            },
          },
        }),
        expect.objectContaining({
          url: 'https://example.test/en/pricing',
        }),
      ])
    );
  });
});
