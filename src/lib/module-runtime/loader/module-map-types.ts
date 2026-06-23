import type { ModuleRuntimeContract } from '../contract';
import type {
  ModuleNavigationItem,
  ModuleProductDefinition,
  ModuleQualityDefinition,
} from '@ploykit/module-sdk';

export type ModuleLoader = () => Promise<unknown>;
export type ModuleMapLocaleMessages = Record<string, unknown>;

export interface ModuleMapCapabilitySummary {
  routes: number;
  dataModels: number;
  permissions: number;
  backgroundHandlers: number;
  providerRequirements: number;
  commercialRequirements: number;
  presentationContributions: number;
}

export interface ModuleMapReleaseMetadata {
  generatedAt: string;
  buildId: string;
  sourceHash: string;
  contractDigest: string;
  sourceFiles: readonly string[];
  capabilitySummary: ModuleMapCapabilitySummary;
}

export interface ModuleRuntimeMapEntry {
  rootDir?: string;
  release?: ModuleMapReleaseMetadata;
  product?: ModuleProductDefinition;
  quality?: ModuleQualityDefinition;
  navigation?: ModuleNavigationItem | readonly ModuleNavigationItem[];
  module?: ModuleLoader;
  pages?: Record<string, ModuleLoader>;
  apis?: Record<string, ModuleLoader>;
  loaders?: Record<string, ModuleLoader>;
  actions?: Record<string, ModuleLoader>;
  services?: Record<string, ModuleLoader>;
  components?: Record<string, ModuleLoader>;
  surfaces?: Record<string, ModuleLoader>;
  lifecycle?: Record<string, ModuleLoader>;
  jobs?: Record<string, ModuleLoader>;
  events?: Record<string, ModuleLoader>;
  webhooks?: Record<string, ModuleLoader>;
  assets?: readonly string[];
  messages?: Record<string, ModuleMapLocaleMessages>;
  runtimeContract?: ModuleRuntimeContract;
}

export interface ModuleMapArtifact {
  kind: 'source' | 'runtime';
  buildId?: string;
  generatedAt?: string;
  modules: Record<string, ModuleRuntimeMapEntry>;
}
