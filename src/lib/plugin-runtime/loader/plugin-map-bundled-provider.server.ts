import * as bundledPluginMapModule from './plugin-map-runtime-placeholder';
import type { PluginRuntimeMapEntry } from './plugin-map-types';
import { extractPluginMapArtifact, type PluginMapModule } from './plugin-map-artifact';

export function loadActivePluginMap(): Record<string, PluginRuntimeMapEntry> {
  return extractPluginMapArtifact(
    bundledPluginMapModule as PluginMapModule,
    '@ploykit/plugin-map-runtime'
  ).plugins;
}
