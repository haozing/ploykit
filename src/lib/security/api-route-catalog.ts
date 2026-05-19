export const API_HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const;
export type ApiHttpMethod = (typeof API_HTTP_METHODS)[number];

export const API_STATE_CHANGING_METHODS: readonly ApiHttpMethod[] = [
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
];

export type ApiAccessClass =
  | 'public'
  | 'authenticated'
  | 'admin'
  | 'debug'
  | 'webhook'
  | 'auth-provider'
  | 'plugin-gateway';

export type ApiMutationProtection =
  | 'none'
  | 'csrf-origin'
  | 'rate-limit+csrf-origin'
  | 'webhook-signature'
  | 'webhook-signature+rate-limit'
  | 'provider-managed'
  | 'provider-managed+rate-limit'
  | 'plugin-contract'
  | 'rate-limit+plugin-contract';

export interface ApiRouteMethodPolicy {
  access: ApiAccessClass;
  mutationProtection: ApiMutationProtection;
  guard: string;
  notes?: string;
}

export interface ApiRouteCatalogEntry {
  id: string;
  pattern: string;
  owner: string;
  defaultPolicy?: ApiRouteMethodPolicy;
  methods?: Partial<Record<ApiHttpMethod, ApiRouteMethodPolicy>>;
  notes?: string;
}

const publicRead: ApiRouteMethodPolicy = {
  access: 'public',
  mutationProtection: 'none',
  guard: 'public-read',
};

const authenticatedMutation: ApiRouteMethodPolicy = {
  access: 'authenticated',
  mutationProtection: 'csrf-origin',
  guard: 'withAuth + global api security middleware',
};

const authenticatedRateLimitedMutation: ApiRouteMethodPolicy = {
  access: 'authenticated',
  mutationProtection: 'rate-limit+csrf-origin',
  guard: 'withAuth + global api security middleware + global api rate limiter',
};

const adminPolicy: ApiRouteMethodPolicy = {
  access: 'admin',
  mutationProtection: 'csrf-origin',
  guard: 'withAdminGuard + global api security middleware',
};

const debugPolicy: ApiRouteMethodPolicy = {
  access: 'debug',
  mutationProtection: 'csrf-origin',
  guard: 'debug guard + global api security middleware',
  notes: 'Production requests are blocked with 404 by the global API middleware.',
};

export const API_ROUTE_CATALOG: readonly ApiRouteCatalogEntry[] = [
  {
    id: 'auth-provider',
    pattern: '/api/auth/[...all]',
    owner: 'auth',
    methods: {
      GET: {
        access: 'auth-provider',
        mutationProtection: 'provider-managed+rate-limit',
        guard: 'Better Auth route handler + global api rate limiter',
      },
      POST: {
        access: 'auth-provider',
        mutationProtection: 'provider-managed+rate-limit',
        guard: 'Better Auth route handler + global api rate limiter',
      },
    },
    notes: 'Better Auth owns its sub-route contract.',
  },
  {
    id: 'stripe-webhook',
    pattern: '/api/webhooks/stripe',
    owner: 'billing',
    methods: {
      GET: publicRead,
      POST: {
        access: 'webhook',
        mutationProtection: 'webhook-signature+rate-limit',
        guard: 'Stripe signature verification + provider-aware global api rate limiter',
      },
    },
  },
  {
    id: 'debug',
    pattern: '/api/debug/**',
    owner: 'platform',
    defaultPolicy: debugPolicy,
  },
  {
    id: 'outbox-dead-letters',
    pattern: '/api/admin/outbox/dead-letters',
    owner: 'platform',
    methods: {
      GET: {
        access: 'admin',
        mutationProtection: 'none',
        guard: 'withAdminGuard',
        notes: 'Read-only failed outbox entry inspection.',
      },
      POST: {
        access: 'admin',
        mutationProtection: 'csrf-origin',
        guard: 'withAdminGuard + global api security middleware',
        notes: 'Bulk replays, ignores, or archives failed outbox entries.',
      },
    },
  },
  {
    id: 'outbox-dead-letter-replay',
    pattern: '/api/admin/outbox/dead-letters/[id]/replay',
    owner: 'platform',
    methods: {
      POST: {
        access: 'admin',
        mutationProtection: 'csrf-origin',
        guard: 'withAdminGuard + global api security middleware',
        notes: 'Resets a failed outbox entry to pending for replay.',
      },
    },
  },
  {
    id: 'webhook-receipt-retry',
    pattern: '/api/admin/webhooks/retry',
    owner: 'platform',
    methods: {
      GET: {
        access: 'admin',
        mutationProtection: 'none',
        guard: 'withAdminGuard',
        notes: 'Read-only retryable webhook receipt inspection for operations UI.',
      },
      POST: {
        access: 'admin',
        mutationProtection: 'csrf-origin',
        guard: 'withAdminGuard + global api security middleware',
        notes: 'Manually retries durable webhook receipts for single-instance cron or operations.',
      },
    },
  },
  {
    id: 'webhook-receipt-retry-detail',
    pattern: '/api/admin/webhooks/retry/[id]',
    owner: 'platform',
    methods: {
      GET: {
        access: 'admin',
        mutationProtection: 'none',
        guard: 'withAdminGuard',
        notes: 'Read-only webhook receipt retry detail and retry history.',
      },
      POST: {
        access: 'admin',
        mutationProtection: 'csrf-origin',
        guard: 'withAdminGuard + global api security middleware',
        notes: 'Manually retries one durable webhook receipt.',
      },
    },
  },
  {
    id: 'admin-analytics-reliability',
    pattern: '/api/admin/analytics/reliability',
    owner: 'analytics',
    methods: {
      GET: {
        access: 'admin',
        mutationProtection: 'none',
        guard: 'withAdminGuard',
        notes: 'Read-only reliability analytics for outbox, webhook receipts, and plugin jobs.',
      },
    },
  },
  {
    id: 'admin',
    pattern: '/api/admin/**',
    owner: 'admin',
    defaultPolicy: adminPolicy,
  },
  {
    id: 'files',
    pattern: '/api/files',
    owner: 'storage',
    methods: {
      GET: {
        access: 'authenticated',
        mutationProtection: 'none',
        guard: 'withAuth',
        notes: 'Lists files owned by the current user.',
      },
      POST: authenticatedMutation,
    },
  },
  {
    id: 'file-detail',
    pattern: '/api/files/[id]',
    owner: 'storage',
    methods: {
      GET: {
        access: 'authenticated',
        mutationProtection: 'none',
        guard: 'withAuth',
        notes: 'Returns metadata or downloads a file owned by the current user.',
      },
      DELETE: authenticatedMutation,
    },
  },
  {
    id: 'plugin-file-signed-transfer',
    pattern: '/api/plugin-files/[id]/[operation]',
    owner: 'plugins',
    methods: {
      GET: {
        access: 'plugin-gateway',
        mutationProtection: 'plugin-contract',
        guard: 'plugin file signed URL verification',
        notes: 'Downloads ready plugin files using short-lived signed URLs.',
      },
      POST: {
        access: 'plugin-gateway',
        mutationProtection: 'rate-limit+plugin-contract',
        guard: 'plugin file signed URL verification + global api rate limiter',
        notes: 'Completes pending plugin uploads using short-lived signed URLs.',
      },
      PUT: {
        access: 'plugin-gateway',
        mutationProtection: 'rate-limit+plugin-contract',
        guard: 'plugin file signed URL verification + global api rate limiter',
        notes: 'Completes pending plugin uploads using short-lived signed URLs.',
      },
    },
  },
  {
    id: 'plugin-public-media',
    pattern: '/api/plugin-media/[pluginId]/[publicId]/**',
    owner: 'plugins',
    methods: {
      GET: {
        access: 'public',
        mutationProtection: 'none',
        guard: 'published plugin file visibility + ready status',
        notes: 'Serves only plugin files explicitly published through ctx.files.publish().',
      },
    },
  },
  {
    id: 'plugin-assets',
    pattern: '/api/plugin-assets/[pluginId]/**',
    owner: 'plugins',
    methods: {
      GET: {
        access: 'plugin-gateway',
        mutationProtection: 'plugin-contract',
        guard: 'plugin asset declaration + plugin root boundary',
        notes: 'Serves only plugin assets declared in plugin.ts resources.assets.',
      },
    },
  },
  {
    id: 'plugin-runs',
    pattern: '/api/plugin-runs',
    owner: 'plugins',
    methods: {
      GET: {
        access: 'authenticated',
        mutationProtection: 'none',
        guard: 'withAuth',
        notes: 'Lists user-visible plugin task center runs for the current user.',
      },
    },
  },
  {
    id: 'plugin-run-detail',
    pattern: '/api/plugin-runs/[id]',
    owner: 'plugins',
    methods: {
      GET: {
        access: 'authenticated',
        mutationProtection: 'none',
        guard: 'withAuth',
        notes: 'Returns one user-visible plugin run with logs, files, connector calls, and usage.',
      },
    },
  },
  {
    id: 'plugin-run-cancel',
    pattern: '/api/plugin-runs/[id]/cancel',
    owner: 'plugins',
    methods: {
      POST: authenticatedMutation,
    },
  },
  {
    id: 'product-scope',
    pattern: '/api/product-scope',
    owner: 'platform',
    methods: {
      GET: {
        access: 'authenticated',
        mutationProtection: 'none',
        guard: 'withAuth',
        notes: 'Lists product scopes available to the current user.',
      },
      POST: {
        ...authenticatedMutation,
        notes: 'Creates a new product scope backed by a workspace.',
      },
    },
  },
  {
    id: 'product-scope-current',
    pattern: '/api/product-scope/current',
    owner: 'platform',
    methods: {
      GET: {
        access: 'authenticated',
        mutationProtection: 'none',
        guard: 'withAuth',
        notes: 'Returns the product scope profile and current selected workspace.',
      },
    },
  },
  {
    id: 'product-scope-switch',
    pattern: '/api/product-scope/switch',
    owner: 'platform',
    methods: {
      POST: {
        ...authenticatedMutation,
        notes: 'Stores the current user preferred workspace for a product scope.',
      },
    },
  },
  {
    id: 'product-scope-members',
    pattern: '/api/product-scope/[workspaceId]/members',
    owner: 'platform',
    methods: {
      GET: {
        access: 'authenticated',
        mutationProtection: 'none',
        guard: 'withAuth + product scope role check',
        notes: 'Lists active members for a product scope workspace.',
      },
    },
  },
  {
    id: 'product-scope-invitations',
    pattern: '/api/product-scope/[workspaceId]/invitations',
    owner: 'platform',
    methods: {
      POST: {
        ...authenticatedMutation,
        guard: 'withAuth + product scope admin role check + global api security middleware',
        notes: 'Invites a user to a product scope workspace.',
      },
    },
  },
  {
    id: 'admin-plugin-operations',
    pattern: '/api/admin/plugin-operations/**',
    owner: 'plugins',
    defaultPolicy: adminPolicy,
    notes: 'Admin runtime operations for plugin tasks, connectors, and metering.',
  },
  {
    id: 'plugin-management',
    pattern: '/api/plugins',
    owner: 'plugins',
    methods: {
      POST: {
        access: 'admin',
        mutationProtection: 'rate-limit+csrf-origin',
        guard: 'withAdminGuard + global api security middleware + global api rate limiter',
      },
    },
  },
  {
    id: 'plugin-webhook-runtime',
    pattern: '/api/plugins/[pluginId]/webhooks/**',
    owner: 'plugins',
    defaultPolicy: {
      access: 'webhook',
      mutationProtection: 'webhook-signature+rate-limit',
      guard:
        'plugin runtime webhook contract + Permission.WebhookReceive + global api rate limiter',
      notes:
        'Public plugin webhook callbacks are dispatched only through plugin.ts webhooks and runtime permission checks.',
    },
  },
  {
    id: 'plugin-gateway',
    pattern: '/api/plugins/[...slug]',
    owner: 'plugins',
    defaultPolicy: {
      access: 'plugin-gateway',
      mutationProtection: 'rate-limit+plugin-contract',
      guard:
        'plugin runtime contract route guard + global api security middleware + global api rate limiter',
      notes:
        'The plugin gateway resolves the plugin route, method, layout, and guard before dispatch.',
    },
  },
  {
    id: 'user',
    pattern: '/api/user/**',
    owner: 'user',
    defaultPolicy: authenticatedMutation,
    notes:
      'Safe reads still require withAuth; state changes are covered by the global API middleware.',
  },
  {
    id: 'usage',
    pattern: '/api/usage/[userId]',
    owner: 'entitlements',
    methods: {
      GET: {
        access: 'authenticated',
        mutationProtection: 'none',
        guard: 'withAuth + owner-or-admin check',
        notes: 'Returns usage summary for the current user or an admin-selected user.',
      },
    },
  },
  {
    id: 'user-profile-avatar',
    pattern: '/api/user/profile/avatar',
    owner: 'user',
    methods: {
      POST: authenticatedMutation,
    },
  },
  {
    id: 'user-profile-password',
    pattern: '/api/user/profile/password',
    owner: 'user',
    methods: {
      GET: {
        access: 'authenticated',
        mutationProtection: 'none',
        guard: 'withAuth',
        notes: 'Returns whether the current account already has password credentials.',
      },
      POST: authenticatedMutation,
    },
  },
  {
    id: 'notifications-preferences',
    pattern: '/api/notifications/preferences',
    owner: 'notifications',
    methods: {
      GET: {
        access: 'authenticated',
        mutationProtection: 'none',
        guard: 'withAuth',
      },
      PUT: authenticatedMutation,
    },
  },
  {
    id: 'notifications-read-all',
    pattern: '/api/notifications/read-all',
    owner: 'notifications',
    methods: {
      POST: authenticatedMutation,
    },
  },
  {
    id: 'notifications-history',
    pattern: '/api/notifications/history',
    owner: 'notifications',
    methods: {
      GET: {
        access: 'authenticated',
        mutationProtection: 'none',
        guard: 'withAuth',
      },
    },
  },
  {
    id: 'notifications-unread',
    pattern: '/api/notifications/unread',
    owner: 'notifications',
    methods: {
      GET: {
        access: 'authenticated',
        mutationProtection: 'none',
        guard: 'withAuth',
      },
    },
  },
  {
    id: 'notifications-test',
    pattern: '/api/notifications/test',
    owner: 'notifications',
    methods: {
      POST: authenticatedMutation,
    },
  },
  {
    id: 'notification-detail',
    pattern: '/api/notifications/[id]',
    owner: 'notifications',
    methods: {
      PATCH: authenticatedMutation,
      DELETE: authenticatedMutation,
    },
  },
  {
    id: 'billing-portal',
    pattern: '/api/billing/portal',
    owner: 'billing',
    methods: {
      POST: authenticatedRateLimitedMutation,
    },
  },
  {
    id: 'checkout',
    pattern: '/api/checkout/create',
    owner: 'billing',
    methods: {
      POST: {
        ...authenticatedRateLimitedMutation,
      },
    },
  },
  {
    id: 'billing-backoffice',
    pattern: '/api/billing/**',
    owner: 'billing',
    defaultPolicy: adminPolicy,
    notes: 'Backoffice billing mock/service routes are admin-only until moved under /api/admin.',
  },
  {
    id: 'contact',
    pattern: '/api/contact',
    owner: 'support',
    methods: {
      POST: {
        access: 'public',
        mutationProtection: 'rate-limit+csrf-origin',
        guard: 'withRateLimit + global api security middleware',
      },
    },
  },
  {
    id: 'plans-public-list',
    pattern: '/api/plans',
    owner: 'entitlements',
    methods: {
      GET: publicRead,
      POST: adminPolicy,
    },
  },
  {
    id: 'plans-public-detail',
    pattern: '/api/plans/[id]',
    owner: 'entitlements',
    methods: {
      GET: publicRead,
      PUT: adminPolicy,
      DELETE: adminPolicy,
    },
  },
];

export function isApiStateChangingMethod(method: string): boolean {
  return API_STATE_CHANGING_METHODS.includes(method.toUpperCase() as ApiHttpMethod);
}

export function isApiHttpMethod(method: string): method is ApiHttpMethod {
  return API_HTTP_METHODS.includes(method as ApiHttpMethod);
}

function splitRoutePath(routePath: string): string[] {
  return routePath.split('/').filter(Boolean);
}

export function apiRoutePatternMatches(pattern: string, routePath: string): boolean {
  const patternSegments = splitRoutePath(pattern);
  const routeSegments = splitRoutePath(routePath);

  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index];
    const routeSegment = routeSegments[index];

    if (patternSegment === '**') {
      return true;
    }

    if (!routeSegment) {
      return false;
    }

    if (patternSegment.startsWith('[...') && patternSegment.endsWith(']')) {
      return routeSegments.length >= index + 1;
    }

    if (patternSegment.startsWith('[') && patternSegment.endsWith(']')) {
      continue;
    }

    if (patternSegment !== routeSegment) {
      return false;
    }
  }

  return routeSegments.length === patternSegments.length;
}

export function getApiRouteCatalogEntry(routePath: string): ApiRouteCatalogEntry | undefined {
  return API_ROUTE_CATALOG.find((entry) => apiRoutePatternMatches(entry.pattern, routePath));
}

export function resolveApiRoutePolicy(
  routePath: string,
  method: string
): ApiRouteMethodPolicy | undefined {
  const normalizedMethod = method.toUpperCase();
  if (!isApiHttpMethod(normalizedMethod)) {
    return undefined;
  }

  const entry = getApiRouteCatalogEntry(routePath);
  return entry?.methods?.[normalizedMethod] ?? entry?.defaultPolicy;
}
