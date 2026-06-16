import {
  resolveHostPageComposition,
  type ProductComposition,
} from '@/lib/module-runtime/ui/host-page-composition';
import {
  HOST_PAGE_REGISTRY,
  getHostPageRegistryEntry,
  getHostPageSlotDefinition,
  getHostPageSlotSurfaceId,
} from '@/lib/module-runtime/ui/host-page-registry';
import {
  HOST_THEME_ALLOWED_TOKENS,
  resolveModuleThemeTokens,
} from '@/lib/module-runtime/ui/theme-runtime';
import { Permission } from '@ploykit/module-sdk';
import type {
  ModulePageThemePresentation,
  ProductPresentationDefinition,
  ProductPresentationPageSelection,
} from '@ploykit/module-sdk/presentation';
import productPresentation from '../../../product.presentation';
import { cachedDashboardTheme } from './dashboard-shell-cache';
import { getModuleHost } from './module-host';
import {
  readProductThemeVisualBaseline,
  resolveProductBrandView,
  type ProductBrandView,
  type ProductThemeVisualBaselineView,
} from './product-composition-brand';
import {
  getWorkspaceThemeScopes,
  resolveProductThemeRuntimeView,
  resolveProductThemeScope,
  type ProductThemeRuntimeView,
  type ProductThemeScopeView,
} from './product-composition-theme';
export { createProductThemeCss } from './product-composition-theme';
export type { ProductBrandView, ProductThemeVisualBaselineView } from './product-composition-brand';
export type {
  ProductThemeLocaleTypographyView,
  ProductThemeRuntimeView,
  ProductThemeScopeView,
} from './product-composition-theme';

export interface ProductCompositionPageView {
  pageId: string;
  area: string;
  replacePolicy: string;
  configuredModuleId: string | null;
  enabled: boolean;
  activeModuleId: string | null;
  replaceCandidates: string[];
  diagnostics: string[];
}

export interface ProductCompositionSlotView {
  pageId: string;
  slotId: string;
  surfaceId: string;
  configured: boolean;
  allowModules: readonly string[];
  denyModules: readonly string[];
  maxContributions: number | null;
  effectiveMaxContributions: number;
  candidateModules: string[];
  activeModules: string[];
  blockedModules: string[];
  blockedContributions: readonly {
    moduleId: string;
    severity: 'info' | 'warning' | 'error';
    code: string;
    message: string;
  }[];
  diagnostics: string[];
}

export interface ProductCompositionView {
  supportedLanguages: readonly string[];
  enabledModules: readonly string[];
  brand: ProductBrandView;
  visualBaseline: ProductThemeVisualBaselineView | null;
  themeProfileId: string | null;
  themeProfile: ProductThemeScopeView;
  workspaceThemeOverrides: readonly ProductThemeScopeView[];
  pages: readonly ProductCompositionPageView[];
  slots: readonly ProductCompositionSlotView[];
}

export interface ProductThemeDiagnosticsView {
  allowedTokens: readonly string[];
  supportedLanguages: readonly string[];
  productProfile: ProductThemeScopeView;
  workspaceProfiles: readonly ProductThemeScopeView[];
  modules: readonly {
    moduleId: string;
    declaredThemeWrite: boolean;
    hasCss: boolean;
    acceptedTokens: Record<string, string | number>;
    rejectedTokens: Record<string, string | number>;
  }[];
}

export function getProductComposition(): ProductComposition {
  const definition = productPresentation.definition as ProductPresentationDefinition;
  const pageOverrides: ProductComposition['pageOverrides'] = {};
  for (const [area, pages] of Object.entries(definition.pages ?? {})) {
    for (const [pageName, page] of Object.entries(pages ?? {}) as [
      string,
      ProductPresentationPageSelection,
    ][]) {
      if (!page.replaceWith) {
        continue;
      }
      const pageId = `${area}.${pageName}`;
      const registryEntry = getHostPageRegistryEntry(pageId);
      const explicit = page.mode === 'replace';
      const canReplace =
        page.mode !== 'host' &&
        page.mode !== 'disabled' &&
        (registryEntry?.replacePolicy !== 'controlled' || explicit);
      pageOverrides[pageId] = {
        moduleId: page.replaceWith,
        enabled: canReplace,
        explicit,
        reason: page.reason,
      };
    }
  }

  return {
    enabledModules: definition.modules?.enabled ?? [],
    pageOverrides,
    slotPolicies: definition.slots,
    themeProfileId: definition.theme?.defaultProfileId,
    themeProfiles: definition.theme?.profiles,
    workspaceThemeOverrides: definition.theme?.workspaceOverrides,
  } as ProductComposition;
}

export function getProductThemeRuntimeView(
  options: {
    workspaceId?: string | null;
    pageTheme?: ModulePageThemePresentation | null;
  } = {}
): ProductThemeRuntimeView {
  const resolveTheme = () => {
    const composition = getProductComposition();
    return resolveProductThemeRuntimeView(composition, options);
  };

  return options.pageTheme
    ? resolveTheme()
    : cachedDashboardTheme(options.workspaceId ?? null, resolveTheme);
}

function buildCompositionSlotViews(input: {
  host: Awaited<ReturnType<typeof getModuleHost>>;
  composition: ProductComposition;
}): ProductCompositionSlotView[] {
  const enabledModules = new Set(
    input.composition.enabledModules ?? input.host.runtime.contracts.map((contract) => contract.id)
  );
  const views: ProductCompositionSlotView[] = [];

  for (const page of HOST_PAGE_REGISTRY) {
    const plan = resolveHostPageComposition(input.host.runtime, {
      pageId: page.id,
      composition: input.composition,
    });

    for (const slotId of page.slots) {
      const surfaceId = getHostPageSlotSurfaceId(page.id, slotId);
      const slotDefinition = getHostPageSlotDefinition(slotId);
      const policy = input.composition.slotPolicies?.[surfaceId];
      const effectiveMaxContributions =
        policy?.maxContributions ?? slotDefinition.defaultMaxContributions;
      const candidateModules = input.host.runtime.surfaces
        .get(surfaceId)
        .filter((item) => item.definition.mode !== 'replace')
        .filter((item) => enabledModules.has(item.moduleId))
        .map((item) => item.moduleId);
      const activeModules = (plan.slots[slotId] ?? []).map((item) => item.moduleId);
      const slotDiagnostics = plan.diagnostics.filter((item) => item.surfaceId === surfaceId);
      const blockedContributions = slotDiagnostics
        .filter((item) => item.moduleId)
        .map((item) => ({
          moduleId: item.moduleId!,
          severity: item.severity,
          code: item.code,
          message: item.message,
        }));
      const diagnostics: string[] = [];

      for (const moduleId of policy?.allowModules ?? []) {
        if (!enabledModules.has(moduleId)) {
          diagnostics.push(`ALLOW_MODULE_DISABLED: ${moduleId}`);
        }
        if (!candidateModules.includes(moduleId)) {
          diagnostics.push(`ALLOW_MODULE_HAS_NO_SLOT_CONTRIBUTION: ${moduleId}`);
        }
      }

      if (policy?.maxContributions !== undefined && policy.maxContributions < 1) {
        diagnostics.push('MAX_CONTRIBUTIONS_EMPTY');
      }

      views.push({
        pageId: page.id,
        slotId,
        surfaceId,
        configured: Boolean(policy),
        allowModules: policy?.allowModules ?? [],
        denyModules: policy?.denyModules ?? [],
        maxContributions: policy?.maxContributions ?? null,
        effectiveMaxContributions,
        candidateModules,
        activeModules,
        blockedModules: candidateModules.filter((moduleId) => !activeModules.includes(moduleId)),
        blockedContributions,
        diagnostics,
      });
    }
  }

  return views;
}

export async function getProductCompositionView(): Promise<ProductCompositionView> {
  const host = await getModuleHost();
  const composition = getProductComposition();
  const themeProfile = resolveProductThemeScope(composition);
  return {
    supportedLanguages: productPresentation.definition.supportedLanguages,
    enabledModules: composition.enabledModules ?? [],
    brand: resolveProductBrandView(productPresentation.definition),
    visualBaseline: readProductThemeVisualBaseline(),
    themeProfileId: composition.themeProfileId ?? null,
    themeProfile,
    workspaceThemeOverrides: getWorkspaceThemeScopes(composition),
    slots: buildCompositionSlotViews({ host, composition }),
    pages: HOST_PAGE_REGISTRY.map((page) => {
      const plan = resolveHostPageComposition(host.runtime, {
        pageId: page.id,
        composition,
      });
      const configured = composition.pageOverrides?.[page.id] ?? null;
      return {
        pageId: page.id,
        area: page.area,
        replacePolicy: page.replacePolicy,
        configuredModuleId: configured?.moduleId ?? null,
        enabled: configured?.enabled ?? false,
        activeModuleId: plan.activeOverride?.moduleId ?? null,
        replaceCandidates: plan.replaceCandidates.map((item) => item.moduleId),
        diagnostics: plan.diagnostics
          .filter((item) => item.severity !== 'info')
          .map((item) => `${item.code}: ${item.message}`),
      };
    }),
  };
}

export async function getProductThemeDiagnosticsView(): Promise<ProductThemeDiagnosticsView> {
  const host = await getModuleHost();
  const composition = getProductComposition();
  return {
    allowedTokens: HOST_THEME_ALLOWED_TOKENS,
    supportedLanguages: productPresentation.definition.supportedLanguages,
    productProfile: resolveProductThemeScope(composition),
    workspaceProfiles: getWorkspaceThemeScopes(composition),
    modules: host.runtime.contracts
      .filter((contract) => contract.theme.tokens || contract.theme.css)
      .map((contract) => {
        const resolved = resolveModuleThemeTokens(contract.theme.tokens ?? {}, {
          sourceModuleId: contract.id,
          scope: 'site',
        });
        return {
          moduleId: contract.id,
          declaredThemeWrite: contract.permissions.includes(Permission.ThemeWrite),
          hasCss: Boolean(contract.theme.css),
          acceptedTokens: resolved.acceptedTokens,
          rejectedTokens: resolved.rejectedTokens,
        };
      }),
  };
}
