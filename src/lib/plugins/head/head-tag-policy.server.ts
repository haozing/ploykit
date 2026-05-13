/**
 * Head Tag Policy
 *
 * Validates and sanitizes plugin-injected head tags before rendering.
 *
 * Rules:
 * - meta: allowed (name, property, content, charset, http-equiv)
 * - link: allowed (rel, href, media, type, sizes) - href must be https or relative
 * - title: allowed (content only, no attributes)
 * - script: default BLOCKED inline; external src only from allowlist
 * - style: default BLOCKED inline; trusted plugins only with nonce
 *
 * External script sources must be declared in the plugin contract egress list.
 */

import { logger } from '@/lib/_core/logger';
import type { HeadTag } from '@/lib/bus/hook-helpers.server';
import { pluginRuntimeRegistry } from '@/lib/plugin-runtime/registry';

export type HeadTagTrustLevel = 'untrusted' | 'trusted' | 'system';

export interface HeadTagPolicyOptions {
  /** Plugin trust level */
  trustLevel?: HeadTagTrustLevel;
  /** CSP nonce for inline content (if trusted) */
  nonce?: string;
  /** Allowed external script/link sources */
  allowedSources?: readonly string[];
  /** Whether to log violations instead of blocking */
  auditOnly?: boolean;
}

interface ValidationResult {
  allowed: boolean;
  reason?: string;
  sanitized?: HeadTag;
}

/** Dangerous attribute patterns to strip */
const DANGEROUS_ATTR_PATTERNS = [
  /^on\w+/i, // event handlers: onclick, onload, etc.
  /javascript:/i,
  /data:text\/html/i,
];

/** Allowed meta attributes */
const ALLOWED_META_ATTRS = new Set([
  'name',
  'property',
  'content',
  'charset',
  'http-equiv',
  'media',
]);

/** Allowed link attributes */
const ALLOWED_LINK_ATTRS = new Set([
  'rel',
  'href',
  'media',
  'type',
  'sizes',
  'crossorigin',
  'integrity',
]);

/** Allowed script attributes (for external scripts) */
const ALLOWED_SCRIPT_ATTRS = new Set([
  'src',
  'async',
  'defer',
  'crossorigin',
  'integrity',
  'type',
  'nomodule',
]);

const ALLOWED_INLINE_SCRIPT_ATTRS = new Set(['type', 'id', 'nonce']);
const ALLOWED_STYLE_ATTRS = new Set(['id', 'media', 'nonce']);

/** Allowed title attributes (none really, but we allow lang) */
const ALLOWED_TITLE_ATTRS = new Set(['lang', 'dir']);

/**
 * Check if a URL is a safe source
 */
function isSafeUrl(url: string): boolean {
  if (!url || url.trim() === '') return false;

  // Allow relative URLs
  if (url.startsWith('/')) return true;
  if (url.startsWith('./') || url.startsWith('../')) return true;

  try {
    const parsed = new URL(url);
    // Only allow HTTPS in production, HTTP allowed in development
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol === 'http:') {
      // In development, localhost is allowed
      const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      return isLocalhost;
    }
    return false;
  } catch {
    return false;
  }
}

function toAbsoluteUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function toAllowedOrigin(value: string): URL | null {
  const parsed = toAbsoluteUrl(value);

  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return null;
  }

  return new URL(parsed.origin);
}

function isRelativeUrl(value: string): boolean {
  return value.startsWith('/') || value.startsWith('./') || value.startsWith('../');
}

function isAllowedExternalSource(url: string, allowedSources: readonly string[]): boolean {
  if (isRelativeUrl(url)) {
    return true;
  }

  const parsed = toAbsoluteUrl(url);
  if (!parsed) {
    return false;
  }

  return allowedSources.some((source) => {
    const allowed = toAllowedOrigin(source);
    return (
      !!allowed &&
      allowed.protocol === parsed.protocol &&
      allowed.hostname === parsed.hostname &&
      allowed.port === parsed.port
    );
  });
}

/**
 * Check if attribute value contains dangerous content
 */
function hasDangerousValue(value: string): boolean {
  return DANGEROUS_ATTR_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Sanitize attributes - remove dangerous ones and ones not in allowlist
 */
function sanitizeAttrs(
  attrs: Record<string, string> | undefined,
  allowedSet: Set<string>
): Record<string, string> | undefined {
  if (!attrs) return undefined;

  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(attrs)) {
    // Skip event handlers and dangerous values
    if (hasDangerousValue(value)) {
      logger.warn({ key, valuePreview: value.slice(0, 50) }, 'Stripped dangerous attribute value');
      continue;
    }

    // Skip unknown attributes
    if (!allowedSet.has(key)) {
      continue;
    }

    // Validate href/src URLs
    if ((key === 'href' || key === 'src') && !isSafeUrl(value)) {
      logger.warn({ key, value: value.slice(0, 100) }, 'Stripped unsafe URL from head tag');
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}

/**
 * Validate a single head tag against the policy
 */
export function validateHeadTag(
  tag: HeadTag,
  options: HeadTagPolicyOptions = {}
): ValidationResult {
  const { trustLevel = 'untrusted', nonce, allowedSources = [], auditOnly = false } = options;

  switch (tag.tag) {
    case 'meta': {
      const sanitized = sanitizeAttrs(tag.attrs, ALLOWED_META_ATTRS);
      if (!sanitized || Object.keys(sanitized).length === 0) {
        return { allowed: false, reason: 'meta tag has no valid attributes after sanitization' };
      }
      return {
        allowed: true,
        sanitized: { ...tag, attrs: sanitized },
      };
    }

    case 'link': {
      const sanitized = sanitizeAttrs(tag.attrs, ALLOWED_LINK_ATTRS);
      if (!sanitized || !sanitized.href) {
        return { allowed: false, reason: 'link tag missing safe href' };
      }
      return {
        allowed: true,
        sanitized: { ...tag, attrs: sanitized },
      };
    }

    case 'title': {
      // Title is generally safe - just check content isn't script
      if (tag.content && hasDangerousValue(tag.content)) {
        return { allowed: false, reason: 'title content contains dangerous patterns' };
      }
      return {
        allowed: true,
        sanitized: { ...tag, attrs: sanitizeAttrs(tag.attrs, ALLOWED_TITLE_ATTRS) },
      };
    }

    case 'script': {
      // External script with src
      if (tag.attrs?.src) {
        if (trustLevel === 'untrusted') {
          return {
            allowed: auditOnly,
            reason: 'external script blocked for untrusted plugins',
          };
        }

        const sanitized = sanitizeAttrs(tag.attrs, ALLOWED_SCRIPT_ATTRS);
        if (!sanitized?.src) {
          return { allowed: false, reason: 'script src is not a safe URL' };
        }

        if (!isAllowedExternalSource(sanitized.src, allowedSources)) {
          return {
            allowed: auditOnly,
            reason: 'script src is not declared in plugin egress',
          };
        }

        return {
          allowed: true,
          sanitized: { ...tag, attrs: sanitized },
        };
      }

      // Inline script - blocked for untrusted plugins
      if (tag.content) {
        if (trustLevel === 'untrusted') {
          return {
            allowed: auditOnly,
            reason: 'inline script blocked for untrusted plugins',
          };
        }

        // Trusted plugins can have inline scripts with nonce
        if (!nonce) {
          return {
            allowed: auditOnly,
            reason: 'inline script requires nonce for trusted plugins',
          };
        }

        // Apply nonce to the tag
        return {
          allowed: true,
          sanitized: {
            ...tag,
            attrs: { ...(sanitizeAttrs(tag.attrs, ALLOWED_INLINE_SCRIPT_ATTRS) ?? {}), nonce },
          },
        };
      }

      return { allowed: false, reason: 'script tag has no src or content' };
    }

    case 'style': {
      // Inline style - blocked for untrusted plugins
      if (trustLevel === 'untrusted') {
        return {
          allowed: auditOnly,
          reason: 'inline style blocked for untrusted plugins',
        };
      }

      // Trusted plugins can have inline styles with nonce
      if (!nonce) {
        return {
          allowed: auditOnly,
          reason: 'inline style requires nonce for trusted plugins',
        };
      }

      return {
        allowed: true,
        sanitized: {
          ...tag,
          attrs: { ...(sanitizeAttrs(tag.attrs, ALLOWED_STYLE_ATTRS) ?? {}), nonce },
        },
      };
    }

    default:
      return { allowed: false, reason: `unknown tag type: ${tag.tag}` };
  }
}

/**
 * Sanitize an array of head tags
 *
 * @returns Array of allowed (and sanitized) tags, plus array of blocked tags with reasons
 */
export function sanitizeHeadTags(
  tags: HeadTag[],
  options: HeadTagPolicyOptions = {}
): {
  allowed: HeadTag[];
  blocked: Array<{ tag: HeadTag; reason: string }>;
} {
  const allowed: HeadTag[] = [];
  const blocked: Array<{ tag: HeadTag; reason: string }> = [];

  for (const tag of tags) {
    const result = validateHeadTag(tag, options);

    if (result.allowed) {
      allowed.push(result.sanitized || tag);
    } else {
      blocked.push({ tag, reason: result.reason || 'unknown violation' });
      logger.warn({ tagType: tag.tag, reason: result.reason }, 'Head tag blocked by policy');
    }
  }

  if (blocked.length > 0) {
    logger.info({ allowed: allowed.length, blocked: blocked.length }, 'Head tag policy applied');
  }

  return { allowed, blocked };
}

/**
 * Get trust level for a plugin.
 */
export async function getPluginTrustLevel(pluginId: string): Promise<HeadTagTrustLevel> {
  try {
    const contract =
      pluginRuntimeRegistry.get(pluginId) ?? (await pluginRuntimeRegistry.getOrLoad(pluginId));

    return contract.trustLevel;
  } catch (error) {
    logger.warn({ pluginId, error }, 'Falling back to untrusted plugin head tag policy');
    return 'untrusted';
  }
}

export async function getPluginHeadTagAllowedSources(pluginId: string): Promise<readonly string[]> {
  try {
    const contract =
      pluginRuntimeRegistry.get(pluginId) ?? (await pluginRuntimeRegistry.getOrLoad(pluginId));

    return contract.egress;
  } catch (error) {
    logger.warn({ pluginId, error }, 'Falling back to empty plugin head tag allowed sources');
    return [];
  }
}
