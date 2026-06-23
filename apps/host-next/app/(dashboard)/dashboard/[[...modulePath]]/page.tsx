import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppFrame } from '@host/components/layout/AppFrame';
import { ClientTransitionLinks } from '@host/components/layout/ClientTransitionLinks';
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
  stripLanguagePrefix,
  type SupportedLanguage,
} from '@host/lib/i18n';
import { dashboardInlineText } from '@host/lib/dashboard-copy';
import {
  cachedDashboardNavigation,
  cachedDashboardModulePageRoute,
  cachedDashboardProductScopeResolution,
  cachedDashboardTheme,
  cachedDashboardUserProfile,
} from '@host/lib/dashboard-shell-cache';
import {
  createDashboardTimingReport,
  maybeLogDashboardTiming,
  measureDashboardSpan,
  type DashboardTimingSpan,
} from '@host/lib/dashboard-timing';
import { applyModuleSelfServiceSessionPermissions } from '@host/lib/create-host';
import { getModuleHost } from '@host/lib/module-host';
import { resolveModuleNavigationIconKey } from '@host/lib/module-navigation-icons';
import { createHostRequest, dashboardHref, modulePathFromSegments } from '@host/lib/paths';
import { getHostUserProfile } from '@host/lib/user-api';
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
  ModulePageRouteErrorResult,
  ResolveModulePageRouteMetadataResult,
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

interface GenerateDashboardMetadataDependencies {
  getHost?: () => Promise<ModuleHost> | ModuleHost;
  createRequest?: (pathname: string) => Promise<Request> | Request;
  createSession?: (request: Request) => Promise<ModuleHostSession> | ModuleHostSession;
  applySessionPermissions?: (
    host: ModuleHost,
    session: ModuleHostSession,
    pathname: string
  ) => ModuleHostSession;
}

type DashboardNavigationEntry = ReturnType<ModuleHost['resolveNavigation']>[number];
type DashboardNavigationEntries = ReturnType<ModuleHost['resolveNavigation']>;

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

function resolveDashboardNavigation(
  host: ModuleHost,
  session: ModuleHostSession
): DashboardNavigationEntries {
  return host.resolveNavigation('dashboard.sidebar', { session });
}

function dashboardNavGroups(
  host: ModuleHost,
  navigation: DashboardNavigationEntries,
  lang: SupportedLanguage
): NavGroup[] {
  const grouped = new Map<string, { label: string; items: NavItem[] }>();
  for (const item of navigation) {
    const label = moduleNavigationGroupLabel(host, item, lang);
    const id = `${item.moduleId}:${item.item.fallbackGroup ?? item.item.groupKey ?? 'module-tools'}`;
    const group = grouped.get(id) ?? { label, items: [] };
    group.items.push({
      href: dashboardHref(item.item.path),
      label: moduleNavigationLabel(host, item, lang),
      icon: resolveModuleNavigationIconKey(item.moduleId, item.item.icon),
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

function readDashboardShellChrome(
  metadata: unknown
): 'none' | 'site' | 'workspace' | 'admin' | undefined {
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

type DashboardChromeRouteResult =
  | ResolveModulePageRouteResult
  | ResolveModulePageRouteMetadataResult;

function dashboardResultShellChrome(
  result: DashboardChromeRouteResult | null | undefined
): 'none' | 'site' | 'workspace' | 'admin' | undefined {
  if (!result) {
    return undefined;
  }

  return result.ok
    ? readDashboardShellChrome(result.page.metadata)
    : readDashboardShellChrome(result.routeContext?.metadata);
}

function dashboardNavigationLabel(
  host: ModuleHost,
  navigation: DashboardNavigationEntries,
  pathname: string,
  lang: SupportedLanguage = DEFAULT_LANGUAGE
): string | undefined {
  const href = dashboardHref(pathname);
  const item = navigation.find(
    (navigationItem) => dashboardHref(navigationItem.item.path) === href
  );
  return item ? moduleNavigationLabel(host, item, lang) : undefined;
}

function dashboardModuleSearchHref(
  host: ModuleHost,
  moduleId: string | undefined
): string | undefined {
  if (!moduleId) {
    return undefined;
  }
  const candidate = dashboardHref(`/${moduleId}/search`);
  const hasSearchRoute = host.runtime.routes.some(
    (route) =>
      route.kind === 'dashboard' &&
      route.moduleId === moduleId &&
      dashboardHref(route.path) === candidate
  );
  return hasSearchRoute ? candidate : undefined;
}

function normalizedDashboardHref(path = '/'): string {
  return dashboardHref(stripLanguagePrefix(path));
}

function localizedDashboardModuleHref(lang: SupportedLanguage, path = '/'): string {
  return localizedPath(lang, normalizedDashboardHref(path));
}

function createDashboardModuleRenderProps(
  page: Extract<ResolveModulePageRouteResult, { ok: true }>['page'],
  lang: SupportedLanguage
) {
  return {
    params: page.params,
    loaderData: page.loaderData,
    metadata: page.metadata,
    language: lang,
    dashboardBaseHref: dashboardHref('/'),
    localizedDashboardHref: (path?: string) => localizedDashboardModuleHref(lang, path),
  };
}

function dashboardModuleTimingSpanName(name: string): string {
  return `module-${name}`;
}

function dashboardModuleId(
  result: ResolveModulePageRouteResult | null | undefined
): string | undefined {
  if (!result) {
    return undefined;
  }
  return result.ok ? result.page.moduleId : result.routeContext?.moduleId;
}

function dashboardActivePath(
  result: ResolveModulePageRouteResult | null | undefined,
  pathname: string
): string {
  const canonicalPath = result
    ? result.ok
      ? result.page.canonicalPath
      : result.routeContext?.canonicalPath
    : undefined;
  return dashboardHref(canonicalPath ?? pathname);
}

function dashboardPageChrome(
  result: DashboardChromeRouteResult,
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

async function dashboardFrameUser(session: ModuleHostSession) {
  if (!session.user) {
    return undefined;
  }

  const profile = await cachedDashboardUserProfile(session, () =>
    getHostUserProfile(session)
  ).catch(() => null);
  return {
    name: profile?.displayName ?? session.user.email ?? session.user.id,
    email: session.user.email,
  };
}

async function resolveDashboardShellData(
  request: Request,
  session: ModuleHostSession,
  timingSpans?: DashboardTimingSpan[]
) {
  const spans = timingSpans ?? [];
  const scopeResolutionPromise = measureDashboardSpan('scope', spans, () =>
    cachedDashboardProductScopeResolution(request, session, () => resolveDemoProductScope(request))
  );
  const workspacesPromise = scopeResolutionPromise.then((scopeResolution) =>
    measureDashboardSpan('workspaces', spans, () => listDemoWorkspaces(scopeResolution.product.id))
  );
  const frameUserPromise = measureDashboardSpan('profile', spans, () =>
    dashboardFrameUser(session)
  );
  const [scopeResolution, workspaces, frameUser] = await Promise.all([
    scopeResolutionPromise,
    workspacesPromise,
    frameUserPromise,
  ]);
  const theme = await measureDashboardSpan('theme', spans, () =>
    cachedDashboardTheme(scopeResolution.workspace.id, () =>
      getProductThemeRuntimeView({ workspaceId: scopeResolution.workspace.id })
    )
  );

  return {
    scopeResolution,
    workspaces,
    theme,
    frameUser,
  };
}

async function generateDashboardMetadata(
  { params }: DashboardPageProps,
  dependencies: GenerateDashboardMetadataDependencies = {}
): Promise<Metadata> {
  const { modulePath } = await params;
  const pathname = modulePathFromSegments(modulePath);
  if (pathname === '/') {
    return {
      title: 'Dashboard | PloyKit',
      robots: privateDashboardRobots,
    };
  }

  const host = await (dependencies.getHost?.() ?? getModuleHost());
  const request = await (dependencies.createRequest?.(pathname) ??
    createScopedDashboardRequest(dashboardHref(pathname)));
  const applySessionPermissions =
    dependencies.applySessionPermissions ?? applyDashboardModuleSessionPermissions;
  const session = applySessionPermissions(
    host,
    await (dependencies.createSession?.(request) ?? createScopedDemoHostSession(request)),
    pathname
  );
  const navigation = cachedDashboardNavigation(session, () =>
    resolveDashboardNavigation(host, session)
  );
  const result = await host.resolvePageRouteMetadata({
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

  const chrome = dashboardPageChrome(result, dashboardNavigationLabel(host, navigation, pathname));

  return {
    title: chrome.title,
    description: chrome.description,
    robots: privateDashboardRobots,
  };
}

export async function generateMetadata({ params }: DashboardPageProps): Promise<Metadata> {
  return generateDashboardMetadata({ params });
}

export const generateDashboardModuleMetadataForTest = generateDashboardMetadata;
export const createDashboardModuleRenderPropsForTest = createDashboardModuleRenderProps;

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
    if (unframed) {
      return <ModuleChromeErrorPanel result={result} lang={lang} />;
    }

    return <ErrorPanel status={result.status} code={result.code} message={result.message} />;
  }

  const output = await renderPageComponent(
    result.page.component,
    createDashboardModuleRenderProps(result.page, lang)
  );

  if (unframed) {
    return <ModuleValue value={output} />;
  }

  return (
    <section className="rounded-md border border-border bg-card p-5 shadow-sm">
      <ModuleValue value={output} />
    </section>
  );
}

function ModuleChromeErrorPanel({
  result,
  lang,
}: {
  result: ModulePageRouteErrorResult;
  lang: SupportedLanguage;
}) {
  const moduleName = result.routeContext?.contract.name ?? 'Module';
  const title = dashboardInlineText(lang, 'page_unavailable_0b5181a4');
  const description = dashboardInlineText(lang, 'this_page_is_not_available_right_now_b49aba34');

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-3xl">
        <div className="text-xs font-semibold uppercase text-muted-foreground">{moduleName}</div>
        <h1 className="mt-3 text-3xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-foreground">
          <div className="font-semibold">
            {result.status} {result.code}
          </div>
          <p className="mt-2 text-muted-foreground">{result.message}</p>
          {result.routeContext ? (
            <dl className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <div>
                <dt className="font-medium text-foreground">Module</dt>
                <dd className="break-words">{result.routeContext.moduleId}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Route</dt>
                <dd className="break-words">{result.routeContext.canonicalPath}</dd>
              </div>
            </dl>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export function HostClientTransitionFrame({
  area,
  children,
}: {
  area: 'admin' | 'dashboard';
  children: ReactNode;
}) {
  return (
    <div data-host-app-frame={area}>
      <ClientTransitionLinks area={area} />
      {children}
    </div>
  );
}

export default async function DashboardPage({ params, searchParams }: DashboardPageProps) {
  const timingStartedAt = Date.now();
  const timingSpans: DashboardTimingSpan[] = [];
  const requestHeaders = await headers();
  const lang = languageFromHeaders(requestHeaders);
  const { modulePath } = await params;
  const query = searchParams ? await searchParams : {};
  const pathname = modulePathFromSegments(modulePath);
  if (pathname === '/') {
    redirect(localizedPath(lang, '/dashboard'));
  }
  await measureDashboardSpan('auth', timingSpans, () =>
    requireHostUser(
      lang,
      pathname === '/' ? localizedPath(lang, '/dashboard') : dashboardHref(pathname)
    )
  );
  const host = await measureDashboardSpan('module-host', timingSpans, () => getModuleHost());
  const request = await createScopedDashboardRequest(
    pathname === '/' ? '/dashboard' : dashboardHref(pathname),
    query
  );
  const session = await measureDashboardSpan('session', timingSpans, () =>
    createScopedDemoHostSession(request)
  );
  const moduleSession = await measureDashboardSpan('module-session', timingSpans, () =>
    applyDashboardModuleSessionPermissions(host, session, pathname)
  );
  const { moduleNavigation, navGroups } = await measureDashboardSpan(
    'navigation',
    timingSpans,
    () => {
      const nextShellNavigation = cachedDashboardNavigation(session, () =>
        resolveDashboardNavigation(host, session)
      );
      const nextModuleNavigation =
        moduleSession === session
          ? nextShellNavigation
          : cachedDashboardNavigation(moduleSession, () =>
              resolveDashboardNavigation(host, moduleSession)
            );
      return {
        shellNavigation: nextShellNavigation,
        moduleNavigation: nextModuleNavigation,
        navGroups: dashboardNavGroups(host, nextShellNavigation, lang),
      };
    }
  );
  const modulePageResultPromise: Promise<ResolveModulePageRouteResult | undefined> =
    pathname === '/'
      ? Promise.resolve(undefined)
      : measureDashboardSpan('route-resolve', timingSpans, () =>
          cachedDashboardModulePageRoute({
            kind: 'dashboard',
            pathname,
            request,
            session: moduleSession,
            language: lang,
            loader: () =>
              host.resolvePageRoute({
                kind: 'dashboard',
                pathname,
                request,
                session: moduleSession,
                onTimingSpan(span) {
                  timingSpans.push({
                    name: dashboardModuleTimingSpanName(span.name),
                    durationMs: span.durationMs,
                  });
                },
              }),
            cachePolicy(result) {
              return result.ok
                ? {
                    strategy: result.page.route.cache?.strategy ?? 'none',
                    revalidateSeconds: result.page.route.cache?.revalidateSeconds,
                  }
                : null;
            },
          })
        );
  const shellDataPromise = measureDashboardSpan('shell-data', timingSpans, () =>
    resolveDashboardShellData(request, session, timingSpans)
  );
  const [modulePageResult, shellData] = await Promise.all([
    modulePageResultPromise,
    shellDataPromise,
  ]);
  const { moduleChrome, usesModuleChrome, moduleSearchHref, activePath, moduleId } =
    await measureDashboardSpan('chrome', timingSpans, () => {
      const nextModuleChrome = modulePageResult
        ? dashboardPageChrome(
            modulePageResult,
            dashboardNavigationLabel(host, moduleNavigation, pathname, lang),
            lang
          )
        : null;
      const nextModuleId = dashboardModuleId(modulePageResult);
      return {
        moduleChrome: nextModuleChrome,
        usesModuleChrome: dashboardResultShellChrome(modulePageResult) === 'none',
        moduleSearchHref: dashboardModuleSearchHref(host, nextModuleId),
        activePath: dashboardActivePath(modulePageResult, pathname),
        moduleId: nextModuleId,
      };
    });
  maybeLogDashboardTiming(
    createDashboardTimingReport({
      pathname,
      routeKind: 'dashboard',
      moduleId,
      status: modulePageResult?.status ?? 200,
      spans: timingSpans,
      totalMs: Date.now() - timingStartedAt,
    })
  );

  if (modulePageResult && usesModuleChrome) {
    return (
      <>
        <ProductThemeStyle id="ploykit-workspace-theme" theme={shellData.theme} />
        <HostClientTransitionFrame area="dashboard">
          <ModuleDashboardPage result={modulePageResult} lang={lang} unframed />
        </HostClientTransitionFrame>
      </>
    );
  }

  return (
    <AppFrame
      area="dashboard"
      lang={lang}
      navGroups={navGroups}
      activePath={activePath}
      scope={{
        label: shellData.scopeResolution.workspace.name,
        detail: shellData.scopeResolution.product.name,
        searchHref: moduleSearchHref,
      }}
      user={shellData.frameUser}
    >
      <ProductThemeStyle id="ploykit-workspace-theme" theme={shellData.theme} />
      <PageShell
        eyebrow={moduleChrome?.eyebrow ?? 'Workspace'}
        title={moduleChrome?.title ?? 'Dashboard'}
        description={moduleChrome?.description ?? 'Browse your available workspace tools.'}
        wide
        actions={
          <ProductScopeSwitcher
            resolution={shellData.scopeResolution}
            workspaces={shellData.workspaces}
          />
        }
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
