import type { Metadata } from 'next';
import type { HostPageArea, HostPageRegistryEntry } from '@/lib/module-runtime/ui/host-page-registry';
import {
  HOST_PAGE_REGISTRY,
  getHostPageRegistryEntry,
} from '@/lib/module-runtime/ui/host-page-registry';
import type { ModulePageCachePresentation } from '@ploykit/module-sdk/presentation';
import { DEFAULT_LANGUAGE, localizedPath, type SupportedLanguage } from '../i18n';
import { createHostRequestContext, type HostRequestContext } from '../request-context';
import type { ModuleHostSession } from '@/lib/module-runtime';
import { requireAdminUser, requireHostUser } from '../auth';
import { requireCapability } from '../rbac';
import { resolvePagePresentation, type ResolvedPagePresentation } from './page-presentation';
import { createAnonymousModuleHostSession } from '@/lib/module-runtime';

export type RoutePresentationAccess = 'public' | 'auth' | 'admin';

export interface RoutePresentationManifestEntry {
  path: string;
  pageId: string;
  surfaceId: string;
  area: HostPageArea;
  shell: HostPageRegistryEntry['chrome'];
  metadata: {
    pageKey: string;
    canonicalPath: string;
    namespaces: readonly string[];
  };
  slots: readonly string[];
  cache: ModulePageCachePresentation;
  access: RoutePresentationAccess;
}

export interface RoutePresentationManifest {
  kind: 'ploykit.route-presentation.manifest';
  version: 1;
  defaultLanguage: SupportedLanguage;
  routes: readonly RoutePresentationManifestEntry[];
}

export interface RoutePresenterResult {
  manifest: RoutePresentationManifestEntry;
  context: HostRequestContext;
  presentation: ResolvedPagePresentation;
  metadata: Metadata;
}

const HOST_ROUTE_PATH_BY_PAGE_ID: Record<string, string> = {
  'site.home': '/',
  'site.pricing': '/pricing',
  'site.about': '/about',
  'site.contact': '/contact',
  'site.docs': '/docs',
  'site.privacy': '/privacy',
  'site.terms': '/terms',
  'site.success': '/success',
  'auth.login': '/login',
  'auth.register': '/register',
  'auth.forgotPassword': '/forgot-password',
  'auth.resetPassword': '/reset-password',
  'dashboard.home': '/dashboard',
  'dashboard.billing': '/dashboard/billing',
  'dashboard.credit-history': '/dashboard/credit-history',
  'dashboard.files': '/dashboard/files',
  'dashboard.notifications': '/dashboard/notifications',
  'dashboard.orders': '/dashboard/orders',
  'dashboard.profile': '/dashboard/profile',
  'dashboard.notification-settings': '/dashboard/settings/notifications',
  'dashboard.tasks': '/dashboard/tasks',
  'dashboard.task-detail': '/dashboard/tasks/:id',
  'dashboard.workspaces': '/dashboard/workspaces',
  'admin.overview': '/admin',
  'admin.analytics': '/admin/analytics',
  'admin.audit': '/admin/audit',
  'admin.billing': '/admin/billing',
  'admin.entitlements': '/admin/entitlements',
  'admin.files': '/admin/files',
  'admin.file-detail': '/admin/files/:fileId',
  'admin.modules': '/admin/modules',
  'admin.module-detail': '/admin/modules/:moduleId',
  'admin.module-route': '/admin/:modulePath*',
  'admin.rbac': '/admin/rbac',
  'admin.revenue': '/admin/revenue',
  'admin.runs': '/admin/runs',
  'admin.run-detail': '/admin/runs/:runId',
  'admin.search': '/admin/search',
  'admin.service-connections': '/admin/service-connections',
  'admin.settings': '/admin/settings',
  'admin.usage': '/admin/usage',
  'admin.users': '/admin/users',
  'admin.user-detail': '/admin/users/:userId',
  'admin.webhooks': '/admin/webhooks',
  'admin.webhook-detail': '/admin/webhooks/:outboxId',
  'dev.console': '/admin/module-dev-console',
};

function pageKeyFromPageId(pageId: string): string {
  const [, key] = pageId.split('.');
  return key ?? pageId;
}

function accessForPage(entry: HostPageRegistryEntry): RoutePresentationAccess {
  if (entry.area === 'admin' || entry.area === 'dev') {
    return 'admin';
  }
  if (entry.area === 'dashboard') {
    return 'auth';
  }
  return 'public';
}

function cacheForPage(entry: HostPageRegistryEntry): ModulePageCachePresentation {
  if (entry.area === 'auth') {
    return { mode: 'no-store' };
  }
  if (entry.area === 'dashboard' || entry.area === 'admin' || entry.area === 'dev') {
    return { mode: 'private' };
  }
  return { mode: 'public', revalidateSeconds: 300, tags: [entry.id] };
}

function createManifestEntry(entry: HostPageRegistryEntry): RoutePresentationManifestEntry {
  const path = HOST_ROUTE_PATH_BY_PAGE_ID[entry.id];
  if (!path) {
    throw new Error(`ROUTE_PRESENTATION_PATH_MISSING: ${entry.id}`);
  }
  return {
    path,
    pageId: entry.id,
    surfaceId: entry.surfaceId,
    area: entry.area,
    shell: entry.chrome,
    metadata: {
      pageKey: pageKeyFromPageId(entry.id),
      canonicalPath: path,
      namespaces: ['host', `page.${entry.id}`],
    },
    slots: entry.slots,
    cache: cacheForPage(entry),
    access: accessForPage(entry),
  };
}

function assertAuthenticatedSession(session: ModuleHostSession, pageId: string): void {
  if (!session.system && !session.user) {
    throw new Error(`ROUTE_PRESENTATION_AUTH_REQUIRED: ${pageId}`);
  }
}

function assertAdminSession(session: ModuleHostSession, pageId: string): void {
  try {
    requireCapability(session, 'admin.access');
  } catch {
    throw new Error(`ROUTE_PRESENTATION_ADMIN_REQUIRED: ${pageId}`);
  }
}

async function resolveRouteSession(
  manifest: RoutePresentationManifestEntry,
  input: {
    lang: SupportedLanguage;
    session?: ModuleHostSession;
    requireSession?: boolean;
  },
  requestPath: string
): Promise<ModuleHostSession> {
  if (input.requireSession === false) {
    return input.session ?? createAnonymousModuleHostSession();
  }

  if (input.session) {
    if (manifest.access === 'auth') {
      assertAuthenticatedSession(input.session, manifest.pageId);
    }
    if (manifest.access === 'admin') {
      assertAdminSession(input.session, manifest.pageId);
    }
    return input.session;
  }

  if (manifest.access === 'admin') {
    return requireAdminUser(input.lang, requestPath);
  }
  if (manifest.access === 'auth') {
    return requireHostUser(input.lang, requestPath);
  }
  return createAnonymousModuleHostSession();
}

export function createRoutePresentationManifest(): RoutePresentationManifest {
  return {
    kind: 'ploykit.route-presentation.manifest',
    version: 1,
    defaultLanguage: DEFAULT_LANGUAGE,
    routes: HOST_PAGE_REGISTRY.map(createManifestEntry),
  };
}

export function getRoutePresentationManifestEntry(
  pageId: string
): RoutePresentationManifestEntry {
  const entry = getHostPageRegistryEntry(pageId);
  if (!entry) {
    throw new Error(`ROUTE_PRESENTATION_PAGE_NOT_REGISTERED: ${pageId}`);
  }
  return createManifestEntry(entry);
}

export async function presentHostRoute(input: {
  pageId: string;
  lang: SupportedLanguage;
  session?: ModuleHostSession;
  workspaceId?: string | null;
  pathname?: string;
  requireSession?: boolean;
}): Promise<RoutePresenterResult> {
  const manifest = getRoutePresentationManifestEntry(input.pageId);
  const requestPath = input.pathname ?? localizedPath(input.lang, manifest.path);
  const session = await resolveRouteSession(manifest, input, requestPath);
  const context = createHostRequestContext({
    lang: input.lang,
    requestPath,
    session,
  });
  const presentation = await resolvePagePresentation({
    pageId: manifest.pageId,
    pathname: requestPath,
    lang: input.lang,
    workspaceId: input.workspaceId ?? context.workspaceId,
    session,
  });

  return {
    manifest,
    context,
    presentation,
    metadata: presentation.seo,
  };
}
