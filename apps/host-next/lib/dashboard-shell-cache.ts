import type { ProductScopeResolution } from '@/lib/module-runtime/scope/product-scope-resolver';
import type { ProductScopeSnapshot } from '@/lib/module-runtime/scope/product-scope-types';
import type { ModuleHostSession } from '@/lib/module-runtime';
import type { HostUserProfile } from './user-api';
import type { ProductThemeRuntimeView } from './product-composition';

const DEFAULT_TTL_MS = 10_000;
const MAX_ENTRIES = 128;

export type DashboardShellCacheKind =
  | 'product-scope'
  | 'profile'
  | 'theme'
  | 'navigation'
  | 'module-page';

export interface DashboardModulePageCachePolicy {
  strategy: 'none' | 'public' | 'private';
  revalidateSeconds: number | null | undefined;
}

interface CacheEntry<T> {
  expiresAt: number;
  value: T | Promise<T>;
}

interface DashboardShellCacheState {
  productScopes: Map<string, CacheEntry<ProductScopeSnapshot>>;
  resolutions: Map<string, CacheEntry<ProductScopeResolution>>;
  profiles: Map<string, CacheEntry<HostUserProfile>>;
  themes: Map<string, CacheEntry<ProductThemeRuntimeView>>;
  navigation: Map<string, CacheEntry<unknown>>;
  modulePages: Map<string, CacheEntry<unknown>>;
}

const DASHBOARD_SHELL_CACHE_KEY = Symbol.for('ploykit.host.dashboardShellCache');

type DashboardShellCacheGlobal = typeof globalThis & {
  [DASHBOARD_SHELL_CACHE_KEY]?: DashboardShellCacheState;
};

function dashboardShellCacheGlobal(): DashboardShellCacheGlobal {
  return globalThis as DashboardShellCacheGlobal;
}

function state(): DashboardShellCacheState {
  const globalState = dashboardShellCacheGlobal();
  globalState[DASHBOARD_SHELL_CACHE_KEY] ??= {
    productScopes: new Map(),
    resolutions: new Map(),
    profiles: new Map(),
    themes: new Map(),
    navigation: new Map(),
    modulePages: new Map(),
  };
  return globalState[DASHBOARD_SHELL_CACHE_KEY]!;
}

export function dashboardShellCacheTtlMs(): number {
  const value = Number(process.env.PLOYKIT_DASHBOARD_SHELL_CACHE_TTL_MS);
  if (!Number.isFinite(value)) {
    return DEFAULT_TTL_MS;
  }
  return Math.max(0, Math.floor(value));
}

function nowMs(): number {
  return Date.now();
}

function pruneMap<T>(entries: Map<string, CacheEntry<T>>, now = nowMs()): void {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) {
      entries.delete(key);
    }
  }

  while (entries.size > MAX_ENTRIES) {
    const oldestKey = entries.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }
    entries.delete(oldestKey);
  }
}

async function readShortCache<T>(
  entries: Map<string, CacheEntry<T>>,
  key: string,
  loader: () => Promise<T> | T,
  ttlMs = dashboardShellCacheTtlMs()
): Promise<T> {
  if (ttlMs <= 0) {
    return loader();
  }

  const now = nowMs();
  const existing = entries.get(key);
  if (existing && existing.expiresAt > now) {
    return existing.value;
  }

  const value = Promise.resolve(loader());
  entries.set(key, {
    value,
    expiresAt: now + ttlMs,
  });
  pruneMap(entries, now);
  try {
    const resolved = await value;
    entries.set(key, {
      value: resolved,
      expiresAt: nowMs() + ttlMs,
    });
    return resolved;
  } catch (error) {
    entries.delete(key);
    throw error;
  }
}

function readShortCacheSync<T>(
  entries: Map<string, CacheEntry<T>>,
  key: string,
  loader: () => T,
  ttlMs = dashboardShellCacheTtlMs()
): T {
  if (ttlMs <= 0) {
    return loader();
  }

  const now = nowMs();
  const existing = entries.get(key);
  if (existing && existing.expiresAt > now) {
    return existing.value as T;
  }

  const value = loader();
  entries.set(key, {
    value,
    expiresAt: now + ttlMs,
  });
  pruneMap(entries, now);
  return value;
}

function hostKeyFromRequest(request: Request): string {
  const host = request.headers.get('host') ?? new URL(request.url).host;
  return host.split(':')[0]?.toLowerCase() ?? '';
}

function workspaceOverrideKey(request: Request): string {
  const url = new URL(request.url);
  return url.searchParams.get('workspace') ?? '';
}

function productScopeCookieKey(request: Request): string {
  const cookie = request.headers.get('cookie') ?? '';
  for (const part of cookie.split(';')) {
    const [name, ...valueParts] = part.trim().split('=');
    if (name === 'ploykit_product_scope') {
      return valueParts.join('=');
    }
  }
  return '';
}

export function dashboardShellSessionKey(session: ModuleHostSession): string {
  return [
    session.authKind ?? 'unknown',
    session.authSessionId ?? '',
    session.userId ?? session.user?.id ?? '',
    session.user?.role ?? '',
    session.productId ?? '',
    session.workspaceId ?? '',
    session.workspaceRole ?? '',
    session.productScopeProfile ?? '',
  ].join(':');
}

function sortedJoined(values: readonly string[] | undefined): string {
  return [...new Set((values ?? []).filter((value) => value.length > 0))].sort().join(',');
}

export function dashboardShellNavigationKey(session: ModuleHostSession): string {
  return [
    dashboardShellSessionKey(session),
    session.system ? 'system' : 'user',
    session.apiKeyId ?? '',
    sortedJoined(session.permissions?.map(String)),
    sortedJoined(session.entitlements),
    sortedJoined(session.plans),
    session.plan ?? '',
    sortedJoined(session.features),
    sortedJoined(session.serviceConnections),
    String(session.creditsBalance ?? ''),
  ].join('|');
}

export function dashboardShellProductScopeResolutionKey(
  request: Request,
  session: ModuleHostSession
): string {
  return [
    hostKeyFromRequest(request),
    workspaceOverrideKey(request),
    productScopeCookieKey(request),
    dashboardShellSessionKey(session),
  ].join('|');
}

function requestSearchKey(request: Request): string {
  const searchParams = new URL(request.url).searchParams;
  return [...searchParams.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      `${leftKey}=${leftValue}`.localeCompare(`${rightKey}=${rightValue}`)
    )
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

export function dashboardShellModulePageKey(input: {
  request: Request;
  session: ModuleHostSession;
  kind: string;
  pathname: string;
  language?: string;
}): string {
  return [
    hostKeyFromRequest(input.request),
    input.kind,
    input.pathname,
    input.language ?? '',
    requestSearchKey(input.request),
    productScopeCookieKey(input.request),
    dashboardShellNavigationKey(input.session),
  ].join('|');
}

export function cachedDashboardProductScopeSnapshot(
  loader: () => Promise<ProductScopeSnapshot>
): Promise<ProductScopeSnapshot> {
  return readShortCache(state().productScopes, 'default', loader);
}

export function cachedDashboardProductScopeResolution(
  request: Request,
  session: ModuleHostSession,
  loader: () => Promise<ProductScopeResolution>
): Promise<ProductScopeResolution> {
  return readShortCache(
    state().resolutions,
    dashboardShellProductScopeResolutionKey(request, session),
    loader
  );
}

export function cachedDashboardUserProfile(
  session: ModuleHostSession,
  loader: () => Promise<HostUserProfile>
): Promise<HostUserProfile> {
  return readShortCache(state().profiles, dashboardShellSessionKey(session), loader);
}

export function cachedDashboardTheme(
  workspaceId: string | null | undefined,
  loader: () => ProductThemeRuntimeView
): ProductThemeRuntimeView {
  return readShortCacheSync(state().themes, workspaceId ?? 'default', loader);
}

export function cachedDashboardNavigation<T>(session: ModuleHostSession, loader: () => T): T {
  return readShortCacheSync(state().navigation, dashboardShellNavigationKey(session), loader) as T;
}

export async function cachedDashboardModulePageRoute<T>(input: {
  request: Request;
  session: ModuleHostSession;
  kind: string;
  pathname: string;
  language?: string;
  loader: () => Promise<T>;
  cachePolicy: (value: T) => DashboardModulePageCachePolicy | null | undefined;
  onCacheStatus?: (status: { hit: boolean }) => void;
}): Promise<T> {
  const key = dashboardShellModulePageKey(input);
  const entries = state().modulePages;
  const now = nowMs();
  const existing = entries.get(key);
  if (existing && existing.expiresAt > now) {
    input.onCacheStatus?.({ hit: true });
    return existing.value as T;
  }

  input.onCacheStatus?.({ hit: false });
  const value = await input.loader();
  const policy = input.cachePolicy(value);
  const routeTtlMs = Math.max(0, Math.floor(policy?.revalidateSeconds ?? 0) * 1000);
  const ttlMs = Math.min(routeTtlMs, dashboardShellCacheTtlMs());
  if (policy?.strategy === 'none' || ttlMs <= 0) {
    entries.delete(key);
    return value;
  }

  entries.set(key, {
    value,
    expiresAt: nowMs() + ttlMs,
  });
  pruneMap(entries);
  return value;
}

export function invalidateDashboardShellCache(kind?: DashboardShellCacheKind): void {
  const cache = state();
  if (!kind || kind === 'product-scope') {
    cache.productScopes.clear();
    cache.resolutions.clear();
  }
  if (!kind || kind === 'profile') {
    cache.profiles.clear();
  }
  if (!kind || kind === 'theme') {
    cache.themes.clear();
  }
  if (!kind || kind === 'navigation') {
    cache.navigation.clear();
  }
  if (!kind || kind === 'module-page') {
    cache.modulePages.clear();
  }
}

export function resetDashboardShellCacheForTests(): void {
  dashboardShellCacheGlobal()[DASHBOARD_SHELL_CACHE_KEY] = undefined;
}
