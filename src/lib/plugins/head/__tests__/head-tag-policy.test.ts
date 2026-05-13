/**
 * Head Tag Policy Tests
 *
 * Covers:
 * - meta tag validation and sanitization
 * - link tag validation and URL safety
 * - title tag validation
 * - script tag blocking/allowing based on trust level
 * - style tag blocking/allowing based on trust level
 * - dangerous attribute filtering
 * - CSP nonce application
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getPluginHeadTagAllowedSources,
  getPluginTrustLevel,
  sanitizeHeadTags,
  validateHeadTag,
} from '../head-tag-policy.server';
import type { HeadTag } from '@/lib/bus/hook-helpers.server';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getOrLoad: vi.fn(),
}));

vi.mock('@/lib/plugin-runtime/registry', () => ({
  pluginRuntimeRegistry: mocks,
}));

describe('Head Tag Policy', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.getOrLoad.mockReset();
  });
  describe('validateHeadTag - meta', () => {
    it('should allow valid meta tag', () => {
      const tag: HeadTag = { tag: 'meta', attrs: { name: 'description', content: 'Test' } };
      const result = validateHeadTag(tag);
      expect(result.allowed).toBe(true);
      expect(result.sanitized?.attrs?.name).toBe('description');
    });

    it('should strip unknown meta attributes', () => {
      const tag: HeadTag = {
        tag: 'meta',
        attrs: { name: 'description', content: 'Test', 'data-evil': 'x' },
      };
      const result = validateHeadTag(tag);
      expect(result.allowed).toBe(true);
      expect(result.sanitized?.attrs?.['data-evil']).toBeUndefined();
    });

    it('should block meta with event handler attribute value', () => {
      const tag: HeadTag = {
        tag: 'meta',
        attrs: { name: 'description', content: 'javascript:alert(1)' },
      };
      const result = validateHeadTag(tag);
      expect(result.allowed).toBe(true);
      expect(result.sanitized?.attrs?.content).toBeUndefined();
    });

    it('should block meta with no valid attributes after sanitization', () => {
      const tag: HeadTag = { tag: 'meta', attrs: { 'data-x': 'y' } };
      const result = validateHeadTag(tag);
      expect(result.allowed).toBe(false);
    });
  });

  describe('validateHeadTag - link', () => {
    it('should allow valid external link with https', () => {
      const tag: HeadTag = {
        tag: 'link',
        attrs: { rel: 'stylesheet', href: 'https://cdn.example.com/style.css' },
      };
      const result = validateHeadTag(tag);
      expect(result.allowed).toBe(true);
    });

    it('should allow relative link href', () => {
      const tag: HeadTag = { tag: 'link', attrs: { rel: 'icon', href: '/favicon.ico' } };
      const result = validateHeadTag(tag);
      expect(result.allowed).toBe(true);
    });

    it('should block link with javascript href', () => {
      const tag: HeadTag = {
        tag: 'link',
        attrs: { rel: 'stylesheet', href: 'javascript:alert(1)' },
      };
      const result = validateHeadTag(tag);
      expect(result.allowed).toBe(false);
    });

    it('should block link without href', () => {
      const tag: HeadTag = { tag: 'link', attrs: { rel: 'stylesheet' } };
      const result = validateHeadTag(tag);
      expect(result.allowed).toBe(false);
    });

    it('should strip dangerous link attributes', () => {
      const tag: HeadTag = {
        tag: 'link',
        attrs: { rel: 'stylesheet', href: '/style.css', onclick: 'evil()' },
      };
      const result = validateHeadTag(tag);
      expect(result.allowed).toBe(true);
      expect(result.sanitized?.attrs?.onclick).toBeUndefined();
    });
  });

  describe('validateHeadTag - title', () => {
    it('should allow plain title', () => {
      const tag: HeadTag = { tag: 'title', content: 'My Page' };
      const result = validateHeadTag(tag);
      expect(result.allowed).toBe(true);
    });

    it('should block title with dangerous content', () => {
      const tag: HeadTag = { tag: 'title', content: 'javascript:alert(1)' };
      const result = validateHeadTag(tag);
      expect(result.allowed).toBe(false);
    });
  });

  describe('validateHeadTag - script', () => {
    it('should block inline script for untrusted plugins', () => {
      const tag: HeadTag = { tag: 'script', content: 'console.log("hello")' };
      const result = validateHeadTag(tag, { trustLevel: 'untrusted' });
      expect(result.allowed).toBe(false);
    });

    it('should allow inline script for trusted plugins with nonce', () => {
      const tag: HeadTag = { tag: 'script', content: 'console.log("hello")' };
      const result = validateHeadTag(tag, { trustLevel: 'trusted', nonce: 'abc123' });
      expect(result.allowed).toBe(true);
      expect(result.sanitized?.attrs?.nonce).toBe('abc123');
    });

    it('should block inline script for trusted plugins without nonce', () => {
      const tag: HeadTag = { tag: 'script', content: 'console.log("hello")' };
      const result = validateHeadTag(tag, { trustLevel: 'trusted' });
      expect(result.allowed).toBe(false);
    });

    it('should block external script for untrusted plugins', () => {
      const tag: HeadTag = { tag: 'script', attrs: { src: 'https://cdn.example.com/script.js' } };
      const result = validateHeadTag(tag);
      expect(result.allowed).toBe(false);
    });

    it('should allow external script for trusted plugins when src is declared in egress', () => {
      const tag: HeadTag = { tag: 'script', attrs: { src: 'https://cdn.example.com/script.js' } };
      const result = validateHeadTag(tag, {
        trustLevel: 'trusted',
        allowedSources: ['https://cdn.example.com'],
      });
      expect(result.allowed).toBe(true);
    });

    it('should block external script for trusted plugins when src is missing from egress', () => {
      const tag: HeadTag = { tag: 'script', attrs: { src: 'https://cdn.example.com/script.js' } };
      const result = validateHeadTag(tag, {
        trustLevel: 'trusted',
        allowedSources: ['https://assets.example.com'],
      });
      expect(result.allowed).toBe(false);
    });

    it('should block external script with unsafe src', () => {
      const tag: HeadTag = { tag: 'script', attrs: { src: 'javascript:alert(1)' } };
      const result = validateHeadTag(tag, {
        trustLevel: 'trusted',
        allowedSources: ['https://cdn.example.com'],
      });
      expect(result.allowed).toBe(false);
    });

    it('should allow audit-only mode to pass blocked inline script', () => {
      const tag: HeadTag = { tag: 'script', content: 'console.log("hello")' };
      const result = validateHeadTag(tag, { trustLevel: 'untrusted', auditOnly: true });
      expect(result.allowed).toBe(true);
    });
  });

  describe('validateHeadTag - style', () => {
    it('should block inline style for untrusted plugins', () => {
      const tag: HeadTag = { tag: 'style', content: 'body { color: red; }' };
      const result = validateHeadTag(tag, { trustLevel: 'untrusted' });
      expect(result.allowed).toBe(false);
    });

    it('should allow inline style for trusted plugins with nonce', () => {
      const tag: HeadTag = { tag: 'style', content: 'body { color: red; }' };
      const result = validateHeadTag(tag, { trustLevel: 'trusted', nonce: 'abc123' });
      expect(result.allowed).toBe(true);
      expect(result.sanitized?.attrs?.nonce).toBe('abc123');
    });

    it('should block inline style for trusted plugins without nonce', () => {
      const tag: HeadTag = { tag: 'style', content: 'body { color: red; }' };
      const result = validateHeadTag(tag, { trustLevel: 'trusted' });
      expect(result.allowed).toBe(false);
    });
  });

  describe('validateHeadTag - unknown tag', () => {
    it('should block unknown tag types', () => {
      const tag = { tag: 'iframe' as any, attrs: { src: 'https://example.com' } };
      const result = validateHeadTag(tag);
      expect(result.allowed).toBe(false);
    });
  });

  describe('sanitizeHeadTags', () => {
    it('should separate allowed and blocked tags', () => {
      const tags: HeadTag[] = [
        { tag: 'meta', attrs: { name: 'description', content: 'Test' } },
        { tag: 'script', content: 'alert(1)' },
        { tag: 'link', attrs: { rel: 'icon', href: '/favicon.ico' } },
      ];

      const result = sanitizeHeadTags(tags, { trustLevel: 'untrusted' });
      expect(result.allowed.length).toBe(2);
      expect(result.blocked.length).toBe(1);
      expect(result.blocked[0].tag.tag).toBe('script');
    });

    it('should return empty arrays for empty input', () => {
      const result = sanitizeHeadTags([]);
      expect(result.allowed).toEqual([]);
      expect(result.blocked).toEqual([]);
    });

    it('should allow all safe tags with trusted level', () => {
      const tags: HeadTag[] = [
        { tag: 'meta', attrs: { charset: 'utf-8' } },
        { tag: 'link', attrs: { rel: 'stylesheet', href: '/style.css' } },
        { tag: 'title', content: 'Page' },
      ];

      const result = sanitizeHeadTags(tags);
      expect(result.allowed.length).toBe(3);
      expect(result.blocked.length).toBe(0);
    });
  });

  describe('getPluginTrustLevel', () => {
    it('reads trust level from the runtime contract registry', async () => {
      mocks.get.mockReturnValue({ trustLevel: 'trusted' });

      await expect(getPluginTrustLevel('any-plugin')).resolves.toBe('trusted');
    });

    it('falls back to untrusted when contract lookup fails', async () => {
      mocks.get.mockReturnValue(null);
      mocks.getOrLoad.mockRejectedValue(new Error('missing plugin'));

      await expect(getPluginTrustLevel('missing-plugin')).resolves.toBe('untrusted');
    });
  });

  describe('getPluginHeadTagAllowedSources', () => {
    it('reads allowed head tag sources from the runtime contract egress list', async () => {
      mocks.get.mockReturnValue({ trustLevel: 'trusted', egress: ['https://cdn.example.com'] });

      await expect(getPluginHeadTagAllowedSources('any-plugin')).resolves.toEqual([
        'https://cdn.example.com',
      ]);
    });

    it('falls back to an empty source list when contract lookup fails', async () => {
      mocks.get.mockReturnValue(null);
      mocks.getOrLoad.mockRejectedValue(new Error('missing plugin'));

      await expect(getPluginHeadTagAllowedSources('missing-plugin')).resolves.toEqual([]);
    });
  });
});
