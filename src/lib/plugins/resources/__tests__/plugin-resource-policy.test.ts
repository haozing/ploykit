/**
 * Plugin Resource Policy Tests
 *
 * Covers:
 * - Resource path validation (relative, no traversal, allowed dirs, extensions)
 * - Resource file validation (path, size, JSON, namespace)
 * - Plugin resources batch validation (total size)
 */

import { describe, it, expect } from 'vitest';
import {
  validateDeclaredPluginResources,
  validateResourcePath,
  validateResourceFile,
  validatePluginResources,
} from '../plugin-resource-policy.server';

describe('Plugin Resource Policy', () => {
  describe('validateResourcePath', () => {
    it('should allow valid locales path', () => {
      const result = validateResourcePath('locales/en.json', 'my-plugin');
      expect(result.valid).toBe(true);
    });

    it('should allow valid resources path', () => {
      const result = validateResourcePath('resources/config.json', 'my-plugin');
      expect(result.valid).toBe(true);
    });

    it('should reject absolute path', () => {
      const result = validateResourcePath('/locales/en.json', 'my-plugin');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('relative');
    });

    it('should reject path traversal', () => {
      const result = validateResourcePath('locales/../../../etc/passwd', 'my-plugin');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('traversal');
    });

    it('should reject path outside locales/resources', () => {
      const result = validateResourcePath('assets/image.png', 'my-plugin');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('locales/ or resources/');
    });

    it('should reject non-JSON extension', () => {
      const result = validateResourcePath('locales/en.yaml', 'my-plugin');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('.json');
    });
  });

  describe('validateDeclaredPluginResources', () => {
    it('should allow contract-declared locale and resource files', () => {
      const result = validateDeclaredPluginResources('my-plugin', [
        'locales/en.json',
        'resources/config.json',
      ]);

      expect(result.valid).toBe(true);
      expect(result.resources).toEqual(['locales/en.json', 'resources/config.json']);
    });

    it('should reject duplicate and invalid declarations', () => {
      const result = validateDeclaredPluginResources('my-plugin', [
        'locales/en.json',
        'locales/en.json',
        '../secret.json',
        'assets/logo.png',
      ]);

      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('Duplicate'))).toBe(true);
      expect(result.errors.some((error) => error.includes('traversal'))).toBe(true);
      expect(result.errors.some((error) => error.includes('locales/ or resources/'))).toBe(true);
    });

    it('should enforce declared resource count limits', () => {
      const resources = Array.from({ length: 3 }, (_, index) => `resources/${index}.json`);
      const result = validateDeclaredPluginResources('my-plugin', resources, {
        maxDeclaredResources: 2,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('too many resources'))).toBe(true);
    });
  });

  describe('validateResourceFile', () => {
    it('should allow valid locale file', () => {
      const result = validateResourceFile(
        'locales/en.json',
        JSON.stringify({ hello: 'world' }),
        'my-plugin'
      );
      expect(result.valid).toBe(true);
    });

    it('should allow valid resource file', () => {
      const result = validateResourceFile(
        'resources/config.json',
        JSON.stringify({ setting: true }),
        'my-plugin'
      );
      expect(result.valid).toBe(true);
    });

    it('should reject file exceeding max size', () => {
      const hugeContent = 'x'.repeat(200 * 1024); // 200KB > default 100KB
      const result = validateResourceFile('locales/en.json', hugeContent, 'my-plugin');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('exceeds max size');
    });

    it('should reject invalid JSON', () => {
      const result = validateResourceFile('locales/en.json', '{ invalid json', 'my-plugin');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not valid JSON');
    });

    it('should reject reserved namespace', () => {
      const result = validateResourceFile(
        'locales/common/messages.json',
        JSON.stringify({ key: 'value' }),
        'my-plugin'
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('reserved');
    });

    it('should reject locale file with array content', () => {
      const result = validateResourceFile(
        'locales/en.json',
        JSON.stringify(['item1', 'item2']),
        'my-plugin'
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('JSON object');
    });

    it('should accept custom size limit', () => {
      // Content must be valid JSON
      const content = JSON.stringify({ data: 'x'.repeat(150 * 1024) });
      const result = validateResourceFile('locales/en.json', content, 'my-plugin', {
        maxFileSize: 200 * 1024,
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('validatePluginResources', () => {
    it('should pass for valid resources', () => {
      const resources = [
        { path: 'locales/en.json', content: JSON.stringify({ hello: 'world' }) },
        { path: 'locales/zh.json', content: JSON.stringify({ hello: '世界' }) },
      ];

      const result = validatePluginResources('my-plugin', resources);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should fail if any resource is invalid', () => {
      const resources = [
        { path: 'locales/en.json', content: JSON.stringify({ hello: 'world' }) },
        { path: 'locales/common/messages.json', content: JSON.stringify({ key: 'value' }) }, // reserved namespace
      ];

      const result = validatePluginResources('my-plugin', resources);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should fail if total size exceeds limit', () => {
      const resources = [
        { path: 'resources/a.json', content: JSON.stringify({ data: 'x'.repeat(600 * 1024) }) },
        { path: 'resources/b.json', content: JSON.stringify({ data: 'y'.repeat(600 * 1024) }) },
      ];

      const result = validatePluginResources('my-plugin', resources);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Total resource size'))).toBe(true);
    });

    it('should collect all errors', () => {
      const resources = [
        { path: 'locales/en.json', content: '{ bad' },
        { path: 'locales/common/messages.json', content: JSON.stringify({ key: 'value' }) },
        { path: 'assets/image.png', content: 'binary' },
      ];

      const result = validatePluginResources('my-plugin', resources);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });
});
