import type { ModuleAssetsDefinition } from './types';

export function assets(definition: ModuleAssetsDefinition): ModuleAssetsDefinition {
  return Object.freeze({
    ...definition,
    locales: definition.locales ? Object.freeze({ ...definition.locales }) : undefined,
    icons: definition.icons ? Object.freeze({ ...definition.icons }) : undefined,
    assets: definition.assets ? Object.freeze([...definition.assets]) : undefined,
  });
}
