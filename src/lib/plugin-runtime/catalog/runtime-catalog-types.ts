import type { PlanCapabilityDefinition } from '@/lib/entitlements/plan-capability-types';
import type { ProductScopeProfile } from '@/lib/product-scope/product-scope-types';

export interface RuntimeProduct {
  id: string;
  name: string;
  runtimeKey?: string;
  defaultLocale?: string;
  status?: string;
  scopeProfile?: ProductScopeProfile;
  planCapabilities?: PlanCapabilityDefinition[];
  metadata?: Record<string, unknown>;
}

export interface RuntimePluginSuite {
  id: string;
  productId: string;
  name: string;
  version?: string;
  status?: string;
  plugins: string[];
  menu?: {
    group: string;
    labelKey?: string;
    fallbackLabel?: string;
  };
  billing?: {
    namespace: string;
    primaryCreditMetric?: string;
  };
  sharedServiceConnections?: Array<Record<string, unknown>>;
  sharedResourceBindings?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

export interface RuntimeBundlePlugin {
  pluginId: string;
  enableByDefault: boolean;
  required: boolean;
}

export interface RuntimeAppBundle {
  id: string;
  productId: string;
  suiteId?: string;
  name: string;
  version?: string;
  sourceType?: string;
  sourceRef?: string;
  plugins: RuntimeBundlePlugin[];
  seeds?: {
    serviceConnections?: Array<Record<string, unknown>>;
    resourceBindings?: Array<Record<string, unknown>>;
  };
  healthChecks?: Array<Record<string, unknown>>;
  dependencies?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface RuntimeCatalogDocument {
  version?: number;
  products?: RuntimeProduct[];
  suites?: RuntimePluginSuite[];
  bundles?: RuntimeAppBundle[];
}
