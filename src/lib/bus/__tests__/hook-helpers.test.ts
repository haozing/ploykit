import { describe, expect, it, vi } from 'vitest';
import type { HeadTag } from '../hook-helpers.server';

const executeMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/unified-system', () => ({
  unifiedHookSystem: {
    executeAndMerge: vi.fn(),
    executeSequential: vi.fn(),
    getPluginHooks: vi.fn(() => []),
    register: vi.fn(),
    unregister: vi.fn(),
    execute: executeMock,
  },
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'x-request-id': 'test-request' })),
}));

vi.mock('@/lib/db/client.server', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ pluginId: 'head-plugin' }]),
      }),
    }),
  },
}));

vi.mock('@/lib/plugins/head/head-tag-policy.server', () => ({
  getPluginTrustLevel: vi.fn(async () => 'trusted'),
  getPluginHeadTagAllowedSources: vi.fn(async () => ['https://cdn.example.test']),
  sanitizeHeadTags: vi.fn((tags: HeadTag[]) => ({ allowed: tags, blocked: [] })),
}));

vi.mock('@/lib/plugin-runtime/scope', () => ({
  listEnabledRuntimePluginIds: vi.fn(async () => ['head-plugin']),
}));

describe('hook helpers', () => {
  it('deduplicates plugin head tags after sorting by priority', async () => {
    executeMock.mockResolvedValue([
      {
        success: true,
        pluginId: 'head-plugin',
        data: [
          { tag: 'meta', attrs: { name: 'description', content: 'first' }, priority: 10 },
          { tag: 'meta', attrs: { name: 'description', content: 'second' }, priority: 20 },
          { tag: 'link', attrs: { rel: 'canonical', href: '/json' }, priority: 10 },
          { tag: 'link', attrs: { rel: 'canonical', href: '/json' }, priority: 30 },
        ],
      },
    ]);

    const { collectPluginHeadTags } = await import('../hook-helpers.server');

    await expect(
      collectPluginHeadTags({ pathname: '/json', url: 'https://test.local/json' })
    ).resolves.toEqual([
      { tag: 'meta', attrs: { name: 'description', content: 'first' }, priority: 10 },
      { tag: 'link', attrs: { rel: 'canonical', href: '/json' }, priority: 10 },
    ]);
  });

  it('filters plugin sitemap hook entries through host SEO policy', async () => {
    executeMock.mockResolvedValue([
      {
        success: true,
        pluginId: 'head-plugin',
        data: [
          { url: 'http://localhost:3000/zh/tools/json-format', priority: 0.7 },
          { url: 'https://external.test/steal', priority: 0.7 },
          { url: 'http://localhost:3000/admin/hidden', priority: 0.7 },
          { url: 'http://localhost:3000/zh/tools/json-format?debug=1', priority: 0.7 },
          { url: 'http://localhost:3000/zh/tools/bad-priority', priority: 2 },
        ],
      },
    ]);

    const { triggerSitemapHook } = await import('../hook-helpers.server');

    await expect(triggerSitemapHook({ baseUrl: 'http://localhost:3000' })).resolves.toEqual([
      { url: 'http://localhost:3000/zh/tools/json-format', priority: 0.7 },
      { url: 'http://localhost:3000/zh/tools/bad-priority', priority: undefined },
    ]);
  });
});
