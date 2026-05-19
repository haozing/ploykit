import type { PluginRuntimeMapEntry } from './plugin-map-types';

export type PluginMapArtifactKind = 'source' | 'runtime';

export interface PluginMapArtifact {
  kind: PluginMapArtifactKind;
  plugins: Record<string, PluginRuntimeMapEntry>;
}

export interface PluginMapModule {
  PLUGIN_MAP?: Record<string, PluginRuntimeMapEntry>;
  PLUGIN_MAP_ARTIFACT?: PluginMapArtifact;
  default?: {
    PLUGIN_MAP?: Record<string, PluginRuntimeMapEntry>;
    PLUGIN_MAP_ARTIFACT?: PluginMapArtifact;
  };
}

function assertPluginMap(value: unknown, file: string): Record<string, PluginRuntimeMapEntry> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, PluginRuntimeMapEntry>;
  }

  throw new Error(`Runtime plugin map "${file}" does not export a PLUGIN_MAP object.`);
}

export function extractPluginMapArtifact(module: PluginMapModule, file: string): PluginMapArtifact {
  const artifact = module.PLUGIN_MAP_ARTIFACT ?? module.default?.PLUGIN_MAP_ARTIFACT;
  const plugins = assertPluginMap(
    artifact?.plugins ?? module.PLUGIN_MAP ?? module.default?.PLUGIN_MAP,
    file
  );

  return {
    kind: artifact?.kind === 'runtime' ? 'runtime' : 'source',
    plugins,
  };
}
