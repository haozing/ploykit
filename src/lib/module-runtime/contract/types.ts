import type {
  DefinedModule,
  ModuleActionDefinition,
  ModuleApiDefinitionContract,
  ModuleDefinition,
  ModuleEventsDefinition,
  ModuleJobDefinition,
  ModuleAssetsDefinition,
  ModuleNavigationItem,
  ModulePageDefinition,
  ModuleResourceDefinition,
  ModuleServiceRequirementDefinition,
  ModuleSurfaceDefinition,
  ModuleWebhookDefinition,
  PermissionRiskLevel,
  PermissionValue,
} from '@ploykit/module-sdk';

export type RuntimeModuleDefinition = {
  id: string;
  name: string;
  version: string;
  profile?: ModuleDefinition['profile'];
  [key: string]: any;
};

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
    resourceBindings: readonly unknown[];
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
  id: string;
  name: string;
  version: string;
  description?: string;
  permissions: readonly PermissionValue[];
  pages: readonly ModulePageDefinition[];
  apis: readonly ModuleApiDefinitionContract[];
  navigation: readonly ModuleNavigationItem[];
  surfaces: Readonly<Record<string, ModuleSurfaceDefinition>>;
  assets: ModuleAssetsDefinition;
  resources: Readonly<Record<string, ModuleResourceDefinition>>;
  theme: any;
  meters: Readonly<Record<string, any>>;
  serviceRequirements: Readonly<Record<string, ModuleServiceRequirementDefinition>>;
  resourceBindings: Readonly<Record<string, any>>;
  config: Readonly<Record<string, any>>;
  actions: Readonly<Record<string, ModuleActionDefinition>>;
  jobs: Readonly<Record<string, ModuleJobDefinition>>;
  events: Required<ModuleEventsDefinition>;
  webhooks: Readonly<Record<string, ModuleWebhookDefinition>>;
  head: any;
  dependencies: any;
  egress: readonly string[];
  parts: Record<string, string>;
  profile: ModuleDefinition['profile'];
  capabilities: NonNullable<ModuleDefinition['capabilities']>;
  commercial: NonNullable<ModuleDefinition['commercial']>;
  capabilitySummary: ModuleRuntimeCapabilitySummary;
  definition: RuntimeModuleDefinition;
}
