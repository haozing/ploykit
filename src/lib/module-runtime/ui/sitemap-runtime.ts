import type { ModuleRuntimeHost } from '../host';

export interface ModuleSitemapEntry {
  moduleId: string;
  path: string;
  canonicalPath: string;
  source: 'route' | 'alias' | 'publicAlias';
  url?: string;
}

export interface CreateModuleSitemapEntriesOptions {
  baseUrl?: string;
}

export function createModuleSitemapEntries(
  host: ModuleRuntimeHost,
  options: CreateModuleSitemapEntriesOptions = {}
): ModuleSitemapEntry[] {
  return host.routes
    .filter((entry) => entry.kind === 'site' && entry.source !== 'alias')
    .map((entry) => ({
      moduleId: entry.moduleId,
      path: entry.path,
      canonicalPath: entry.canonicalPath,
      source: entry.source,
      url: options.baseUrl ? new URL(entry.path, options.baseUrl).toString() : undefined,
    }));
}
