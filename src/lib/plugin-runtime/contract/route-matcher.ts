import type { PluginHttpMethod } from '@ploykit/plugin-sdk';
import {
  isPluginRouteCatchAllSegment,
  isPluginRouteDynamicSegment,
  normalizePluginRoutePath,
} from '@/plugin-sdk/route-patterns';
import type { RuntimeApiRoute, RuntimePageRoute } from './types';

export function normalizeRuntimePath(path: string): string {
  return normalizePluginRoutePath(path);
}

export function normalizeRuntimeMethod(method: string): PluginHttpMethod {
  return method.toUpperCase() as PluginHttpMethod;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function segmentToRegex(segment: string): string {
  if (isPluginRouteCatchAllSegment(segment)) {
    return '.*';
  }

  if (isPluginRouteDynamicSegment(segment)) {
    return '[^/]+';
  }

  return escapeRegExp(segment);
}

export function matchRuntimePath(pattern: string, path: string): boolean {
  const normalizedPattern = normalizeRuntimePath(pattern);
  const normalizedPath = normalizeRuntimePath(path);

  if (normalizedPattern === '/') {
    return normalizedPath === '/';
  }

  const regexPattern = normalizedPattern.split('/').filter(Boolean).map(segmentToRegex).join('/');
  return new RegExp(`^/${regexPattern}$`).test(normalizedPath);
}

export function findRuntimePageRoute(
  routes: readonly RuntimePageRoute[],
  requestPath: string,
  area?: RuntimePageRoute['area']
): RuntimePageRoute | null {
  return (
    routes.find(
      (route) =>
        (!area || route.area === area) &&
        matchRuntimePath(route.path, normalizeRuntimePath(requestPath))
    ) ?? null
  );
}

export function findRuntimeApiRoute(
  routes: readonly RuntimeApiRoute[],
  requestPath: string,
  method: string
): RuntimeApiRoute | null {
  const normalizedMethod = normalizeRuntimeMethod(method);

  return (
    routes.find(
      (route) =>
        route.method === normalizedMethod &&
        matchRuntimePath(route.path, normalizeRuntimePath(requestPath))
    ) ?? null
  );
}
