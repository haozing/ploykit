import type { PluginRuntimeContract } from '../contract';
import type {
  RuntimeAppBundle,
  RuntimeBundlePlugin,
  RuntimePluginSuite,
  RuntimeProduct,
} from '../catalog/runtime-catalog-types';

export type PluginModuleLoader = () => Promise<unknown>;

export interface PluginRuntimeMapEntry {
  rootDir?: string;
  sourceDir?: string;
  sourceKind?: 'default' | 'external';
  plugin?: PluginModuleLoader;
  components?: Record<string, PluginModuleLoader>;
  pages?: Record<string, PluginModuleLoader>;
  apis?: Record<string, PluginModuleLoader>;
  lifecycleModules?: Record<string, PluginModuleLoader>;
  jobModules?: Record<string, PluginModuleLoader>;
  webhookModules?: Record<string, PluginModuleLoader>;
  eventModules?: Record<string, PluginModuleLoader>;
  hookModules?: Record<string, PluginModuleLoader>;
  slotModules?: Record<string, PluginModuleLoader>;
  loaderModules?: Record<string, PluginModuleLoader>;
  metadataModules?: Record<string, PluginModuleLoader>;
  runtimeContract?: PluginRuntimeContract;
}

export type { RuntimeAppBundle, RuntimeBundlePlugin, RuntimePluginSuite, RuntimeProduct };
