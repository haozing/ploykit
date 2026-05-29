import {
  createInMemoryRateLimiter,
  createRateLimitBucket,
  type RateLimitRule,
} from '@/lib/module-runtime/security/rate-limit';
import { createSecurityHeaders } from '@/lib/module-runtime/security/headers';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import { getAdminRegistryEntries, type AdminRegistryEntry } from './admin-route-registry';
import { defaultProductId } from './default-scope';

type HostRouteAuth = 'public' | 'user' | 'admin' | 'webhook' | 'module-runtime';
type HostRouteScope = 'none' | 'product' | 'workspace' | 'module-runtime';
type HostRouteCsrf = 'none' | 'same-origin' | 'signature' | 'module-runtime';
type HostRouteOrigin = 'none' | 'same-origin' | 'signature' | 'module-runtime';
type HostRouteCommercial = 'none' | 'local-or-provider' | 'module-runtime';
type HostRateLimitKind = 'public' | 'machine' | 'login' | 'high-cost';

export interface HostRouteRateLimit {
  kind: HostRateLimitKind;
  rule: RateLimitRule;
}

export interface HostRouteCatalogEntry {
  id: string;
  path: string;
  methods: readonly string[];
  auth: HostRouteAuth;
  scope: HostRouteScope;
  csrf: HostRouteCsrf;
  origin: HostRouteOrigin;
  rateLimit: HostRouteRateLimit | null;
  anonymousPolicy: 'allowed' | 'denied' | 'module-runtime';
  commercialPolicy: HostRouteCommercial;
}

export interface HostSecurityCheckOptions {
  session?: ModuleHostSession | null;
  cost?: number;
}

export interface HostApiRouteDescriptor {
  path: string;
  methods: readonly string[];
  file?: string;
}

export interface HostRouteSecurityAudit {
  ok: boolean;
  catalogEntries: number;
  actualRoutes: number;
  mutationCatalogEntries: number;
  duplicateRouteIds: string[];
  duplicateRouteMethods: string[];
  missingCatalogRoutes: HostApiRouteDescriptor[];
  catalogRoutesWithoutFiles: HostRouteCatalogEntry[];
  mutationRoutesWithoutCsrf: HostRouteCatalogEntry[];
  mutationRoutesWithoutOriginGuard: HostRouteCatalogEntry[];
  mutationRoutesWithoutRateLimit: HostRouteCatalogEntry[];
}

const MINUTE = 60_000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostRoute(input: HostRouteCatalogEntry): HostRouteCatalogEntry {
  return input;
}

function userRoute(
  id: string,
  path: string,
  methods: readonly string[],
  rateLimit: HostRouteRateLimit = { kind: 'public', rule: { limit: 120, windowMs: MINUTE } }
) {
  return hostRoute({
    id,
    path,
    methods,
    auth: 'user',
    scope: 'workspace',
    csrf: 'same-origin',
    origin: 'same-origin',
    rateLimit,
    anonymousPolicy: 'denied',
    commercialPolicy: 'none',
  });
}

function adminRouteRateLimit(rateLimit: AdminRegistryEntry['rateLimit']): HostRouteRateLimit | null {
  switch (rateLimit ?? 'machine') {
    case 'none':
      return null;
    case 'dangerous':
      return { kind: 'high-cost', rule: { limit: 20, windowMs: MINUTE } };
    case 'interactive':
      return { kind: 'public', rule: { limit: 60, windowMs: MINUTE } };
    case 'machine':
    default:
      return { kind: 'machine', rule: { limit: 120, windowMs: MINUTE } };
  }
}

function adminRoute(
  id: string,
  path: string,
  methods: readonly string[] = ['GET'],
  rateLimit: AdminRegistryEntry['rateLimit'] = 'machine'
) {
  return hostRoute({
    id,
    path,
    methods,
    auth: 'admin',
    scope: 'product',
    csrf: methods.some((method) => !SAFE_METHODS.has(method)) ? 'same-origin' : 'none',
    origin: methods.some((method) => !SAFE_METHODS.has(method)) ? 'same-origin' : 'none',
    rateLimit: adminRouteRateLimit(rateLimit),
    anonymousPolicy: 'denied',
    commercialPolicy: 'none',
  });
}

const USER_API_ROUTES = [
  userRoute('user.profile', '/api/user/profile', ['GET', 'PATCH']),
  userRoute('user.profile.avatar', '/api/user/profile/avatar', ['POST']),
  userRoute('user.profile.password', '/api/user/profile/password', ['POST'], {
    kind: 'high-cost',
    rule: { limit: 12, windowMs: 15 * MINUTE },
  }),
  userRoute('user.profile.preferences', '/api/user/profile/preferences', ['GET', 'PATCH']),
  userRoute('user.role', '/api/user/role', ['GET']),
] as const;

const AUTH_API_ROUTES = [
  hostRoute({
    id: 'auth.register',
    path: '/api/auth/register',
    methods: ['POST'],
    auth: 'public',
    scope: 'product',
    csrf: 'same-origin',
    origin: 'same-origin',
    rateLimit: { kind: 'login', rule: { limit: 12, windowMs: 15 * MINUTE } },
    anonymousPolicy: 'allowed',
    commercialPolicy: 'none',
  }),
  hostRoute({
    id: 'auth.passwordReset.request',
    path: '/api/auth/password-reset/request',
    methods: ['POST'],
    auth: 'public',
    scope: 'product',
    csrf: 'same-origin',
    origin: 'same-origin',
    rateLimit: { kind: 'login', rule: { limit: 12, windowMs: 15 * MINUTE } },
    anonymousPolicy: 'allowed',
    commercialPolicy: 'none',
  }),
  hostRoute({
    id: 'auth.passwordReset.confirm',
    path: '/api/auth/password-reset/confirm',
    methods: ['POST'],
    auth: 'public',
    scope: 'product',
    csrf: 'same-origin',
    origin: 'same-origin',
    rateLimit: { kind: 'high-cost', rule: { limit: 12, windowMs: 15 * MINUTE } },
    anonymousPolicy: 'allowed',
    commercialPolicy: 'none',
  }),
  hostRoute({
    id: 'auth.email.verify',
    path: '/api/auth/email/verify',
    methods: ['GET', 'POST'],
    auth: 'public',
    scope: 'product',
    csrf: 'same-origin',
    origin: 'same-origin',
    rateLimit: { kind: 'login', rule: { limit: 30, windowMs: 15 * MINUTE } },
    anonymousPolicy: 'allowed',
    commercialPolicy: 'none',
  }),
  userRoute('auth.sessions', '/api/auth/sessions', ['GET', 'DELETE']),
] as const;

const PRODUCT_SCOPE_API_ROUTES = [
  userRoute('productScope.current', '/api/product-scope/current', ['GET']),
  userRoute('productScope.products', '/api/product-scope/products', ['GET']),
  userRoute('productScope.workspaces', '/api/product-scope/workspaces', ['GET', 'POST']),
  userRoute('productScope.domainAliases', '/api/product-scope/domain-aliases', ['GET', 'POST']),
  userRoute('productScope.switch', '/api/product-scope/switch', ['POST']),
  userRoute('productScope.members', '/api/product-scope/[workspaceId]/members', ['GET', 'POST']),
  userRoute('productScope.invitations', '/api/product-scope/[workspaceId]/invitations', [
    'GET',
    'POST',
    'PATCH',
  ]),
] as const;

const NOTIFICATION_API_ROUTES = [
  userRoute('notifications.history', '/api/notifications/history', ['GET']),
  userRoute('notifications.unread', '/api/notifications/unread', ['GET']),
  userRoute('notifications.read', '/api/notifications/[notificationId]/read', ['POST']),
  userRoute('notifications.readAll', '/api/notifications/read-all', ['POST']),
  userRoute('notifications.preferences', '/api/notifications/preferences', ['GET', 'PATCH']),
] as const;

const BILLING_API_ROUTES = [
  userRoute('billing.orders', '/api/billing/orders', ['GET']),
  userRoute('billing.invoices', '/api/billing/invoices', ['GET']),
  userRoute('billing.paymentMethods', '/api/billing/payment-methods', ['GET']),
  userRoute('billing.subscriptions', '/api/billing/subscriptions', ['GET']),
  userRoute('billing.taxProfile', '/api/billing/tax-profile', ['GET', 'PATCH', 'POST']),
  userRoute('billing.portal', '/api/billing/portal', ['POST']),
] as const;

const ADMIN_API_ROUTES = getAdminRegistryEntries()
  .filter((entry) => entry.kind === 'api')
  .map((entry) =>
    adminRoute(
      `admin.${entry.id}`,
      entry.path,
      entry.methods && entry.methods.length > 0 ? entry.methods : ['GET'],
      entry.rateLimit
    )
  );

const ROUTE_CATALOG: readonly HostRouteCatalogEntry[] = [
  {
    id: 'contact.submit',
    path: '/api/contact',
    methods: ['POST'],
    auth: 'public',
    scope: 'product',
    csrf: 'same-origin',
    origin: 'same-origin',
    rateLimit: { kind: 'public', rule: { limit: 12, windowMs: 15 * MINUTE } },
    anonymousPolicy: 'allowed',
    commercialPolicy: 'none',
  },
  {
    id: 'auth.login',
    path: '/api/auth/login',
    methods: ['POST'],
    auth: 'public',
    scope: 'product',
    csrf: 'same-origin',
    origin: 'same-origin',
    rateLimit: { kind: 'login', rule: { limit: 20, windowMs: 15 * MINUTE } },
    anonymousPolicy: 'allowed',
    commercialPolicy: 'none',
  },
  {
    id: 'auth.session',
    path: '/api/auth/session',
    methods: ['GET'],
    auth: 'public',
    scope: 'product',
    csrf: 'none',
    origin: 'none',
    rateLimit: { kind: 'public', rule: { limit: 120, windowMs: MINUTE } },
    anonymousPolicy: 'allowed',
    commercialPolicy: 'none',
  },
  {
    id: 'auth.logout',
    path: '/api/auth/logout',
    methods: ['GET', 'POST'],
    auth: 'user',
    scope: 'product',
    csrf: 'same-origin',
    origin: 'same-origin',
    rateLimit: { kind: 'public', rule: { limit: 120, windowMs: MINUTE } },
    anonymousPolicy: 'allowed',
    commercialPolicy: 'none',
  },
  {
    id: 'files.collection',
    path: '/api/files',
    methods: ['GET', 'POST'],
    auth: 'user',
    scope: 'workspace',
    csrf: 'same-origin',
    origin: 'same-origin',
    rateLimit: { kind: 'public', rule: { limit: 90, windowMs: MINUTE } },
    anonymousPolicy: 'denied',
    commercialPolicy: 'none',
  },
  {
    id: 'files.item',
    path: '/api/files/[fileId]',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    auth: 'user',
    scope: 'workspace',
    csrf: 'same-origin',
    origin: 'same-origin',
    rateLimit: { kind: 'public', rule: { limit: 90, windowMs: MINUTE } },
    anonymousPolicy: 'denied',
    commercialPolicy: 'none',
  },
  {
    id: 'media.file',
    path: '/api/media/[fileId]',
    methods: ['GET'],
    auth: 'public',
    scope: 'workspace',
    csrf: 'none',
    origin: 'none',
    rateLimit: { kind: 'public', rule: { limit: 180, windowMs: MINUTE } },
    anonymousPolicy: 'allowed',
    commercialPolicy: 'none',
  },
  {
    id: 'billing.checkout',
    path: '/api/billing/checkout',
    methods: ['POST'],
    auth: 'user',
    scope: 'workspace',
    csrf: 'same-origin',
    origin: 'same-origin',
    rateLimit: { kind: 'high-cost', rule: { limit: 20, windowMs: MINUTE } },
    anonymousPolicy: 'denied',
    commercialPolicy: 'local-or-provider',
  },
  {
    id: 'billing.stripeWebhook',
    path: '/api/billing/stripe/webhook',
    methods: ['POST'],
    auth: 'webhook',
    scope: 'product',
    csrf: 'signature',
    origin: 'signature',
    rateLimit: { kind: 'machine', rule: { limit: 240, windowMs: MINUTE } },
    anonymousPolicy: 'allowed',
    commercialPolicy: 'local-or-provider',
  },
  {
    id: 'module.api',
    path: '/api/modules/[...path]',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    auth: 'module-runtime',
    scope: 'module-runtime',
    csrf: 'module-runtime',
    origin: 'same-origin',
    rateLimit: { kind: 'public', rule: { limit: 180, windowMs: MINUTE } },
    anonymousPolicy: 'module-runtime',
    commercialPolicy: 'module-runtime',
  },
  {
    id: 'module.action',
    path: '/api/module-actions/[moduleId]/[name]',
    methods: ['POST'],
    auth: 'module-runtime',
    scope: 'module-runtime',
    csrf: 'module-runtime',
    origin: 'same-origin',
    rateLimit: { kind: 'high-cost', rule: { limit: 60, windowMs: MINUTE } },
    anonymousPolicy: 'module-runtime',
    commercialPolicy: 'module-runtime',
  },
  {
    id: 'module.webhook',
    path: '/api/module-webhooks/[...path]',
    methods: ['POST'],
    auth: 'webhook',
    scope: 'module-runtime',
    csrf: 'signature',
    origin: 'signature',
    rateLimit: { kind: 'machine', rule: { limit: 240, windowMs: MINUTE } },
    anonymousPolicy: 'module-runtime',
    commercialPolicy: 'module-runtime',
  },
  {
    id: 'worker.enqueue',
    path: '/api/worker/enqueue',
    methods: ['POST'],
    auth: 'admin',
    scope: 'workspace',
    csrf: 'same-origin',
    origin: 'same-origin',
    rateLimit: { kind: 'machine', rule: { limit: 60, windowMs: MINUTE } },
    anonymousPolicy: 'denied',
    commercialPolicy: 'none',
  },
  {
    id: 'worker.drain',
    path: '/api/worker/drain',
    methods: ['POST'],
    auth: 'admin',
    scope: 'workspace',
    csrf: 'same-origin',
    origin: 'same-origin',
    rateLimit: { kind: 'machine', rule: { limit: 60, windowMs: MINUTE } },
    anonymousPolicy: 'denied',
    commercialPolicy: 'none',
  },
  {
    id: 'worker.status',
    path: '/api/worker/status',
    methods: ['GET'],
    auth: 'admin',
    scope: 'workspace',
    csrf: 'none',
    origin: 'none',
    rateLimit: { kind: 'machine', rule: { limit: 120, windowMs: MINUTE } },
    anonymousPolicy: 'denied',
    commercialPolicy: 'none',
  },
  ...AUTH_API_ROUTES,
  ...USER_API_ROUTES,
  ...PRODUCT_SCOPE_API_ROUTES,
  ...NOTIFICATION_API_ROUTES,
  ...BILLING_API_ROUTES,
  ...ADMIN_API_ROUTES,
] as const;

const rateLimiter = createInMemoryRateLimiter();

function routeById(routeId: string): HostRouteCatalogEntry {
  const route = ROUTE_CATALOG.find((entry) => entry.id === routeId);
  if (!route) {
    throw new Error(`Unknown host security route: ${routeId}`);
  }

  return route;
}

function addOriginValue(allowed: Set<string>, value: string | null | undefined, protocol: string): void {
  const raw = value?.split(',')[0]?.trim();
  if (!raw) {
    return;
  }

  try {
    allowed.add(new URL(raw).origin);
    return;
  } catch {
    // Host headers are usually authority values like "127.0.0.1:3000".
  }

  try {
    allowed.add(new URL(`${protocol}//${raw}`).origin);
  } catch {
    allowed.add(raw);
  }
}

function envAllowedOrigins(request: Request): Set<string> {
  const allowed = new Set<string>([new URL(request.url).origin]);
  const requestUrl = new URL(request.url);
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProto ? `${forwardedProto.replace(/:$/, '')}:` : requestUrl.protocol;
  addOriginValue(allowed, request.headers.get('host'), protocol);
  addOriginValue(allowed, request.headers.get('x-forwarded-host'), protocol);
  for (const value of [
    process.env.PLOYKIT_HOST_URL,
    process.env.HOST_ALLOWED_ORIGINS,
    process.env.PLOYKIT_ALLOWED_ORIGINS,
  ]) {
    for (const part of (value ?? '').split(',')) {
      const raw = part.trim();
      if (!raw) {
        continue;
      }
      try {
        allowed.add(new URL(raw).origin);
      } catch {
        allowed.add(raw);
      }
    }
  }

  return allowed;
}

function originFromRequest(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (origin) {
    return origin;
  }

  const referer = request.headers.get('referer');
  if (!referer) {
    return null;
  }

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function ipPrefix(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || request.headers.get('x-real-ip')?.trim();
  if (!ip) {
    return null;
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    return `${ip.split('.').slice(0, 3).join('.')}.0/24`;
  }

  if (ip.includes(':')) {
    return `${ip.split(':').slice(0, 4).join(':')}::/64`;
  }

  return ip;
}

function jsonSecurityResponse(
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {}
): Response {
  return Response.json({ ok: false, code, message }, { status, headers });
}

function checkOrigin(request: Request, route: HostRouteCatalogEntry): Response | null {
  if (SAFE_METHODS.has(request.method.toUpperCase()) || route.origin !== 'same-origin') {
    return null;
  }

  const origin = originFromRequest(request);
  if (!origin) {
    return process.env.PLOYKIT_STRICT_ORIGIN === '1'
      ? jsonSecurityResponse(403, 'HOST_ORIGIN_REQUIRED', 'Request origin is required.')
      : null;
  }

  if (origin === 'null' || !envAllowedOrigins(request).has(origin)) {
    return jsonSecurityResponse(403, 'HOST_ORIGIN_DENIED', 'Request origin is not allowed.');
  }

  return null;
}

function checkRateLimit(
  request: Request,
  route: HostRouteCatalogEntry,
  options: HostSecurityCheckOptions
): Response | null {
  if (!route.rateLimit) {
    return null;
  }

  const result = rateLimiter.check({
    bucket: createRateLimitBucket({
      kind: route.rateLimit.kind,
      productId: defaultProductId(options.session?.productId),
      workspaceId: options.session?.workspaceId,
      userId: options.session?.userId,
      ipPrefix: ipPrefix(request),
      route: route.id,
    }),
    rule: route.rateLimit.rule,
    cost: options.cost,
  });
  if (result.ok) {
    return null;
  }

  const resetAt = new Date(result.resetAt).getTime();
  const retryAfter = Number.isFinite(resetAt)
    ? Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
    : 60;
  return jsonSecurityResponse(429, 'HOST_RATE_LIMITED', 'Too many requests.', {
    'retry-after': String(retryAfter),
    'x-ratelimit-reset': result.resetAt,
  });
}

export function getHostRouteCatalog(): readonly HostRouteCatalogEntry[] {
  return ROUTE_CATALOG;
}

export function getHostRouteSecurityEntry(routeId: string): HostRouteCatalogEntry {
  return routeById(routeId);
}

function routeMethodKey(path: string, method: string): string {
  return `${path} ${method.toUpperCase()}`;
}

function catalogMethodKeys(route: HostRouteCatalogEntry): string[] {
  return route.methods.map((method) => routeMethodKey(route.path, method));
}

export function auditHostRouteSecurityCatalog(
  actualRoutes: readonly HostApiRouteDescriptor[] = []
): HostRouteSecurityAudit {
  const routeIds = new Map<string, number>();
  const routeMethods = new Map<string, number>();
  for (const route of ROUTE_CATALOG) {
    routeIds.set(route.id, (routeIds.get(route.id) ?? 0) + 1);
    for (const key of catalogMethodKeys(route)) {
      routeMethods.set(key, (routeMethods.get(key) ?? 0) + 1);
    }
  }

  const catalogMethodSet = new Set(routeMethods.keys());
  const actualMethodSet = new Set<string>();
  const missingCatalogRoutes: HostApiRouteDescriptor[] = [];
  for (const route of actualRoutes) {
    const missingMethods = route.methods.filter(
      (method) => !catalogMethodSet.has(routeMethodKey(route.path, method))
    );
    if (missingMethods.length > 0) {
      missingCatalogRoutes.push({ ...route, methods: missingMethods });
    }
    for (const method of route.methods) {
      actualMethodSet.add(routeMethodKey(route.path, method));
    }
  }

  const catalogRoutesWithoutFiles =
    actualRoutes.length === 0
      ? []
      : ROUTE_CATALOG.filter((route) =>
          catalogMethodKeys(route).some((key) => !actualMethodSet.has(key))
        );
  const mutationRoutes = ROUTE_CATALOG.filter((route) =>
    route.methods.some((method) => !SAFE_METHODS.has(method))
  );
  const mutationRoutesWithoutCsrf = mutationRoutes.filter((route) => route.csrf === 'none');
  const mutationRoutesWithoutOriginGuard = mutationRoutes.filter((route) => route.origin === 'none');
  const mutationRoutesWithoutRateLimit = mutationRoutes.filter((route) => !route.rateLimit);
  const duplicateRouteIds = [...routeIds.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  const duplicateRouteMethods = [...routeMethods.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key);

  return {
    ok:
      duplicateRouteIds.length === 0 &&
      duplicateRouteMethods.length === 0 &&
      missingCatalogRoutes.length === 0 &&
      catalogRoutesWithoutFiles.length === 0 &&
      mutationRoutesWithoutCsrf.length === 0 &&
      mutationRoutesWithoutOriginGuard.length === 0 &&
      mutationRoutesWithoutRateLimit.length === 0,
    catalogEntries: ROUTE_CATALOG.length,
    actualRoutes: actualRoutes.length,
    mutationCatalogEntries: mutationRoutes.length,
    duplicateRouteIds,
    duplicateRouteMethods,
    missingCatalogRoutes,
    catalogRoutesWithoutFiles,
    mutationRoutesWithoutCsrf,
    mutationRoutesWithoutOriginGuard,
    mutationRoutesWithoutRateLimit,
  };
}

export function resetHostSecurityRateLimiter(): void {
  rateLimiter.reset();
}

export async function checkHostRouteSecurity(
  request: Request,
  routeId: string,
  options: HostSecurityCheckOptions = {}
): Promise<Response | null> {
  const route = routeById(routeId);
  const method = request.method.toUpperCase();
  if (!route.methods.some((candidate) => candidate.toUpperCase() === method)) {
    return jsonSecurityResponse(405, 'HOST_ROUTE_METHOD_UNREGISTERED', 'Route method is not registered.');
  }
  return checkOrigin(request, route) ?? checkRateLimit(request, route, options);
}

export function getHostSecurityHeaders(): Record<string, string> {
  const headers = createSecurityHeaders();
  return Object.fromEntries(Object.entries(headers).filter(([, value]) => value.length > 0));
}
