'use client';

import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';

export interface PluginApiClient {
  fetch(path: string, init?: RequestInit): Promise<Response>;
  json<T = unknown>(path: string, init?: RequestInit): Promise<T>;
}

export interface PluginReactContextValue {
  pluginId: string;
  apiBasePath?: string;
}

export interface PluginProviderProps extends PluginReactContextValue {
  children: ReactNode;
}

export interface UsePluginApiOptions {
  pluginId?: string;
  apiBasePath?: string;
}

const PluginReactContext = createContext<PluginReactContextValue | null>(null);

export function PluginProvider({ pluginId, apiBasePath, children }: PluginProviderProps) {
  const value = useMemo(() => ({ pluginId, apiBasePath }), [pluginId, apiBasePath]);

  return createElement(PluginReactContext.Provider, { value }, children);
}

export function usePluginContext(): PluginReactContextValue {
  const context = useContext(PluginReactContext);

  if (!context) {
    throw new Error('usePluginContext() must be used inside a PluginProvider.');
  }

  return context;
}

export function createPluginApiBasePath(pluginId: string): string {
  return `/api/plugins/${encodeURIComponent(pluginId)}`;
}

function buildPluginApiUrl(basePath: string, apiPath: string): string {
  const normalizedBase = basePath.replace(/\/$/, '');
  const normalizedPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;

  return `${normalizedBase}${normalizedPath}`;
}

export function usePluginApi(options: UsePluginApiOptions = {}): PluginApiClient {
  const context = useContext(PluginReactContext);
  const pluginId = options.pluginId ?? context?.pluginId;
  const apiBasePath =
    options.apiBasePath ??
    context?.apiBasePath ??
    (pluginId ? createPluginApiBasePath(pluginId) : '');

  return useMemo(() => {
    if (!pluginId) {
      const createMissingContextError = () =>
        new Error('usePluginApi() must be used inside a PluginProvider or receive { pluginId }.');

      return {
        async fetch(): Promise<Response> {
          throw createMissingContextError();
        },
        async json<T = unknown>(): Promise<T> {
          throw createMissingContextError();
        },
      };
    }

    const request = (path: string, init?: RequestInit) =>
      fetch(buildPluginApiUrl(apiBasePath, path), init);

    return {
      fetch: request,
      async json<T = unknown>(path: string, init?: RequestInit): Promise<T> {
        const response = await request(path, init);

        if (!response.ok) {
          throw new Error(`Plugin API request failed with ${response.status}`);
        }

        return (await response.json()) as T;
      },
    };
  }, [apiBasePath, pluginId]);
}
