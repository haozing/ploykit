import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppFrame } from '@host/components/layout/AppFrame';
import { ErrorPanel } from '@host/components/layout/ErrorPanel';
import { PageShell } from '@host/components/layout/PageShell';
import type { NavGroup, NavItem } from '@host/components/layout/types';
import { ModuleValue } from '@host/components/ModuleValue';
import { ProductScopeSwitcher } from '@host/components/ProductScopeSwitcher';
import { ProductThemeStyle } from '@host/components/theme/ProductThemeStyle';
import { requireHostUser } from '@host/lib/auth';
import {
  DEFAULT_LANGUAGE,
  HOST_LANGUAGE_HEADER,
  languageFromHeaders,
  localizedPath,
  type SupportedLanguage,
} from '@host/lib/i18n';
import { dashboardInlineText } from '@host/lib/dashboard-copy';
import { applyModuleSelfServiceSessionPermissions } from '@host/lib/create-host';
import { getModuleHost } from '@host/lib/module-host';
import { createHostRequest, dashboardHref, modulePathFromSegments } from '@host/lib/paths';
import {
  createScopedDemoHostSession,
  listDemoWorkspaces,
  resolveDemoProductScope,
} from '@host/lib/product-scope';
import { getProductThemeRuntimeView } from '@host/lib/product-composition';
import { renderDashboardSurface, renderPageComponent } from '@host/lib/rendering';
import type {
  ModuleHost,
  ModuleHostSession,
  ResolveModulePageRouteResult,
} from '@/lib/module-runtime';
import { translateModuleMessage } from '@/lib/module-runtime/i18n';

export const dynamic = 'force-dynamic';
const privateDashboardRobots: Metadata['robots'] = {
  index: false,
  follow: false,
};

interface DashboardPageProps {
  params: Promise<{
    modulePath?: string[];
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

type DashboardNavigationEntry = ReturnType<ModuleHost['resolveNavigation']>[number];

function moduleNavigationLabel(
  host: ModuleHost,
  item: DashboardNavigationEntry,
  language: SupportedLanguage = DEFAULT_LANGUAGE
): string {
  if (item.item.labelKey) {
    return translateModuleMessage(host.runtime, item.moduleId, language, item.item.labelKey);
  }

  return host.getContract(item.moduleId)?.name ?? item.moduleId;
}

function moduleNavigationGroupLabel(
  host: ModuleHost,
  item: DashboardNavigationEntry,
  language: SupportedLanguage = DEFAULT_LANGUAGE
): string {
  if (item.item.groupKey) {
    return translateModuleMessage(host.runtime, item.moduleId, language, item.item.groupKey);
  }

  return item.item.fallbackGroup ?? dashboardInlineText(language, 'tools_e0128c71');
}

async function createScopedDashboardRequest(
  pathname: string,
  query?: Record<string, string | string[] | undefined>
): Promise<Request> {
  const requestHeaders = await headers();
  const host = requestHeaders.get('host');
  const cookie = requestHeaders.get('cookie');
  const lang = languageFromHeaders(requestHeaders);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined) {
          search.append(key, item);
        }
      }
    } else if (value !== undefined) {
      search.set(key, value);
    }
  }
  const target = search.size > 0 ? `${pathname}?${search}` : pathname;
  return createHostRequest(target, {
    headers: {
      ...(host ? { host } : {}),
      ...(cookie ? { cookie } : {}),
      [HOST_LANGUAGE_HEADER]: lang,
    },
  });
}

function dashboardNavGroups(
  host: ModuleHost,
  session: ModuleHostSession,
  lang: SupportedLanguage
): NavGroup[] {
  const grouped = new Map<string, { label: string; items: NavItem[] }>();
  for (const item of host.resolveNavigation('dashboard.sidebar', { session })) {
    const label = moduleNavigationGroupLabel(host, item, lang);
    const id = `${item.moduleId}:${item.item.fallbackGroup ?? item.item.groupKey ?? 'module-tools'}`;
    const group = grouped.get(id) ?? { label, items: [] };
    group.items.push({
      href: dashboardHref(item.item.path),
      label: moduleNavigationLabel(host, item, lang),
      icon: item.item.icon as NavItem['icon'],
      localized: false,
    });
    grouped.set(id, group);
  }

  return Array.from(grouped, ([id, group]) => ({
    id,
    label: group.label,
    items: group.items,
  }));
}

function readMetadataString(metadata: unknown, key: 'title' | 'description'): string | undefined {
  if (!metadata || typeof metadata !== 'object' || !(key in metadata)) {
    return undefined;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readDashboardShellChrome(metadata: unknown): 'none' | 'site' | 'workspace' | 'admin' | undefined {
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }

  const shell = (metadata as Record<string, unknown>).shell;
  if (!shell || typeof shell !== 'object') {
    return undefined;
  }

  const chrome = (shell as Record<string, unknown>).chrome;
  return chrome === 'none' || chrome === 'site' || chrome === 'workspace' || chrome === 'admin'
    ? chrome
    : undefined;
}

function dashboardNavigationLabel(
  host: ModuleHost,
  session: ModuleHostSession,
  pathname: string,
  lang: SupportedLanguage = DEFAULT_LANGUAGE
): string | undefined {
  const href = dashboardHref(pathname);
  const item = host
    .resolveNavigation('dashboard.sidebar', { session })
    .find((navigationItem) => dashboardHref(navigationItem.item.path) === href);
  return item ? moduleNavigationLabel(host, item, lang) : undefined;
}

function dashboardPageChrome(
  result: ResolveModulePageRouteResult,
  navigationLabel?: string,
  lang: SupportedLanguage = DEFAULT_LANGUAGE
): {
  eyebrow: string;
  title: string;
  description: string;
} {
  if (!result.ok) {
    return {
      eyebrow: navigationLabel ?? 'Workspace',
      title: dashboardInlineText(lang, 'page_unavailable_0b5181a4'),
      description: dashboardInlineText(lang, 'this_page_is_not_available_right_now_b49aba34'),
    };
  }

  const title =
    readMetadataString(result.page.metadata, 'title') ??
    navigationLabel ??
    result.page.contract.name;
  const description =
    readMetadataString(result.page.metadata, 'description') ??
    result.page.contract.description ??
    dashboardInlineText(lang, 'use_value_in_this_workspace_5fdead4a', { value1: title });

  return {
    eyebrow: result.page.contract.name,
    title,
    description,
  };
}

function applyDashboardModuleSessionPermissions(
  host: ModuleHost,
  session: ModuleHostSession,
  pathname: string
): ModuleHostSession {
  return applyModuleSelfServiceSessionPermissions(
    session,
    {
      operation: 'page',
      routeKind: 'dashboard',
      pathname,
    },
    host.runtime.contracts,
    host.runtime.routes
  );
}

export async function generateMetadata({ params }: DashboardPageProps): Promise<Metadata> {
  const { modulePath } = await params;
  const pathname = modulePathFromSegments(modulePath);
  if (pathname === '/') {
    return {
      title: 'Dashboard | PloyKit',
      robots: privateDashboardRobots,
    };
  }

  const host = await getModuleHost();
  const request = await createScopedDashboardRequest(dashboardHref(pathname));
  const session = applyDashboardModuleSessionPermissions(
    host,
    await createScopedDemoHostSession(request),
    pathname
  );
  const result = await host.resolvePageRoute({
    kind: 'dashboard',
    pathname,
    request,
    session,
  });

  if (!result.ok) {
    return {
      title: `${result.code} | PloyKit`,
      robots: privateDashboardRobots,
    };
  }

  const chrome = dashboardPageChrome(result, dashboardNavigationLabel(host, session, pathname));

  return {
    title: chrome.title,
    description: chrome.description,
    robots: privateDashboardRobots,
  };
}

async function DashboardHome({ request }: { request: Request }) {
  const host = await getModuleHost();
  const session = await createScopedDemoHostSession(request);
  const surface = await renderDashboardSurface(host, request, session);
  const dashboardRoutes = host.runtime.routes
    .filter((route) => route.kind === 'dashboard')
    .map((route) => ({
      route,
      contract: host.getContract(route.moduleId),
    }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-md border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Workspace tools</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tools available to the current workspace are listed below.
        </p>
        <div className="grid grid-cols-[1fr_auto] gap-3 border-t border-border py-3 first:border-t-0">
          <span className="text-muted-foreground">Available tools</span>
          <strong>{dashboardRoutes.length}</strong>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-3 border-t border-border py-3 first:border-t-0">
          <span className="text-muted-foreground">Pinned items</span>
          <strong>{surface.all.length}</strong>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-3 border-t border-border py-3 first:border-t-0">
          <span className="text-muted-foreground">Status</span>
          <strong>Ready</strong>
        </div>
      </section>

      <section className="rounded-md border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Pinned items</h2>
        {surface.all.length > 0 ? (
          surface.all.map((item) => (
            <div
              key={`${item.moduleId}:${item.surfaceId}`}
              className="flex flex-col gap-2 border-t border-border py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <ModuleValue value={item.rendered} />
            </div>
          ))
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing is pinned yet. Tools you use often can appear here later.
          </p>
        )}
      </section>

      <section className="rounded-md border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Available tools</h2>
        {dashboardRoutes.map((route) => (
          <div
            key={`${route.route.moduleId}:${route.route.kind}:${route.route.path}`}
            className="flex flex-col gap-2 border-t border-border py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="font-medium text-foreground">{route.contract?.name ?? 'Tool'}</div>
              <div className="text-xs text-muted-foreground">
                {route.contract?.description ?? 'Workspace tool'}
              </div>
            </div>
            <a
              className="text-sm font-semibold text-primary hover:underline"
              href={dashboardHref(route.route.path)}
            >
              Open
            </a>
          </div>
        ))}
      </section>

      <section className="rounded-md border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Team access</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Members only see the tools and information available to this workspace.
        </p>
      </section>
    </div>
  );
}

async function ModuleDashboardPage({
  result,
  lang,
  unframed = false,
}: {
  result: ResolveModulePageRouteResult;
  lang: SupportedLanguage;
  unframed?: boolean;
}) {
  if (!result.ok) {
    return <ErrorPanel status={result.status} code={result.code} message={result.message} />;
  }

  const output = await renderPageComponent(result.page.component, {
    params: result.page.params,
    loaderData: result.page.loaderData,
    metadata: result.page.metadata,
    language: lang,
  });

  if (unframed) {
    return <ModuleValue value={output} />;
  }

  return (
    <section className="rounded-md border border-border bg-card p-5 shadow-sm">
      <ModuleValue value={output} />
    </section>
  );
}

export default async function DashboardPage({ params, searchParams }: DashboardPageProps) {
  const requestHeaders = await headers();
  const lang = languageFromHeaders(requestHeaders);
  const { modulePath } = await params;
  const query = searchParams ? await searchParams : {};
  const pathname = modulePathFromSegments(modulePath);
  if (pathname === '/') {
    redirect(localizedPath(lang, '/dashboard'));
  }
  await requireHostUser(
    lang,
    pathname === '/' ? localizedPath(lang, '/dashboard') : dashboardHref(pathname)
  );
  const host = await getModuleHost();
  const request = await createScopedDashboardRequest(
    pathname === '/' ? '/dashboard' : dashboardHref(pathname),
    query
  );
  const session = await createScopedDemoHostSession(request);
  const moduleSession = applyDashboardModuleSessionPermissions(host, session, pathname);
  const navGroups = dashboardNavGroups(host, session, lang);
  const modulePageResult =
    pathname === '/'
      ? undefined
      : await host.resolvePageRoute({
          kind: 'dashboard',
          pathname,
          request,
          session: moduleSession,
        });
  const moduleChrome = modulePageResult
    ? dashboardPageChrome(
        modulePageResult,
        dashboardNavigationLabel(host, moduleSession, pathname, lang),
        lang
      )
    : null;
  const scopeResolution = await resolveDemoProductScope(request);
  const workspaces = await listDemoWorkspaces(scopeResolution.product.id);
  const theme = getProductThemeRuntimeView({ workspaceId: scopeResolution.workspace.id });
  const usesModuleChrome =
    modulePageResult?.ok === true && readDashboardShellChrome(modulePageResult.page.metadata) === 'none';

  if (modulePageResult && usesModuleChrome) {
    return (
      <>
        <ProductThemeStyle id="ploykit-workspace-theme" theme={theme} />
        <ModuleDashboardPage result={modulePageResult} lang={lang} unframed />
      </>
    );
  }

  return (
    <AppFrame
      area="dashboard"
      lang={lang}
      navGroups={navGroups}
      scope={{ label: scopeResolution.workspace.name, detail: scopeResolution.product.name }}
    >
      <ProductThemeStyle id="ploykit-workspace-theme" theme={theme} />
      <PageShell
        eyebrow={moduleChrome?.eyebrow ?? 'Workspace'}
        title={moduleChrome?.title ?? 'Dashboard'}
        description={moduleChrome?.description ?? 'Browse your available workspace tools.'}
        wide
        actions={<ProductScopeSwitcher resolution={scopeResolution} workspaces={workspaces} />}
      >
        {modulePageResult ? (
          <ModuleDashboardPage result={modulePageResult} lang={lang} />
        ) : (
          <DashboardHome request={request} />
        )}
      </PageShell>
    </AppFrame>
  );
}
