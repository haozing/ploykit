import { describe, expect, it, vi } from 'vitest';
import { createSitemapChunks, normalizeSitemapEntry } from '../sitemap-policy';

vi.mock('@/lib/_core/env', () => ({
  env: {
    NEXT_PUBLIC_APP_URL: 'https://example.test',
  },
}));

describe('sitemap policy', () => {
  it('accepts same-origin public URLs and sanitizes optional fields', () => {
    expect(
      normalizeSitemapEntry(
        {
          url: 'https://example.test/zh/tools/json-format',
          priority: 0.7,
          changeFrequency: 'weekly',
          alternates: {
            languages: {
              en: 'https://example.test/en/tools/json-format',
              zh: 'https://example.test/zh/tools/json-format',
            },
          },
        },
        { source: 'test' }
      )
    ).toMatchObject({
      url: 'https://example.test/zh/tools/json-format',
      priority: 0.7,
      changeFrequency: 'weekly',
      alternates: {
        languages: {
          en: 'https://example.test/en/tools/json-format',
          zh: 'https://example.test/zh/tools/json-format',
        },
      },
    });
  });

  it('rejects cross-origin, query, and private URLs', () => {
    expect(
      normalizeSitemapEntry({ url: 'https://evil.test/zh/tools/json-format' }, { source: 'test' })
    ).toBeNull();
    expect(
      normalizeSitemapEntry(
        { url: 'https://example.test/zh/tools/json-format?debug=1' },
        { source: 'test' }
      )
    ).toBeNull();
    expect(
      normalizeSitemapEntry({ url: 'https://example.test/zh/admin/users' }, { source: 'test' })
    ).toBeNull();
  });

  it('splits sitemap chunks with a non-empty first chunk', () => {
    expect(createSitemapChunks(0)).toEqual([{ id: 0, start: 0, end: 0 }]);
    expect(createSitemapChunks(45_001)).toEqual([
      { id: 0, start: 0, end: 45_000 },
      { id: 1, start: 45_000, end: 45_001 },
    ]);
  });
});
