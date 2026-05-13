/**
 * Plugin Resource Policy
 *
 * Governs plugin i18n/resource files:
 * - plugin.ts runtime contract must declare resource files
 * - Files must be within plugin directory
 * - Size limits per file and total
 * - JSON schema validation for i18n files
 * - Namespace must not overwrite platform reserved keys
 * - Cache strategy for production
 */

import { logger } from '@/lib/_core/logger';

export interface ResourcePolicyOptions {
  /** Max size per resource file (bytes) */
  maxFileSize?: number;
  /** Max total size of all resources per plugin (bytes) */
  maxTotalSize?: number;
  /** Allowed file extensions */
  allowedExtensions?: string[];
  /** Maximum number of contract-declared resource files */
  maxDeclaredResources?: number;
}

const DEFAULT_OPTIONS: Required<ResourcePolicyOptions> = {
  maxFileSize: 100 * 1024, // 100KB per file
  maxTotalSize: 1024 * 1024, // 1MB total per plugin
  allowedExtensions: ['.json'],
  maxDeclaredResources: 64,
};

/** Reserved i18n namespaces that plugins cannot override */
const RESERVED_NAMESPACES = new Set(['common', 'platform', 'auth', 'billing', 'admin', 'error']);

/**
 * Validate a resource file path
 */
export function validateResourcePath(
  filePath: string,
  _pluginId: string
): { valid: boolean; reason?: string } {
  // Must be relative path (no leading slash)
  if (filePath.startsWith('/')) {
    return { valid: false, reason: 'Resource path must be relative' };
  }

  // Must not traverse outside plugin directory
  if (filePath.includes('..')) {
    return { valid: false, reason: 'Resource path cannot contain parent directory traversal' };
  }

  // Must be within locales/ or resources/ directory
  if (!filePath.startsWith('locales/') && !filePath.startsWith('resources/')) {
    return {
      valid: false,
      reason: 'Resource files must be in locales/ or resources/ directory',
    };
  }

  // Must have allowed extension
  const hasAllowedExt = DEFAULT_OPTIONS.allowedExtensions.some((ext) => filePath.endsWith(ext));
  if (!hasAllowedExt) {
    return { valid: false, reason: 'Resource file must be .json' };
  }

  return { valid: true };
}

/**
 * Validate contract-declared resource paths before runtime file loading.
 */
export function validateDeclaredPluginResources(
  pluginId: string,
  resourcePaths: string[] | undefined,
  options: ResourcePolicyOptions = {}
): {
  valid: boolean;
  errors: string[];
  resources: string[];
} {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const resources = resourcePaths || [];
  const errors: string[] = [];
  const seen = new Set<string>();

  if (resources.length > opts.maxDeclaredResources) {
    errors.push(
      `Plugin "${pluginId}" declares too many resources (${resources.length} > ${opts.maxDeclaredResources})`
    );
  }

  for (const resourcePath of resources) {
    if (seen.has(resourcePath)) {
      errors.push(`Duplicate resource declaration: ${resourcePath}`);
      continue;
    }

    seen.add(resourcePath);

    const result = validateResourcePath(resourcePath, pluginId);
    if (!result.valid) {
      errors.push(result.reason || `Invalid resource path: ${resourcePath}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    resources,
  };
}

/**
 * Validate a single resource file
 */
export function validateResourceFile(
  filePath: string,
  content: string,
  pluginId: string,
  options: ResourcePolicyOptions = {}
): { valid: boolean; reason?: string } {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Path validation
  const pathResult = validateResourcePath(filePath, pluginId);
  if (!pathResult.valid) {
    return pathResult;
  }

  // Size check
  const size = Buffer.byteLength(content, 'utf-8');
  if (size > opts.maxFileSize) {
    return {
      valid: false,
      reason: `Resource file "${filePath}" exceeds max size (${size} > ${opts.maxFileSize} bytes)`,
    };
  }

  // JSON validation
  try {
    const parsed = JSON.parse(content);

    // Check namespace collision for locale files
    if (filePath.startsWith('locales/')) {
      const namespace = filePath.replace('locales/', '').replace(/\/[^/]+$/, '');
      if (RESERVED_NAMESPACES.has(namespace)) {
        return {
          valid: false,
          reason: `Namespace "${namespace}" is reserved by the platform`,
        };
      }

      // Basic structure check: must be a flat or nested object
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return {
          valid: false,
          reason: 'Locale file must contain a JSON object',
        };
      }
    }
  } catch {
    return { valid: false, reason: `Resource file "${filePath}" is not valid JSON` };
  }

  return { valid: true };
}

/**
 * Validate all resources for a plugin
 */
export function validatePluginResources(
  pluginId: string,
  resources: Array<{ path: string; content: string }>,
  options: ResourcePolicyOptions = {}
): {
  valid: boolean;
  errors: string[];
} {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const errors: string[] = [];
  let totalSize = 0;

  for (const { path, content } of resources) {
    const result = validateResourceFile(path, content, pluginId, opts);
    if (!result.valid) {
      errors.push(result.reason || `Invalid resource: ${path}`);
    }
    totalSize += Buffer.byteLength(content, 'utf-8');
  }

  if (totalSize > opts.maxTotalSize) {
    errors.push(
      `Total resource size (${totalSize} bytes) exceeds limit (${opts.maxTotalSize} bytes)`
    );
  }

  if (errors.length > 0) {
    logger.warn({ pluginId, errors }, 'Plugin resource validation failed');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
