import type { Metadata } from 'next';
import type {
  ModulePageCachePresentation,
  ModulePageI18nPresentation,
  ModulePagePresentation,
  ModulePageShellPresentation,
  ModulePageThemePresentation,
} from '@ploykit/module-sdk/presentation';
import {
  resolveHostPageComposition,
  type HostPageCompositionDiagnostic,
  type HostPageCompositionPlan,
} from '@/lib/module-runtime/ui/host-page-composition';
import { renderModuleSurface } from '@/lib/module-runtime/ui/surface-renderer';
import type { ModuleRuntimeAccessSession } from '@/lib/module-runtime/security/session';
import { getModuleHost } from '../module-host';
import { createHostRequest } from '../paths';
import { getProductComposition, getProductThemeRuntimeView, type ProductThemeRuntimeView } from '../product-composition';
import { type SupportedLanguage } from '../i18n';
import { createProductSeoMetadata } from './seo-presentation';

export interface PagePresentationDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  pageId: string;
  surfaceId?: string;
  moduleId?: string;
}

export interface ResolvedPagePresentation {
  pageId: string;
  surfaceId: string;
  area: string;
  chrome: string;
  replacePolicy: string;
  language: SupportedLanguage;
  renderer: 'host' | 'module';
  activeModuleId: string | null;
  activeReason: string | null;
  slots: Record<string, readonly string[]>;
  shell: Required<ModulePageShellPresentation>;
  cache: ModulePageCachePresentation;
  i18n: Required<ModulePageI18nPresentation>;
  theme: ProductThemeRuntimeView;
  pageTheme: ModulePageThemePresentation | null;
  seo: Metadata;
  metadata: ModulePagePresentation;
  plan: HostPageCompositionPlan;
  diagnostics: readonly PagePresentationDiagnostic[];
}

export interface ResolvePagePresentationInput {
  pageId: string;
  pathname: string;
  lang: SupportedLanguage;
  workspaceId?: string | null;
  session?: ModuleRuntimeAccessSession;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pageKeyFromPageId(pageId: string): string {
  const [, key] = pageId.split('.');
  return key ?? pageId;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function normalizePagePresentation(value: unknown): ModulePagePresentation {
  if (!isRecord(value)) {
    return {};
  }

  return value as ModulePagePresentation;
}

function defaultShell(plan: HostPageCompositionPlan): Required<ModulePageShellPresentation> {
  return {
    area: plan.page.area,
    chrome: plan.page.chrome,
    wide: false,
  };
}

function defaultCache(plan: HostPageCompositionPlan): ModulePageCachePresentation {
  if (plan.page.area === 'auth') {
    return { mode: 'no-store' };
  }
  if (plan.page.area === 'dashboard' || plan.page.area === 'admin' || plan.page.area === 'dev') {
    return { mode: 'private' };
  }
  return { mode: 'public', revalidateSeconds: 300 };
}

function isSearchIndexablePage(plan: HostPageCompositionPlan): boolean {
  return plan.page.area === 'site';
}

function resolveCachePolicy(
  plan: HostPageCompositionPlan,
  configuredCache: ModulePageCachePresentation | undefined
): ModulePageCachePresentation {
  const fallback = defaultCache(plan);
  if (!configuredCache) {
    return fallback;
  }
  if (plan.page.area === 'auth' && configuredCache.mode !== 'no-store') {
    return fallback;
  }
  if (!isSearchIndexablePage(plan) && configuredCache.mode === 'public') {
    return fallback;
  }
  return configuredCache;
}

function defaultI18n(moduleId: string | null): Required<ModulePageI18nPresentation> {
  return {
    namespaces: moduleId ? [moduleId] : ['host'],
    defaultLocale: 'zh',
  };
}

function fromCompositionDiagnostic(
  diagnostic: HostPageCompositionDiagnostic
): PagePresentationDiagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    pageId: diagnostic.pageId,
    surfaceId: diagnostic.surfaceId,
    moduleId: diagnostic.moduleId,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateResolvedMetadata(input: {
  plan: HostPageCompositionPlan;
  moduleId: string | null;
  metadata: ModulePagePresentation;
}): PagePresentationDiagnostic[] {
  if (!input.moduleId) {
    return [];
  }

  const diagnostics: PagePresentationDiagnostic[] = [];
  if (!input.metadata.seo) {
    diagnostics.push({
      severity: 'error',
      code: 'PAGE_PRESENTATION_SEO_MISSING',
      message: `Module "${input.moduleId}" page override must return seo metadata.`,
      pageId: input.plan.page.id,
      moduleId: input.moduleId,
    });
  }
  if (!input.metadata.cache) {
    diagnostics.push({
      severity: 'error',
      code: 'PAGE_PRESENTATION_CACHE_MISSING',
      message: `Module "${input.moduleId}" page override must return cache metadata.`,
      pageId: input.plan.page.id,
      moduleId: input.moduleId,
    });
  }
  if (!input.metadata.i18n) {
    diagnostics.push({
      severity: 'warning',
      code: 'PAGE_PRESENTATION_I18N_MISSING',
      message: `Module "${input.moduleId}" page override should return i18n namespaces.`,
      pageId: input.plan.page.id,
      moduleId: input.moduleId,
    });
  }
  if (!isSearchIndexablePage(input.plan) && input.metadata.cache?.mode === 'public') {
    diagnostics.push({
      severity: 'error',
      code: 'PAGE_PRESENTATION_PRIVATE_CACHE_PUBLIC',
      message: `Module "${input.moduleId}" page override must not use public cache for "${input.plan.page.id}".`,
      pageId: input.plan.page.id,
      moduleId: input.moduleId,
    });
  }
  return diagnostics;
}

async function loadActiveOverridePresentation(input: {
  plan: HostPageCompositionPlan;
  pathname: string;
  session: ModuleRuntimeAccessSession;
}): Promise<{
  metadata: ModulePagePresentation;
  diagnostics: PagePresentationDiagnostic[];
  resolved: boolean;
}> {
  if (!input.plan.activeOverride) {
    return { metadata: {}, diagnostics: [], resolved: false };
  }

  try {
    const host = await getModuleHost();
    const surface = await renderModuleSurface(host.runtime, {
      request: createHostRequest(input.pathname),
      surfaceId: input.plan.page.surfaceId,
      contributions: [input.plan.activeOverride],
      session: input.session,
    });
    const selected = surface.replace.find(
      (item) => item.moduleId === input.plan.activeOverride?.moduleId
    );
    if (!selected) {
      return {
        metadata: {},
        resolved: false,
        diagnostics: [
          {
            severity: 'error',
            code: 'PAGE_PRESENTATION_OVERRIDE_OUTPUT_MISSING',
            message: `Module "${input.plan.activeOverride.moduleId}" did not render a page override for "${input.plan.page.id}".`,
            pageId: input.plan.page.id,
            moduleId: input.plan.activeOverride.moduleId,
          },
        ],
      };
    }

    return {
      metadata: normalizePagePresentation(selected.loaderData),
      diagnostics: [],
      resolved: true,
    };
  } catch (error) {
    return {
      metadata: {},
      resolved: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'PAGE_PRESENTATION_OVERRIDE_LOAD_FAILED',
          message: `Module "${input.plan.activeOverride.moduleId}" page override failed for "${input.plan.page.id}": ${errorMessage(error)}`,
          pageId: input.plan.page.id,
          moduleId: input.plan.activeOverride.moduleId,
        },
      ],
    };
  }
}

export async function resolvePagePresentation(
  input: ResolvePagePresentationInput
): Promise<ResolvedPagePresentation> {
  const host = await getModuleHost();
  const composition = getProductComposition();
  const plan = resolveHostPageComposition(host.runtime, {
    pageId: input.pageId,
    composition,
    session: input.session ?? { user: null, permissions: [] },
  });
  const loadedOverride = await loadActiveOverridePresentation({
    plan,
    pathname: input.pathname,
    session: input.session ?? { user: null, permissions: [] },
  });
  const activeModuleId =
    plan.activeOverride && loadedOverride.resolved ? plan.activeOverride.moduleId : null;
  const metadata = loadedOverride.metadata;
  const shell = {
    ...defaultShell(plan),
    ...(metadata.shell ?? {}),
  } as Required<ModulePageShellPresentation>;
  const cache = resolveCachePolicy(plan, metadata.cache);
  const i18n = {
    ...defaultI18n(activeModuleId),
    ...(metadata.i18n ?? {}),
  } as Required<ModulePageI18nPresentation>;
  const theme = getProductThemeRuntimeView({
    workspaceId:
      metadata.theme?.scope === 'workspace' || plan.page.area === 'dashboard'
        ? input.workspaceId
        : null,
    pageTheme: metadata.theme ?? null,
  });
  const seo = createProductSeoMetadata({
    lang: input.lang,
    path: metadata.seo?.canonicalPath ?? input.pathname,
    pageKey: pageKeyFromPageId(input.pageId),
    title: text(metadata.seo?.title) ?? text(metadata.title),
    description: text(metadata.seo?.description) ?? text(metadata.description),
    noIndex: !isSearchIndexablePage(plan) || metadata.seo?.noindex === true,
  });
  const diagnostics = [
    ...plan.diagnostics.map(fromCompositionDiagnostic),
    ...loadedOverride.diagnostics,
    ...(loadedOverride.resolved
      ? validateResolvedMetadata({ plan, moduleId: activeModuleId, metadata })
      : []),
    ...(theme.page?.diagnostics ?? []).map((message) => ({
      severity: 'error' as const,
      code: 'PAGE_PRESENTATION_THEME_INVALID',
      message,
      pageId: plan.page.id,
      moduleId: activeModuleId ?? undefined,
    })),
  ];
  const configuredOverride = composition.pageOverrides?.[input.pageId];

  return {
    pageId: plan.page.id,
    surfaceId: plan.page.surfaceId,
    area: plan.page.area,
    chrome: plan.page.chrome,
    replacePolicy: plan.page.replacePolicy,
    language: input.lang,
    renderer: activeModuleId ? 'module' : 'host',
    activeModuleId,
    activeReason: configuredOverride?.reason ?? null,
    slots: Object.fromEntries(
      Object.entries(plan.slots).map(([slotId, contributions]) => [
        slotId,
        contributions.map((item) => item.moduleId),
      ])
    ),
    shell,
    cache,
    i18n,
    theme,
    pageTheme: metadata.theme ?? null,
    seo,
    metadata,
    plan,
    diagnostics,
  };
}
