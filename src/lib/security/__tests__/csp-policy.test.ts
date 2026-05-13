/**
 * CSP Policy Builder Tests
 *
 * Covers:
 * - Base policy generation
 * - Plugin egress merging
 * - Nonce application
 * - Header string building
 * - Source validation
 * - Trust levels
 */

import { describe, it, expect } from 'vitest';
import {
  getBasePolicy,
  buildCSPHeader,
  mergePluginEgress,
  applyNonce,
  createCSPPolicy,
  getCSPHeader,
  generateNonce,
} from '../csp-policy.server';

describe('CSP Policy Builder', () => {
  describe('getBasePolicy', () => {
    it('should generate restrictive base policy', () => {
      const policy = getBasePolicy();

      expect(policy.directives['default-src']).toEqual(["'self'"]);
      expect(policy.directives['script-src']).toEqual(["'self'"]);
      expect(policy.directives['style-src']).toEqual(["'self'"]);
      expect(policy.directives['object-src']).toEqual(["'none'"]);
      expect(policy.directives['frame-ancestors']).toEqual(["'none'"]);
    });

    it('should not include nonce by default', () => {
      const policy = getBasePolicy();
      expect(policy.nonce).toBeUndefined();
    });
  });

  describe('buildCSPHeader', () => {
    it('should build valid CSP header string', () => {
      const policy = getBasePolicy();
      const header = buildCSPHeader(policy);

      expect(header).toContain("default-src 'self'");
      expect(header).toContain("script-src 'self'");
      expect(header).toContain("frame-ancestors 'none'");
    });

    it('should skip empty directives', () => {
      const policy = {
        directives: {
          'default-src': ["'self'"],
          'script-src': [],
        },
      };

      const header = buildCSPHeader(policy as any);
      expect(header).toContain("default-src 'self'");
      expect(header).not.toContain('script-src');
    });
  });

  describe('mergePluginEgress', () => {
    it('should add plugin sources to connect-src', () => {
      const policy = getBasePolicy();
      const merged = mergePluginEgress(policy, ['https://api.example.com']);

      expect(merged.directives['connect-src']).toContain('https://api.example.com');
      expect(merged.directives['connect-src']).toContain("'self'");
    });

    it('should ignore invalid sources', () => {
      const policy = getBasePolicy();
      const merged = mergePluginEgress(policy, ['not-a-valid-url', 'https://valid.com']);

      expect(merged.directives['connect-src']).not.toContain('not-a-valid-url');
      expect(merged.directives['connect-src']).toContain('https://valid.com');
    });

    it('should deduplicate sources', () => {
      const policy = getBasePolicy();
      const merged = mergePluginEgress(policy, [
        'https://api.example.com',
        'https://api.example.com',
      ]);

      const connectSrc = merged.directives['connect-src'];
      expect(connectSrc?.filter((s) => s === 'https://api.example.com').length).toBe(1);
    });

    it('should handle empty sources array', () => {
      const policy = getBasePolicy();
      const merged = mergePluginEgress(policy, []);

      expect(merged.directives['connect-src']).toEqual(["'self'"]);
    });
  });

  describe('applyNonce', () => {
    it('should add nonce to script-src and style-src', () => {
      const policy = getBasePolicy();
      const nonce = 'test-nonce-123';
      const applied = applyNonce(policy, nonce);

      expect(applied.nonce).toBe(nonce);
      expect(applied.directives['script-src']).toContain("'nonce-test-nonce-123'");
      expect(applied.directives['style-src']).toContain("'nonce-test-nonce-123'");
    });

    it('should remove unsafe-inline when nonce is applied', () => {
      const policy = {
        directives: {
          'script-src': ["'self'", "'unsafe-inline'"],
          'style-src': ["'self'", "'unsafe-inline'"],
        },
      };

      const applied = applyNonce(policy as any, 'nonce-123');

      expect(applied.directives['script-src']).not.toContain("'unsafe-inline'");
      expect(applied.directives['style-src']).not.toContain("'unsafe-inline'");
    });
  });

  describe('createCSPPolicy', () => {
    it('should create default policy', () => {
      const policy = createCSPPolicy();
      expect(policy.directives['default-src']).toEqual(["'self'"]);
    });

    it('should apply trust level strict', () => {
      const policy = createCSPPolicy({ trustLevel: 'strict' });
      expect(policy.directives['script-src']).toEqual(["'self'"]);
      expect(policy.directives['style-src']).toEqual(["'self'"]);
    });

    it('should apply trust level trusted', () => {
      const policy = createCSPPolicy({ trustLevel: 'trusted' });
      expect(policy.directives['script-src']).toContain("'unsafe-inline'");
      expect(policy.directives['style-src']).toContain("'unsafe-inline'");
    });

    it('should merge plugin sources', () => {
      const policy = createCSPPolicy({
        pluginSources: ['https://api.example.com'],
      });
      expect(policy.directives['connect-src']).toContain('https://api.example.com');
    });

    it('should generate and apply nonce', () => {
      const policy = createCSPPolicy({ useNonce: true });
      expect(policy.nonce).toBeDefined();
      expect(policy.nonce!.length).toBeGreaterThan(0);
      expect(policy.directives['script-src']?.some((s) => s.startsWith("'nonce-"))).toBe(true);
    });
  });

  describe('getCSPHeader', () => {
    it('should return header string', () => {
      const header = getCSPHeader();
      expect(typeof header).toBe('string');
      expect(header.length).toBeGreaterThan(0);
    });
  });

  describe('generateNonce', () => {
    it('should generate unique nonces', () => {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();

      expect(nonce1).not.toBe(nonce2);
      expect(nonce1.length).toBeGreaterThan(0);
    });
  });
});
