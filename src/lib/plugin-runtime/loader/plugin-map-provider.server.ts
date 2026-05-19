import fs from 'fs';
import { createRequire } from 'module';
import * as bundledPluginMapModule from '@/lib/plugin-map';
import {
  getActivePluginMapFiles,
  isLoadableRuntimePluginMapFile,
  type PluginMapFileSet,
} from '../plugin-map-files';
import type { PluginRuntimeMapEntry } from './plugin-map-types';
import { extractPluginMapArtifact, type PluginMapModule } from './plugin-map-artifact';

const requireRuntimePluginMap = createRequire(import.meta.url);

function loadRuntimePluginMapFromFile(
  activeFiles: PluginMapFileSet
): Record<string, PluginRuntimeMapEntry> {
  if (!isLoadableRuntimePluginMapFile(activeFiles.mapFile)) {
    throw new Error(
      `Active runtime plugin map file must be a CommonJS .cjs or .js artifact: ${activeFiles.mapFile}. Run npm run plugins:scan:runtime or update PLOYKIT_PLUGIN_MAP_FILE.`
    );
  }

  if (!fs.existsSync(activeFiles.mapFile)) {
    throw new Error(
      `Active runtime plugin map file does not exist: ${activeFiles.mapFile}. Run npm run plugins:scan:runtime before starting the app.`
    );
  }

  try {
    const resolved = requireRuntimePluginMap.resolve(activeFiles.mapFile);
    delete requireRuntimePluginMap.cache[resolved];
    const loaded = requireRuntimePluginMap(activeFiles.mapFile) as PluginMapModule;
    return extractPluginMapArtifact(loaded, activeFiles.mapFile).plugins;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load runtime plugin map "${activeFiles.mapFile}": ${message}`);
  }
}

export function loadActivePluginMap(
  activeFiles = getActivePluginMapFiles()
): Record<string, PluginRuntimeMapEntry> {
  const bundledArtifact = extractPluginMapArtifact(
    bundledPluginMapModule as PluginMapModule,
    '@/lib/plugin-map'
  );

  if (!activeFiles.runtimeArtifact || bundledArtifact.kind === 'runtime') {
    return bundledArtifact.plugins;
  }

  return loadRuntimePluginMapFromFile(activeFiles);
}
