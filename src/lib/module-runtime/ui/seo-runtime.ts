import type { ResolvedModulePageRoute } from '../adapters';

export interface ModuleOpenGraphMetadata {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
}

export interface ModuleSeoMetadata {
  title?: string;
  description?: string;
  canonical?: string;
  robots?: string;
  openGraph?: ModuleOpenGraphMetadata;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function normalizeModuleSeoMetadata(
  metadata: unknown,
  fallbackCanonical?: string
): ModuleSeoMetadata {
  if (!isRecord(metadata)) {
    return fallbackCanonical ? { canonical: fallbackCanonical } : {};
  }

  const openGraph = isRecord(metadata.openGraph)
    ? {
        title: readString(metadata.openGraph.title),
        description: readString(metadata.openGraph.description),
        image: readString(metadata.openGraph.image),
        url: readString(metadata.openGraph.url),
      }
    : undefined;

  return {
    title: readString(metadata.title),
    description: readString(metadata.description),
    canonical: readString(metadata.canonical) ?? fallbackCanonical,
    robots: readString(metadata.robots),
    openGraph,
  };
}

export function createModulePageSeoMetadata(
  page: ResolvedModulePageRoute,
  hostBaseUrl?: string
): ModuleSeoMetadata {
  const canonicalPath = page.routeSource === 'publicAlias' ? page.matchedPath : page.canonicalPath;
  const fallbackCanonical = hostBaseUrl
    ? new URL(canonicalPath, hostBaseUrl).toString()
    : canonicalPath;
  return normalizeModuleSeoMetadata(page.metadata, fallbackCanonical);
}
