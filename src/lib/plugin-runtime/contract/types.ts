import type {
  DefinedPlugin,
  PluginConfigDefinition,
  PluginCommercialRequirement,
  PluginDataDefinition,
  PluginDefinition,
  PluginDependencyDefinition,
  PluginEventDefinition,
  PluginHooksDefinition,
  PluginHttpMethod,
  PluginHostPageCacheDefinition,
  PluginHostPageI18nDefinition,
  PluginHostPageOverrideMode,
  PluginHostPageSeoDefinition,
  PluginHostPageShellDefinition,
  PluginHostPageSlotPosition,
  PluginJobDefinition,
  PluginKind,
  PluginMenuDefinition,
  PluginMeterDefinition,
  PluginResourceBindingDefinition,
  PluginPublicRouteAlias,
  PluginResourcesDefinition,
  PluginRouteAuth,
  PluginRouteLayout,
  PluginRouteMachineAuth,
  PluginAnonymousPolicy,
  PluginThemeDefinition,
  PluginToolRouteRuntimeMetadata,
  PluginServiceRequirementDefinition,
  PluginSlotsDefinition,
  PluginTrustLevel,
  PluginWebhookDefinition,
} from '@ploykit/plugin-sdk';
import type { PermissionValue } from '@ploykit/plugin-sdk';

export type RuntimePluginDefinition = PluginDefinition | DefinedPlugin;
export type RuntimeRouteKind = 'page' | 'api';
export type RuntimeRouteArea = 'public' | 'admin';

export interface RuntimeRouteBase {
  kind: RuntimeRouteKind;
  path: string;
  auth: PluginRouteAuth;
  layout: PluginRouteLayout;
  permissions: readonly PermissionValue[];
  commercial?: PluginCommercialRequirement;
}

export interface RuntimePageRoute extends RuntimeRouteBase {
  kind: 'page';
  component: string;
  area: RuntimeRouteArea;
  publicAliases: readonly PluginPublicRouteAlias[];
  tool?: PluginToolRouteRuntimeMetadata;
}

export interface RuntimeApiRoute extends RuntimeRouteBase {
  kind: 'api';
  handler: string;
  method: PluginHttpMethod;
  machineAuth?: PluginRouteMachineAuth;
  anonymousPolicy?: PluginAnonymousPolicy;
}

export type RuntimeRoute = RuntimePageRoute | RuntimeApiRoute;

export interface RuntimeHostPageSlot {
  page: string;
  position: Exclude<PluginHostPageSlotPosition, 'main.replace'>;
  component: string;
  priority: number;
}

export interface RuntimeHostPageOverride {
  page: string;
  mode: PluginHostPageOverrideMode;
  component: string;
  priority: number;
  shell: Required<
    Pick<PluginHostPageShellDefinition, 'layout' | 'header' | 'footer' | 'container'>
  > &
    Pick<PluginHostPageShellDefinition, 'activeMenuPath'>;
  seo: PluginHostPageSeoDefinition;
  i18n: PluginHostPageI18nDefinition;
  cache?: PluginHostPageCacheDefinition;
}

export interface RuntimeHostPages {
  slots: RuntimeHostPageSlot[];
  overrides: RuntimeHostPageOverride[];
}

export const EMPTY_RUNTIME_HOST_PAGES: RuntimeHostPages = {
  slots: [],
  overrides: [],
};

export interface PluginRuntimeContract {
  id: string;
  name: string;
  version: string;
  kind: PluginKind;
  trustLevel: PluginTrustLevel;
  permissions: readonly PermissionValue[];
  data?: PluginDataDefinition;
  menu: readonly PluginMenuDefinition[];
  slots: PluginSlotsDefinition;
  hostPages?: RuntimeHostPages;
  resources: PluginResourcesDefinition;
  theme?: PluginThemeDefinition;
  config?: PluginConfigDefinition;
  events: PluginEventDefinition;
  jobs: Readonly<Record<string, PluginJobDefinition>>;
  webhooks: Readonly<Record<string, PluginWebhookDefinition>>;
  hooks: PluginHooksDefinition;
  meters: readonly PluginMeterDefinition[];
  serviceRequirements: readonly PluginServiceRequirementDefinition[];
  resourceBindings: readonly PluginResourceBindingDefinition[];
  dependencies?: PluginDependencyDefinition;
  egress: readonly string[];
  definition: DefinedPlugin | PluginDefinition;
  routes: {
    pages: RuntimePageRoute[];
    apis: RuntimeApiRoute[];
    all: RuntimeRoute[];
  };
  lifecycle: NonNullable<PluginDefinition['lifecycle']>;
}

export interface PluginRuntimeContractValidationResult {
  valid: boolean;
  diagnostics: Array<{
    code: string;
    message: string;
    path?: string;
    severity: 'error' | 'warning' | 'info';
    fix?: string;
  }>;
}
