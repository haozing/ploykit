import fs from 'node:fs';
import path from 'node:path';

import {
  extractObjectAfterKey,
  extractPublicAliases,
  extractRouteObjects,
  extractStaticHttpFetchOrigins,
  extractStringArray,
  extractTopLevelStringArray,
  hasStringProperty,
  normalizeLocalModulePath,
  originForUrl,
  resolveAnonymousPolicySource,
} from './module-contract-source.mjs';
import { readModuleSourceCode } from './module-source-safety.mjs';

export const MODULE_ID_PATTERN = /^[a-z0-9-]+$/;
export const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;

const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_.:-]*$/;
const EGRESS_ORIGIN_PATTERN = /^https?:\/\/[^*/\s?#]+(?::\d+)?$/;
const RATE_LIMIT_WINDOW_PATTERN = /^\d+(ms|s|m|h|d)$/;
const WEBHOOK_SIGNATURES = new Set(['none', 'hmac-sha256', 'stripe', 'github']);
const DATA_MIGRATION_MODES = new Set(['generated', 'sql']);
const LIFECYCLE_HOOKS = new Set([
  'install',
  'enable',
  'disable',
  'update',
  'seed',
  'activate',
  'deactivate',
  'reset',
]);
const RESERVED_PUBLIC_ALIAS_PATHS = new Set([
  '/',
  '/about',
  '/pricing',
  '/login',
  '/signup',
  '/sign-in',
  '/sign-up',
]);
const RESERVED_PUBLIC_ALIAS_PREFIXES = ['/api', '/admin', '/dashboard'];

function isReservedPublicAlias(value) {
  if (RESERVED_PUBLIC_ALIAS_PATHS.has(value)) {
    return true;
  }

  return RESERVED_PUBLIC_ALIAS_PREFIXES.some(
    (prefix) => value === prefix || value.startsWith(`${prefix}/`)
  );
}

function hasDataDefinition(source) {
  return /\bdata\s*:\s*{/.test(source);
}

function dataDefinitionSource(source) {
  return extractObjectAfterKey(source, 'data');
}

function hasPhysicalDataDefinition(source) {
  const dataSource = dataDefinitionSource(source);
  return /\b(?:tables|views|grants|checks)\s*:/.test(dataSource);
}

function hasDataMigrationsDeclaration(source) {
  return /\bmigrations\s*:/.test(dataDefinitionSource(source));
}

function extractMigrationMode(source) {
  return (
    dataDefinitionSource(source).match(
      /\bmigrations\s*:\s*{[\s\S]*?\bmode\s*:\s*['"`]([^'"`]+)['"`]/
    )?.[1] ?? null
  );
}

function hasGeneratedMigrations(source) {
  const migrationMode = extractMigrationMode(source);
  return !migrationMode || migrationMode === 'generated';
}

function extractMigrationDir(source) {
  return (
    source.match(/\bmigrations\s*:\s*{[\s\S]*?\bdir\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ??
    './migrations'
  );
}

function extractLifecycleEntries(source) {
  const lifecycleSource = extractObjectAfterKey(source, 'lifecycle');
  if (!lifecycleSource) {
    return [];
  }

  const entries = [];
  const unquotedPattern = /\b([A-Za-z_$][\w$]*)\s*:\s*['"`](\.\/[^'"`]+)['"`]/g;
  for (const match of lifecycleSource.matchAll(unquotedPattern)) {
    entries.push({ hook: match[1], localPath: match[2] });
  }

  const quotedPattern = /['"`]([^'"`]+)['"`]\s*:\s*['"`](\.\/[^'"`]+)['"`]/g;
  for (const match of lifecycleSource.matchAll(quotedPattern)) {
    entries.push({ hook: match[1], localPath: match[2] });
  }

  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.hook}:${entry.localPath}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function hasDefaultExport(source) {
  return /\bexport\s+default\b/.test(source) || /\bexport\s*{[^}]+\bas\s+default\b/.test(source);
}

export function createModuleDoctorContractRules({ diagnostic, toProjectPath }) {
  function checkFileExists(diagnostics, file, code, message, fix) {
    if (fs.existsSync(file)) {
      return;
    }

    diagnostics.push(diagnostic('error', code, message, toProjectPath(file), fix));
  }

  function checkPublicAliases(source, diagnostics) {
    const seen = new Set();
    for (const alias of extractPublicAliases(source)) {
      if (!alias.startsWith('/') || alias.includes('?') || alias.includes('#')) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_PUBLIC_ALIAS_PATH_INVALID',
            `Public alias "${alias}" must be an absolute path without query or hash.`,
            'publicAliases',
            'Use a path like "/tools/json-formatter".'
          )
        );
      }

      if (alias.includes(':') || alias.includes('*')) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_PUBLIC_ALIAS_DYNAMIC_UNSUPPORTED',
            `Public alias "${alias}" must be a static host path.`,
            'publicAliases',
            'Use a fixed path such as "/tools/json-formatter".'
          )
        );
      }

      if (isReservedPublicAlias(alias)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_PUBLIC_ALIAS_RESERVED',
            `Public alias "${alias}" conflicts with a reserved host path.`,
            'publicAliases',
            'Use a product-specific path such as "/tools/my-tool".'
          )
        );
      }

      if (seen.has(alias)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_PUBLIC_ALIAS_DUPLICATE',
            `Public alias "${alias}" is duplicated in this module.`,
            'publicAliases'
          )
        );
      }
      seen.add(alias);
    }
  }

  function checkResourceKinds(source, diagnostics) {
    const assetObjectPattern = /{[^{}]*\bpath\s*:\s*['"`]([^'"`]+)['"`][^{}]*}/g;
    for (const match of source.matchAll(assetObjectPattern)) {
      const objectSource = match[0];
      const assetPath = match[1];
      if (assetPath.endsWith('.wasm') && !/\bkind\s*:\s*['"`]wasm['"`]/.test(objectSource)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_ASSET_WASM_KIND_REQUIRED',
            'WASM assets must explicitly declare kind: "wasm".',
            assetPath,
            'Add kind: "wasm".'
          )
        );
      }
      if (assetPath.includes('.worker.') && !/\bkind\s*:\s*['"`]worker['"`]/.test(objectSource)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_ASSET_WORKER_KIND_REQUIRED',
            'Worker assets must explicitly declare kind: "worker".',
            assetPath,
            'Add kind: "worker".'
          )
        );
      }
    }
  }

  function checkEventNames(source, diagnostics) {
    const publishBlocks = source.matchAll(/\bpublishes\s*:\s*\[([\s\S]*?)\]/g);
    for (const block of publishBlocks) {
      for (const match of block[1].matchAll(/['"`]([^'"`]+)['"`]/g)) {
        const eventName = match[1];
        if (!EVENT_NAME_PATTERN.test(eventName)) {
          diagnostics.push(
            diagnostic(
              'error',
              'MODULE_EVENT_NAME_INVALID',
              `Event "${eventName}" must start with a lowercase letter and contain only lowercase letters, numbers, "_", ".", ":", or "-".`,
              eventName,
              'Use an event name like "orders.created" or "hello:greeted".'
            )
          );
        }
      }
    }

    const subscribeBlocks = source.matchAll(/\bsubscribes\s*:\s*{([\s\S]*?)}/g);
    for (const block of subscribeBlocks) {
      for (const match of block[1].matchAll(/['"`]([^'"`]+)['"`]\s*:/g)) {
        const eventName = match[1];
        if (!EVENT_NAME_PATTERN.test(eventName)) {
          diagnostics.push(
            diagnostic(
              'error',
              'MODULE_EVENT_NAME_INVALID',
              `Event "${eventName}" must start with a lowercase letter and contain only lowercase letters, numbers, "_", ".", ":", or "-".`,
              eventName,
              'Use an event name like "orders.created" or "hello:greeted".'
            )
          );
        }
      }
    }
  }

  function checkWebhookSignatures(source, diagnostics) {
    for (const match of source.matchAll(/\bsignature\s*:\s*['"`]([^'"`]+)['"`]/g)) {
      const signature = match[1];
      if (!WEBHOOK_SIGNATURES.has(signature)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_WEBHOOK_SIGNATURE_INVALID',
            `Webhook signature "${signature}" is not supported.`,
            signature,
            'Use "none", "hmac-sha256", "stripe", or "github".'
          )
        );
      }
    }
  }

  function checkHttpEgress(moduleRoot, moduleSource, diagnostics) {
    const code = readModuleSourceCode(moduleRoot);
    const usesHttpFetch = /\bctx\.http\.fetch\s*\(/.test(code);
    const egressOrigins = extractTopLevelStringArray(moduleSource, 'egress');
    const hasExternalHttpPermission =
      moduleSource.includes('Permission.ExternalHttp') || moduleSource.includes('http.external');

    if (usesHttpFetch && egressOrigins.length === 0) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_HTTP_EGRESS_MISSING',
          'ctx.http.fetch is used but module.ts does not declare egress origins.',
          'egress',
          'Declare egress: ["https://api.example.com"] with the exact allowed origin.'
        )
      );
    }

    if (egressOrigins.length > 0 && !hasExternalHttpPermission) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_EGRESS_PERMISSION_REQUIRED',
          'Modules that declare egress origins must also declare Permission.ExternalHttp.',
          'permissions',
          'Add Permission.ExternalHttp or remove the unused egress declaration.'
        )
      );
    }

    if (hasExternalHttpPermission && egressOrigins.length === 0) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_HTTP_EGRESS_REQUIRED',
          'Permission.ExternalHttp requires at least one explicit egress origin.',
          'egress',
          'Declare egress: ["https://api.example.com"].'
        )
      );
    }

    for (const [index, origin] of egressOrigins.entries()) {
      if (!EGRESS_ORIGIN_PATTERN.test(origin) || origin.includes('*')) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_EGRESS_ORIGIN_INVALID',
            `Egress origin "${origin}" must be an explicit http(s) origin.`,
            `egress.${index}`,
            'Use an origin like "https://api.example.com".'
          )
        );
      }
    }
  }

  function checkPublicRouteContracts(source, diagnostics) {
    for (const [index, route] of extractRouteObjects(source, 'site').entries()) {
      if (!hasStringProperty(route, 'auth', 'public')) {
        continue;
      }

      if (!/\bmetadata\s*:/.test(route)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_PUBLIC_SITE_METADATA_REQUIRED',
            'Public site routes must declare a metadata loader.',
            `routes.site.${index}.metadata`,
            'Add metadata: "./loaders/metadata" and return title, description, and canonical.'
          )
        );
      }

      if (!/\bcache\s*:/.test(route)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_PUBLIC_SITE_CACHE_REQUIRED',
            'Public site routes must declare an explicit cache strategy.',
            `routes.site.${index}.cache`,
            'Add cache: { strategy: "public", revalidateSeconds: 300, tags: ["module-id"] } or strategy: "none".'
          )
        );
      }

      if (/\bstrategy\s*:\s*['"`]private['"`]/.test(route)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_PUBLIC_ROUTE_PRIVATE_CACHE',
            'Public routes cannot use private cache strategy.',
            `routes.site.${index}.cache.strategy`,
            'Use "public" or "none".'
          )
        );
      }

      const revalidate = route.match(/\brevalidateSeconds\s*:\s*(-?\d+)/)?.[1];
      if (revalidate && Number(revalidate) <= 0) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_ROUTE_CACHE_REVALIDATE_INVALID',
            'Cache revalidateSeconds must be a positive integer when declared.',
            `routes.site.${index}.cache.revalidateSeconds`
          )
        );
      }
    }

    for (const [index, route] of extractRouteObjects(source, 'api').entries()) {
      if (!hasStringProperty(route, 'auth', 'public')) {
        continue;
      }

      if (!/\banonymousPolicy\b/.test(route)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_PUBLIC_API_ANONYMOUS_POLICY_REQUIRED',
            'Public API routes must declare anonymousPolicy.',
            `routes.api.${index}.anonymousPolicy`,
            'Add anonymousPolicy with rateLimit, upload, captcha, or high-cost policy.'
          )
        );
        continue;
      }

      const policy = resolveAnonymousPolicySource(route, source);
      if (!policy) {
        continue;
      }

      if (!/\brateLimit\s*:/.test(policy)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_PUBLIC_API_RATE_LIMIT_REQUIRED',
            'Public API routes must declare anonymousPolicy.rateLimit.',
            `routes.api.${index}.anonymousPolicy.rateLimit`,
            'Add an IP, route, module, method, or custom bucket rate limit.'
          )
        );
      }

      const limit = policy.match(/\blimit\s*:\s*(-?\d+)/)?.[1];
      if (limit && Number(limit) <= 0) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_PUBLIC_API_RATE_LIMIT_INVALID',
            'anonymousPolicy.rateLimit.limit must be a positive integer.',
            `routes.api.${index}.anonymousPolicy.rateLimit.limit`
          )
        );
      }

      const windowValue = policy.match(/\bwindow\s*:\s*['"`]([^'"`]+)['"`]/)?.[1];
      if (windowValue && !RATE_LIMIT_WINDOW_PATTERN.test(windowValue)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_PUBLIC_API_RATE_LIMIT_WINDOW_INVALID',
            'anonymousPolicy.rateLimit.window must use a duration such as "30s", "1m", or "1h".',
            `routes.api.${index}.anonymousPolicy.rateLimit.window`
          )
        );
      }

      const maxUploadBytes = policy.match(/\bmaxUploadBytes\s*:\s*(-?\d+)/)?.[1];
      if (maxUploadBytes && Number(maxUploadBytes) <= 0) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_PUBLIC_API_UPLOAD_LIMIT_INVALID',
            'anonymousPolicy.maxUploadBytes must be a positive integer when declared.',
            `routes.api.${index}.anonymousPolicy.maxUploadBytes`
          )
        );
      }

      const captcha = policy.match(/\bcaptcha\s*:\s*['"`]([^'"`]+)['"`]/)?.[1];
      if (captcha && !['never', 'auto', 'always'].includes(captcha)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_PUBLIC_API_CAPTCHA_INVALID',
            `Anonymous captcha policy "${captcha}" is not supported.`,
            `routes.api.${index}.anonymousPolicy.captcha`,
            'Use "never", "auto", or "always".'
          )
        );
      }

      if (/\bcommercial\s*:/.test(route) && /\ballowHighCostActions\s*:\s*true\b/.test(policy)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_PUBLIC_API_HIGH_COST_ANONYMOUS_FORBIDDEN',
            'Public commercial API routes cannot allow anonymous high-cost actions.',
            `routes.api.${index}.anonymousPolicy.allowHighCostActions`,
            'Set allowHighCostActions: false and require auth for high-cost execution.'
          )
        );
      }
    }
  }

  function checkDataArtifacts(moduleRoot, source, diagnostics) {
    if (!hasDataDefinition(source)) {
      return;
    }

    const migrationMode = extractMigrationMode(source);
    const hasMigrations = hasDataMigrationsDeclaration(source);
    const hasPhysicalData = hasPhysicalDataDefinition(source);

    if (hasPhysicalData && !hasMigrations) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DATA_MIGRATIONS_REQUIRED',
          'Physical Data v2 definitions must declare an explicit migrations block.',
          'data.migrations',
          'Add migrations: { mode: "generated", dir: "./migrations" } or use mode: "sql".'
        )
      );
    }

    if (hasMigrations && !DATA_MIGRATION_MODES.has(migrationMode)) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_DATA_MIGRATION_MODE_INVALID',
          `Data migration mode "${migrationMode ?? '(missing)'}" is not supported.`,
          'data.migrations.mode',
          'Use "generated" or "sql".'
        )
      );
    }

    const generatedDir = path.join(moduleRoot, '.ploykit', 'generated');
    checkFileExists(
      diagnostics,
      path.join(generatedDir, 'data-plan.json'),
      'MODULE_DATA_PLAN_MISSING',
      'Data definition exists, but generated data plan is missing.',
      'Run npm run data:generate.'
    );
    checkFileExists(
      diagnostics,
      path.join(generatedDir, 'data-types.ts'),
      'MODULE_DATA_TYPES_MISSING',
      'Data definition exists, but generated data types are missing.',
      'Run npm run data:types.'
    );

    if (hasGeneratedMigrations(source)) {
      checkFileExists(
        diagnostics,
        path.join(
          moduleRoot,
          extractMigrationDir(source).replace(/^\.\//, ''),
          '0001_generated.sql'
        ),
        'MODULE_DATA_MIGRATION_MISSING',
        'Generated data migration is missing.',
        'Run npm run data:generate.'
      );
    }

    if (migrationMode === 'sql') {
      const migrationDir = path.join(moduleRoot, extractMigrationDir(source).replace(/^\.\//, ''));
      const sqlFiles = fs.existsSync(migrationDir)
        ? fs.readdirSync(migrationDir).filter((file) => file.endsWith('.sql'))
        : [];
      if (sqlFiles.length === 0) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_DATA_SQL_MIGRATION_MISSING',
            'SQL migration mode requires at least one .sql migration file.',
            toProjectPath(migrationDir),
            'Create a SQL migration file in the declared data.migrations.dir.'
          )
        );
      }
    }
  }

  function checkLifecycleContracts(moduleRoot, source, diagnostics) {
    for (const entry of extractLifecycleEntries(source)) {
      if (!LIFECYCLE_HOOKS.has(entry.hook)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_LIFECYCLE_HOOK_UNKNOWN',
            `Lifecycle hook "${entry.hook}" is not supported.`,
            `lifecycle.${entry.hook}`,
            `Use one of ${[...LIFECYCLE_HOOKS].join(', ')}.`
          )
        );
      }

      const resolved = normalizeLocalModulePath(moduleRoot, entry.localPath);
      if (!fs.existsSync(resolved)) {
        continue;
      }

      if (!hasDefaultExport(fs.readFileSync(resolved, 'utf8'))) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_LIFECYCLE_HANDLER_EXPORT_REQUIRED',
            `Lifecycle handler "${entry.localPath}" must provide a default export.`,
            toProjectPath(resolved),
            'Export a default function or an object with a run(ctx, event) method.'
          )
        );
      }
    }
  }

  return {
    checkDataArtifacts,
    checkEventNames,
    checkHttpEgress,
    checkLifecycleContracts,
    checkPublicAliases,
    checkPublicRouteContracts,
    checkResourceKinds,
    checkWebhookSignatures,
  };
}
