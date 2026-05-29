import { defineModule, Permission } from '@ploykit/module-sdk';

export default defineModule({
  contractVersion: 2,
  id: '__MODULE_ID__',
  name: '__MODULE_NAME__',
  version: '0.1.0',
  permissions: [Permission.ExternalHttp, Permission.ServicesInvoke, Permission.AuditWrite],
  egress: ['https://service.example'],
  serviceRequirements: {
    signedAdmin: {
      required: true,
      provider: 'example-signed-service',
      kind: 'signed-http',
      description: 'Call a privileged Admin API through runtime signing.',
      connection: {
        baseUrl: 'https://service.example',
        egress: ['https://service.example'],
        timeoutMs: 8000,
        retry: {
          attempts: 2,
          backoff: 'exponential',
          retryOn: [502, 503, 504],
        },
        maxRequestBytes: 262144,
        maxResponseBytes: 524288,
      },
      secrets: {
        bearerToken: {
          required: true,
          description: 'Admin API bearer token.',
        },
        hmacSecret: {
          required: true,
          description: 'HMAC signing secret.',
        },
      },
      claims: {
        requestId: '${ctx.request.id}',
        correlationId: '${ctx.request.correlationId}',
        actorId: '${ctx.auth.actorId}',
        workspaceId: '${ctx.scope.workspaceId}',
        moduleId: '${ctx.module.id}',
        remoteWorkspaceId: '${resource.remote_workspace.remoteWorkspaceId}',
      },
      operations: {
        'admin.request': {
          method: 'POST',
          input: {
            allow: ['path', 'method', 'query', 'json'],
            claimsAllow: ['workflowId'],
          },
          auth: {
            type: 'bearer',
            secret: 'bearerToken',
          },
          signing: {
            type: 'hmac-sha256',
            secret: 'hmacSecret',
            header: 'x-example-signature',
            timestampHeader: 'x-example-timestamp',
            claimsHeader: 'x-example-claims',
            canonical: ['method', 'path', 'timestamp', 'bodySha256', 'claimsSha256'],
          },
          request: {
            body: 'json',
            allowHeaders: ['content-type', 'idempotency-key'],
            denyHeaders: ['authorization', 'cookie', 'x-example-signature'],
          },
          response: {
            body: 'json',
            maxBytes: 524288,
          },
          audit: {
            event: '__MODULE_ID__.service.requested',
            includeClaims: ['requestId', 'workspaceId', 'remoteWorkspaceId'],
          },
          redaction: {
            request: ['headers.authorization', 'headers.x-example-signature', 'json.token', 'json.secret'],
            response: ['headers.set-cookie', 'json.token', 'json.secret', 'json.credentials'],
            error: ['headers.set-cookie', 'body.token', 'body.secret', 'body.credentials'],
          },
        },
      },
    },
  },
  resourceBindings: {
    remote_workspace: {
      kind: 'example.workspace',
      required: true,
      description: 'Remote workspace/tenant binding.',
    },
  },
  routes: {
    api: [
      {
        path: '/status',
        handler: './api/status',
        methods: ['GET'],
        auth: 'auth',
      },
    ],
  },
  actions: {
    callService: {
      handler: './actions/call-service',
      auth: 'auth',
      sideEffect: 'external',
      idempotency: { required: true, keyFrom: 'request' },
    },
  },
});
