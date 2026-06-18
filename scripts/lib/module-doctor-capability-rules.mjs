import {
  extractObjectAfterKey,
  extractStaticHttpFetchOrigins,
  extractStringArray,
  originForUrl,
} from './module-contract-source.mjs';
import { readModuleSourceCode } from './module-source-safety.mjs';

function hasAnyPermission(source, permissions) {
  return permissions.some((permission) => source.includes(permission));
}

export function createModuleDoctorCapabilityRules({ diagnostic }) {
  function checkCapabilityPermissions(moduleRoot, moduleSource, diagnostics) {
    const code = readModuleSourceCode(moduleRoot);
    const checks = [
      {
        token: 'ctx.data',
        permissions: [
          'Permission.DataDocumentRead',
          'Permission.DataDocumentWrite',
          'Permission.DataTableRead',
          'Permission.DataTableWrite',
          'Permission.DataTransaction',
          'Permission.DataSqlRead',
          'Permission.DataSqlWrite',
          'data.document.read',
          'data.document.write',
          'data.table.read',
          'data.table.write',
          'data.transaction',
          'data.sql.read',
          'data.sql.write',
        ],
        code: 'MODULE_DATA_PERMISSION_MISSING',
        fix: 'Add the matching Data permission to module.ts. For scoped CRUD, follow docs/llm/recipes/multi-tenant-crud.md.',
      },
      {
        token: 'ctx.files',
        permissions: [
          'Permission.FilesRead',
          'Permission.FilesWrite',
          'Permission.FilesPublish',
          'files.read',
          'files.write',
          'files.publish',
        ],
        code: 'MODULE_FILES_PERMISSION_MISSING',
        fix: 'Add Permission.FilesRead, Permission.FilesWrite, or Permission.FilesPublish to module.ts.',
      },
      {
        token: 'ctx.artifacts',
        permissions: [
          'Permission.ArtifactsRead',
          'Permission.ArtifactsWrite',
          'artifacts.read',
          'artifacts.write',
        ],
        code: 'MODULE_ARTIFACTS_PERMISSION_MISSING',
        fix: 'Add Permission.ArtifactsRead or Permission.ArtifactsWrite to module.ts.',
      },
      {
        token: 'ctx.resourceBindings',
        permissions: [
          'Permission.ResourceBindingsRead',
          'Permission.ResourceBindingsWrite',
          'resourceBindings.read',
          'resourceBindings.write',
        ],
        code: 'MODULE_RESOURCE_BINDINGS_PERMISSION_MISSING',
        fix: 'Add Permission.ResourceBindingsRead or Permission.ResourceBindingsWrite to module.ts.',
      },
      {
        token: 'ctx.notifications.send',
        permissions: ['Permission.NotificationsSend', 'notifications.send'],
        code: 'MODULE_NOTIFICATIONS_SEND_PERMISSION_MISSING',
        fix: 'Add Permission.NotificationsSend to module.ts.',
      },
      {
        token: 'ctx.notifications.list',
        permissions: ['Permission.NotificationsRead', 'notifications.read'],
        code: 'MODULE_NOTIFICATIONS_READ_PERMISSION_MISSING',
        fix: 'Add Permission.NotificationsRead to module.ts.',
      },
      {
        token: 'ctx.notifications.markRead',
        permissions: ['Permission.NotificationsRead', 'notifications.read'],
        code: 'MODULE_NOTIFICATIONS_READ_PERMISSION_MISSING',
        fix: 'Add Permission.NotificationsRead to module.ts.',
      },
      {
        token: 'ctx.runs',
        permissions: ['Permission.RunsRead', 'Permission.RunsWrite', 'runs.read', 'runs.write'],
        code: 'MODULE_RUNS_PERMISSION_MISSING',
        fix: 'Add Permission.RunsRead or Permission.RunsWrite to module.ts.',
      },
      {
        token: 'ctx.jobs',
        permissions: [
          'Permission.JobsEnqueue',
          'Permission.JobsRegister',
          'jobs.enqueue',
          'jobs.register',
        ],
        code: 'MODULE_JOBS_PERMISSION_MISSING',
        fix: 'Add Permission.JobsEnqueue or Permission.JobsRegister to module.ts. For long work, follow docs/llm/recipes/background-job.md.',
      },
      {
        token: 'ctx.events',
        permissions: [
          'Permission.EventsEmit',
          'Permission.EventsSubscribe',
          'events.emit',
          'events.subscribe',
        ],
        code: 'MODULE_EVENTS_PERMISSION_MISSING',
        fix: 'Add Permission.EventsEmit or Permission.EventsSubscribe to module.ts.',
      },
      {
        token: 'ctx.webhooks',
        permissions: ['Permission.WebhookReceive', 'webhook.receive'],
        code: 'MODULE_WEBHOOKS_PERMISSION_MISSING',
        fix: 'Add Permission.WebhookReceive to module.ts.',
      },
      {
        token: 'ctx.connectors',
        permissions: [
          'Permission.ConnectorsRead',
          'Permission.ConnectorsInvoke',
          'Permission.ConnectorsManage',
          'connectors.read',
          'connectors.invoke',
          'connectors.manage',
        ],
        code: 'MODULE_CONNECTORS_PERMISSION_MISSING',
        fix: 'Add the matching connector permission to module.ts.',
      },
      {
        token: 'ctx.services',
        permissions: ['Permission.ServicesInvoke', 'services.invoke'],
        code: 'MODULE_SERVICES_PERMISSION_MISSING',
        fix: 'Add Permission.ServicesInvoke to module.ts and declare serviceRequirements. Follow docs/llm/recipes/service-backed.md.',
      },
      {
        token: 'ctx.secrets',
        permissions: [
          'Permission.SecretsRead',
          'Permission.SecretsWrite',
          'secrets.read',
          'secrets.write',
        ],
        code: 'MODULE_SECRETS_PERMISSION_MISSING',
        fix: 'Add Permission.SecretsRead or Permission.SecretsWrite to module.ts.',
      },
      {
        token: 'ctx.config',
        permissions: [
          'Permission.ConfigRead',
          'Permission.ConfigWrite',
          'config.read',
          'config.write',
        ],
        code: 'MODULE_CONFIG_PERMISSION_MISSING',
        fix: 'Add Permission.ConfigRead or Permission.ConfigWrite to module.ts.',
      },
      {
        token: 'ctx.apiKeys',
        permissions: [
          'Permission.ApiKeysRead',
          'Permission.ApiKeysWrite',
          'apiKeys.read',
          'apiKeys.write',
        ],
        code: 'MODULE_API_KEYS_PERMISSION_MISSING',
        fix: 'Add Permission.ApiKeysRead or Permission.ApiKeysWrite to module.ts.',
      },
      {
        token: 'ctx.rateLimit',
        permissions: ['Permission.RateLimitCheck', 'rateLimit.check'],
        code: 'MODULE_RATE_LIMIT_PERMISSION_MISSING',
        fix: 'Add Permission.RateLimitCheck to module.ts.',
      },
      {
        token: 'ctx.http',
        permissions: ['Permission.ExternalHttp', 'http.external'],
        code: 'MODULE_HTTP_PERMISSION_MISSING',
        fix: 'Add Permission.ExternalHttp and a narrow egress origin to module.ts. For controlled services, use docs/llm/recipes/service-backed.md instead.',
      },
      {
        token: 'ctx.cache',
        permissions: ['Permission.CacheRevalidate', 'cache.revalidate'],
        code: 'MODULE_CACHE_PERMISSION_MISSING',
        fix: 'Add Permission.CacheRevalidate to module.ts.',
      },
      {
        token: 'ctx.audit',
        permissions: ['Permission.AuditWrite', 'audit.write'],
        code: 'MODULE_AUDIT_PERMISSION_MISSING',
        fix: 'Add Permission.AuditWrite to module.ts.',
      },
      {
        token: 'ctx.ai',
        permissions: ['Permission.AiGenerate', 'Permission.AiEmbed', 'ai.generate', 'ai.embed'],
        code: 'MODULE_AI_PERMISSION_MISSING',
        fix: 'Add Permission.AiGenerate or Permission.AiEmbed to module.ts.',
      },
      {
        token: 'ctx.rag',
        permissions: ['Permission.RagRead', 'Permission.RagWrite', 'rag.read', 'rag.write'],
        code: 'MODULE_RAG_PERMISSION_MISSING',
        fix: 'Add Permission.RagRead or Permission.RagWrite to module.ts.',
      },
      {
        token: 'ctx.usage',
        permissions: ['Permission.UsageWrite', 'usage.write'],
        code: 'MODULE_USAGE_PERMISSION_MISSING',
        fix: 'Add Permission.UsageWrite to module.ts.',
      },
      {
        token: 'ctx.metering',
        permissions: ['Permission.MeteringWrite', 'metering.write'],
        code: 'MODULE_METERING_PERMISSION_MISSING',
        fix: 'Add Permission.MeteringWrite to module.ts. For charging/reserving, follow docs/llm/recipes/billing-charge.md.',
      },
      {
        token: 'ctx.credits',
        permissions: [
          'Permission.CreditsRead',
          'Permission.CreditsConsume',
          'Permission.CreditsWrite',
          'credits.read',
          'credits.consume',
          'credits.write',
        ],
        code: 'MODULE_CREDITS_PERMISSION_MISSING',
        fix: 'Add the matching Credits permission to module.ts. For charge/reserve flows, follow docs/llm/recipes/billing-charge.md.',
      },
      {
        token: 'ctx.billing',
        permissions: [
          'Permission.BillingRead',
          'Permission.BillingWrite',
          'billing.read',
          'billing.write',
        ],
        code: 'MODULE_BILLING_PERMISSION_MISSING',
        fix: 'Add Permission.BillingRead or Permission.BillingWrite to module.ts.',
      },
      {
        token: 'ctx.commerce',
        permissions: [
          'Permission.CommerceRead',
          'Permission.CommerceWrite',
          'commerce.read',
          'commerce.write',
        ],
        code: 'MODULE_COMMERCE_PERMISSION_MISSING',
        fix: 'Add the matching Commerce permission to module.ts. Do not create module-owned commercial authority; see docs/llm/concepts/commercial-integrity.md.',
      },
    ];

    for (const check of checks) {
      if (code.includes(check.token) && !hasAnyPermission(moduleSource, check.permissions)) {
        diagnostics.push(
          diagnostic(
            'error',
            check.code,
            `${check.token} is used but module.ts does not declare the matching permission.`,
            check.token,
            check.fix
          )
        );
      }
    }
  }

  function checkCapabilityDeclarations(moduleRoot, moduleSource, diagnostics) {
    const code = readModuleSourceCode(moduleRoot);
    const configSource = extractObjectAfterKey(moduleSource, 'config');
    const declarationChecks = [
      {
        token: 'ctx.config',
        hasDeclaration: /\bconfig\s*:/.test(moduleSource),
        code: 'MODULE_CONFIG_DECLARATION_MISSING',
        pathValue: 'config',
        fix: 'Declare config fields in module.ts and read them through ctx.config.',
      },
      {
        token: 'ctx.secrets',
        hasDeclaration: /\bsecret\s*:\s*true\b/.test(configSource),
        code: 'MODULE_SECRET_CONFIG_DECLARATION_MISSING',
        pathValue: 'config',
        fix: 'Declare at least one config field with secret: true and read it through ctx.secrets.',
      },
      {
        token: 'ctx.services',
        hasDeclaration: /\bserviceRequirements\s*:/.test(moduleSource),
        code: 'MODULE_SERVICE_REQUIREMENT_MISSING',
        pathValue: 'serviceRequirements',
        fix: 'Declare serviceRequirements in module.ts so provider readiness can be checked. Follow docs/llm/recipes/service-backed.md.',
      },
      {
        token: 'ctx.resourceBindings',
        hasDeclaration: /\bresourceBindings\s*:/.test(moduleSource),
        code: 'MODULE_RESOURCE_BINDING_DECLARATION_MISSING',
        pathValue: 'resourceBindings',
        fix: 'Declare resourceBindings in module.ts so host resources are explicit.',
      },
    ];

    for (const check of declarationChecks) {
      if (code.includes(check.token) && !check.hasDeclaration) {
        diagnostics.push(
          diagnostic(
            'error',
            check.code,
            `${check.token} is used but module.ts does not declare the matching contract metadata.`,
            check.pathValue,
            check.fix
          )
        );
      }
    }
  }

  function checkPrivilegedServiceSourceUsage(moduleRoot, moduleSource, diagnostics) {
    if (!/\bserviceRequirements\s*:/.test(moduleSource)) {
      return;
    }
    const code = readModuleSourceCode(moduleRoot);
    if (/\bctx\.http\.fetch\s*\(/.test(code)) {
      const serviceOrigins = new Set(
        extractStringArray(moduleSource, 'egress').map(originForUrl).filter(Boolean)
      );
      const fetchOrigins = extractStaticHttpFetchOrigins(code);
      const overlapsPrivilegedService =
        fetchOrigins.length === 0 || fetchOrigins.some((origin) => serviceOrigins.has(origin));
      if (!overlapsPrivilegedService) {
        return;
      }
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_PRIVILEGED_HTTP_FORBIDDEN',
          'Modules that declare privileged serviceRequirements must not call the same service through ctx.http.fetch.',
          'serviceRequirements',
          'Use ctx.services.invoke(serviceName, operationName, input) so runtime can sign, redact and audit the request. See docs/llm/recipes/service-backed.md.'
        )
      );
    }
    if (
      /authorization\s*:\s*['"`]\s*Bearer\s+/i.test(code) ||
      /x-[\w-]*signature\s*['"`]?\s*:/i.test(code)
    ) {
      diagnostics.push(
        diagnostic(
          'error',
          'MODULE_SECRET_LITERAL_FORBIDDEN',
          'Module source appears to construct privileged service credentials or signature headers.',
          'serviceRequirements',
          'Declare service secrets in serviceRequirements and let runtime inject bearer/HMAC headers. See docs/llm/concepts/service-contract-first.md.'
        )
      );
    }
  }

  return {
    checkCapabilityDeclarations,
    checkCapabilityPermissions,
    checkPrivilegedServiceSourceUsage,
  };
}
