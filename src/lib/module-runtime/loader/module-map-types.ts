import type { ModuleRuntimeContract } from '../contract';
import type { ModuleProductDefinition, ModuleQualityDefinition } from '@ploykit/module-sdk';

export type ModuleLoader = () => Promise<unknown>;

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
  sourceDir?: string;
  sourceKind?: 'default' | 'external';
  release?: ModuleMapReleaseMetadata;
  product?: ModuleProductDefinition;
  quality?: ModuleQualityDefinition;
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
  runtimeContract?: ModuleRuntimeContract;
}

export interface ModuleMapArtifact {
  kind: 'source' | 'runtime';
  buildId?: string;
  generatedAt?: string;
  modules: Record<string, ModuleRuntimeMapEntry>;
}
