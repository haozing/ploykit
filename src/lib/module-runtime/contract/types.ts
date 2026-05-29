import type {
  DefinedModule,
  ModuleActionDefinition,
  ModuleDefinition,
  ModuleEventsDefinition,
  ModuleJobDefinition,
  ModuleLifecycleDefinition,
  ModuleConfigFieldDefinition,
  ModuleNavigationItem,
  ModuleDependenciesDefinition,
  ModuleHeadDefinition,
  ModuleMeterDefinition,
  ModuleResourceBindingRequirement,
  ModuleResourcesDefinition,
  ModuleServiceRequirementDefinition,
  ModuleRoutesDefinition,
  ModuleSurfaceDefinition,
  ModuleThemeDefinition,
  ModuleWebhookDefinition,
  PermissionRiskLevel,
  PermissionValue,
} from '@ploykit/module-sdk';

export type RuntimeModuleDefinition = ModuleDefinition | DefinedModule;

export interface ModuleRuntimeCapabilitySummary {
  routes: {
    site: number;
    dashboard: number;
    admin: number;
    api: number;
    publicAliases: number;
  };
  data: {
    tables: readonly string[];
    documents: readonly string[];
    views: readonly string[];
    grants: readonly string[];
    checks: readonly string[];
    migrationMode?: string;
  };
  permissions: readonly {
    value: PermissionValue;
    group: string;
    risk: PermissionRiskLevel;
    scope: string;
    ctxCapability?: string;
  }[];
  backgroundHandlers: {
    jobs: readonly string[];
    eventPublishes: readonly string[];
    eventSubscribes: readonly string[];
    webhooks: readonly string[];
  };
  providerRequirements: {
    services: readonly {
      name: string;
      required: boolean;
      provider?: string;
    }[];
    resourceBindings: readonly {
      name: string;
      kind: string;
      required: boolean;
    }[];
    egressOrigins: readonly string[];
  };
  commercialRequirements: {
    meters: readonly string[];
    routeEntitlements: readonly string[];
    actionEntitlements: readonly string[];
    creditsRequired: boolean;
  };
  presentationContribution: {
    navigation: number;
    surfaces: readonly {
      id: string;
      mode: string;
      area?: string;
      slot?: string;
      visibility?: string;
    }[];
    whiteLabel: boolean;
    replaces: readonly string[];
    themeTokens: readonly string[];
    i18nNamespaces: readonly string[];
  };
}

export interface ModuleRuntimeContract {
  contractVersion: number;
  id: string;
  name: string;
  version: string;
  description?: string;
  permissions: readonly PermissionValue[];
  routes: Required<ModuleRoutesDefinition>;
  navigation: readonly ModuleNavigationItem[];
  surfaces: Readonly<Record<string, ModuleSurfaceDefinition>>;
  resources: ModuleResourcesDefinition;
  theme: ModuleThemeDefinition;
  meters: Readonly<Record<string, ModuleMeterDefinition>>;
  serviceRequirements: Readonly<Record<string, ModuleServiceRequirementDefinition>>;
  resourceBindings: Readonly<Record<string, ModuleResourceBindingRequirement>>;
  config: Readonly<Record<string, ModuleConfigFieldDefinition>>;
  actions: Readonly<Record<string, ModuleActionDefinition>>;
  jobs: Readonly<Record<string, ModuleJobDefinition>>;
  events: Required<ModuleEventsDefinition>;
  webhooks: Readonly<Record<string, ModuleWebhookDefinition>>;
  head: ModuleHeadDefinition;
  lifecycle: ModuleLifecycleDefinition;
  dependencies: ModuleDependenciesDefinition;
  egress: readonly string[];
  parts: RuntimeModuleDefinition['parts'];
  capabilitySummary: ModuleRuntimeCapabilitySummary;
  definition: RuntimeModuleDefinition;
}
