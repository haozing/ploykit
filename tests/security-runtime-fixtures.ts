import {
  action,
  defineApi,
  defineModule,
  Permission,
  type ModuleContext,
} from '@ploykit/module-sdk';
import type { ModuleMapArtifact } from '../src/lib/module-runtime';

let secureApiLoadCount = 0;
let missingPermissionApiLoadCount = 0;
let paidActionLoadCount = 0;

export function resetSecurityFixtureLoadCounts(): void {
  secureApiLoadCount = 0;
  missingPermissionApiLoadCount = 0;
  paidActionLoadCount = 0;
}

export function getSecurityFixtureLoadCounts(): {
  secureApi: number;
  missingPermissionApi: number;
  paidAction: number;
} {
  return {
    secureApi: secureApiLoadCount,
    missingPermissionApi: missingPermissionApiLoadCount,
    paidAction: paidActionLoadCount,
  };
}

const securityModule = defineModule({
  id: 'security-test',
  name: 'Security Test Module',
  version: '0.1.0',
  permissions: [
    Permission.DataDocumentRead,
    Permission.DataTableRead,
    Permission.SurfaceContribute,
    Permission.ConfigRead,
    Permission.SecretsRead,
    Permission.AuditWrite,
    Permission.CreditsConsume,
  ],
  config: {
    feature: {
      type: 'string',
    },
    token: {
      type: 'string',
      secret: true,
    },
  },
  routes: {
    dashboard: [
      {
        path: '/paid',
        component: './pages/PaidPage',
        auth: 'auth',
        commercial: {
          entitlements: ['pro'],
        },
      },
    ],
    api: [
      {
        path: '/secure',
        handler: './api/secure',
        auth: 'auth',
        permissions: [Permission.DataDocumentRead],
      },
      {
        path: '/missing-permission',
        handler: './api/missing-permission',
        auth: 'auth',
        permissions: [Permission.DataTableRead],
      },
      {
        path: '/capabilities',
        handler: './api/capabilities',
        auth: 'auth',
      },
    ],
  },
  actions: {
    paidAction: {
      handler: './actions/paid-action',
      auth: 'auth',
      commercial: {
        entitlements: ['pro'],
      },
    },
  },
  navigation: [
    {
      location: 'dashboard.sidebar',
      fallbackLabel: 'Paid',
      path: '/paid',
      requires: {
        entitlements: ['pro'],
        serviceConnections: ['github'],
        scopeRoles: ['owner'],
      },
    },
  ],
  surfaces: {
    'dashboard.home:widgets': {
      mode: 'panel',
      component: './surfaces/SecureWidget',
      permissions: [Permission.SurfaceContribute],
      visibility: {
        mode: 'permission',
        permission: Permission.DataDocumentRead,
      },
    },
  },
});

export const securityArtifact: ModuleMapArtifact = {
  kind: 'source',
  modules: {
    'security-test': {
      module: async () => ({ default: securityModule }),
      apis: {
        'api/secure': async () => {
          secureApiLoadCount += 1;
          return {
            default: defineApi({
              get(ctx) {
                return ctx.json({
                  ok: true,
                  productId: ctx.scope.productId,
                  workspaceId: ctx.scope.workspaceId,
                });
              },
            }),
          };
        },
        'api/missing-permission': async () => {
          missingPermissionApiLoadCount += 1;
          return {
            default: defineApi({
              get(ctx) {
                return ctx.json({ ok: true });
              },
            }),
          };
        },
        'api/capabilities': async () => ({
          default: defineApi({
            async get(ctx) {
              const feature = await ctx.config.require<string>('feature');
              const token = await ctx.secrets.require('token');
              await ctx.audit.record('capabilities.read', { feature });
              return ctx.json({
                ok: true,
                feature,
                tokenLength: token.length,
              });
            },
          }),
        }),
      },
      actions: {
        'actions/paid-action': async () => {
          paidActionLoadCount += 1;
          return {
            default: action<ModuleContext, undefined, { ok: true }>(async () => ({ ok: true })),
          };
        },
      },
      pages: {
        'pages/PaidPage': async () => ({
          default: function PaidPage() {
            return { view: 'paid' };
          },
        }),
      },
      surfaces: {
        'surfaces/SecureWidget': async () => ({ default: function SecureWidget() {} }),
      },
    },
  },
};
