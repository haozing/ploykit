import fs from 'node:fs';
import path from 'node:path';

const MODULE_EXTENSION_MARKERS = [
  'CONTRACT_VERSION',
  'PERMISSION_EXTENSIONS',
  'EGRESS',
  'SERVICE_REQUIREMENTS',
  'RESOURCE_BINDINGS',
  'API_ROUTE_EXTENSIONS',
  'ACTION_EXTENSIONS',
  'JOB_EXTENSIONS',
];

function moduleMarker(name) {
  return `/* __PLOYKIT_${name}__ */`;
}

function insertModuleSnippet(source, markerName, snippet) {
  const marker = moduleMarker(markerName);
  if (!source.includes(marker)) {
    throw new Error(`Template module.ts is missing extension marker ${marker}.`);
  }
  return source.replace(marker, `${snippet}\n  ${marker}`);
}

function cleanupModuleExtensionMarkers(source) {
  let next = source;
  for (const markerName of MODULE_EXTENSION_MARKERS) {
    const escapedMarker = moduleMarker(markerName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\n?\\s*${escapedMarker}`, 'g');
    next = next.replace(pattern, '');
  }
  return next.replace(/\n{3,}/g, '\n\n');
}

function applyServiceBackedExtension(moduleSource) {
  let next = moduleSource;
  next = insertModuleSnippet(next, 'CONTRACT_VERSION', 'contractVersion: 2,');
  next = insertModuleSnippet(
    next,
    'PERMISSION_EXTENSIONS',
    [
      'Permission.ServicesInvoke,',
      'Permission.AuditWrite,',
      'Permission.ResourceBindingsRead,',
    ].join('\n    ')
  );
  next = insertModuleSnippet(
    next,
    'SERVICE_REQUIREMENTS',
    `serviceRequirements: {
    serviceCore: {
      required: true,
      provider: 'service-core',
      kind: 'signed-http',
      description: 'Call the product service through runtime signing.',
      connection: {
        baseUrl: 'https://service.example',
        egress: ['https://service.example'],
        timeoutMs: 8000,
        retry: { attempts: 2, backoff: 'exponential', retryOn: [502, 503, 504] },
        maxRequestBytes: 262144,
        maxResponseBytes: 524288,
      },
      secrets: {
        bearerToken: { required: true, description: 'Service bearer token.' },
        hmacSecret: { required: true, description: 'Runtime signing HMAC secret.' },
      },
      claims: {
        requestId: '\${ctx.request.id}',
        correlationId: '\${ctx.request.correlationId}',
        actorId: '\${ctx.auth.actorId}',
        workspaceId: '\${ctx.scope.workspaceId}',
        tenantId: '\${input.tenantId}',
        moduleId: '\${ctx.module.id}',
      },
      operations: {
        request: {
          input: {
            allow: ['path', 'method', 'headers', 'query', 'json'],
            claimsAllow: ['tenantId'],
          },
          auth: { type: 'bearer', secret: 'bearerToken' },
          signing: {
            type: 'hmac-sha256',
            secret: 'hmacSecret',
            header: 'x-service-signature',
            timestampHeader: 'x-service-timestamp',
            claimsHeader: 'x-service-claims',
            canonical: ['method', 'path', 'timestamp', 'bodySha256', 'claimsSha256'],
          },
          request: {
            body: 'json',
            allowHeaders: ['content-type', 'idempotency-key', 'x-request-id'],
            denyHeaders: ['authorization', 'cookie', 'x-service-signature'],
          },
          response: { body: 'json', maxBytes: 524288 },
          audit: {
            event: '__MODULE_ID__.service.requested',
            includeClaims: ['requestId', 'workspaceId', 'tenantId'],
          },
          redaction: {
            request: ['headers.authorization', 'headers.x-service-signature', 'json.token', 'json.secret'],
            response: ['headers.set-cookie', 'json.token', 'json.secret', 'json.credentials'],
            error: ['headers.set-cookie', 'body.token', 'body.secret', 'body.credentials'],
          },
        },
      },
    },
  },`
  );
  next = insertModuleSnippet(
    next,
    'RESOURCE_BINDINGS',
    `resourceBindings: {
    remote_tenant: {
      kind: 'service.tenant',
      required: false,
      description: 'Remote tenant binding for the product service.',
    },
  },`
  );
  next = insertModuleSnippet(
    next,
    'API_ROUTE_EXTENSIONS',
    `{
        path: '/service/status',
        handler: './api/service-status',
        methods: ['GET'],
        auth: 'auth',
        permissions: [Permission.ServicesInvoke],
      },`
  );
  next = insertModuleSnippet(
    next,
    'ACTION_EXTENSIONS',
    `callService: {
      handler: './actions/call-service',
      auth: 'auth',
      sideEffect: 'external',
      permissions: [Permission.ServicesInvoke, Permission.AuditWrite],
      idempotency: { required: true, keyFrom: 'request' },
    },`
  );
  return next;
}

function applyBackgroundExtension(moduleSource) {
  let next = moduleSource;
  next = insertModuleSnippet(
    next,
    'PERMISSION_EXTENSIONS',
    [
      'Permission.JobsEnqueue,',
      'Permission.JobsRegister,',
      'Permission.ArtifactsWrite,',
      'Permission.NotificationsSend,',
    ].join('\n    ')
  );
  next = insertModuleSnippet(
    next,
    'ACTION_EXTENSIONS',
    `enqueueReport: {
      handler: './actions/enqueue-report',
      auth: 'auth',
      sideEffect: 'write',
      permissions: [Permission.JobsEnqueue],
    },`
  );
  next = insertModuleSnippet(
    next,
    'JOB_EXTENSIONS',
    `jobs: {
    generate_report: {
      handler: './jobs/generate-report',
      retries: 2,
      timeoutMs: 30000,
      permissions: [Permission.ArtifactsWrite, Permission.NotificationsSend],
    },
  },`
  );
  return next;
}

function renderExtensionContent(source, variables) {
  return source
    .replaceAll('__MODULE_ID__', variables.moduleId)
    .replaceAll('__MODULE_NAME__', variables.moduleName);
}

export function applyModuleExtensions(options) {
  const { projectRoot, moduleRoot, extensions, variables, copyTemplateDirectory, toProjectPath } =
    options;
  const moduleFile = path.join(moduleRoot, 'module.ts');

  if (extensions.length === 0) {
    if (fs.existsSync(moduleFile)) {
      fs.writeFileSync(
        moduleFile,
        cleanupModuleExtensionMarkers(fs.readFileSync(moduleFile, 'utf8')),
        'utf8'
      );
    }
    return;
  }

  let moduleSource = fs.readFileSync(moduleFile, 'utf8');

  for (const extension of extensions) {
    const extensionRoot = path.join(projectRoot, 'templates', 'module-extensions', extension);
    if (!fs.existsSync(extensionRoot)) {
      throw new Error(`Extension directory is missing: ${toProjectPath(extensionRoot)}`);
    }
    copyTemplateDirectory(extensionRoot, moduleRoot, variables);

    if (extension === 'service-backed') {
      moduleSource = applyServiceBackedExtension(moduleSource);
    } else if (extension === 'background') {
      moduleSource = applyBackgroundExtension(moduleSource);
    }
  }

  fs.writeFileSync(
    moduleFile,
    cleanupModuleExtensionMarkers(renderExtensionContent(moduleSource, variables)),
    'utf8'
  );
}
