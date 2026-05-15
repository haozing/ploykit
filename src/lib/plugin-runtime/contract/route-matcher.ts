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

function dynamicSegmentName(segment: string): string | null {
  if (segment.startsWith(':')) {
    return segment.slice(1);
  }

  if (segment.startsWith('[') && segment.endsWith(']') && !isPluginRouteCatchAllSegment(segment)) {
    return segment.slice(1, -1);
  }

  return null;
}

function catchAllSegmentName(segment: string): string | null {
  if (!isPluginRouteCatchAllSegment(segment)) {
    return null;
  }

  return segment.slice('[...'.length, -1);
}

function splitNormalizedPath(path: string): string[] {
  const normalized = normalizeRuntimePath(path);
  return normalized === '/' ? [] : normalized.slice(1).split('/').filter(Boolean);
}

export interface RuntimePathMatch {
  params: Record<string, string>;
}

export function matchRuntimePathWithParams(pattern: string, path: string): RuntimePathMatch | null {
  const patternSegments = splitNormalizedPath(pattern);
  const pathSegments = splitNormalizedPath(path);
  const params: Record<string, string> = {};

  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index];
    const pathSegment = pathSegments[index];
    const catchAllName = catchAllSegmentName(patternSegment);

    if (catchAllName) {
      params[catchAllName] = pathSegments.slice(index).map(decodeURIComponent).join('/');
      return { params };
    }

    if (pathSegment === undefined) {
      return null;
    }

    const dynamicName = dynamicSegmentName(patternSegment);
    if (dynamicName) {
      params[dynamicName] = decodeURIComponent(pathSegment);
      continue;
    }

    if (patternSegment !== pathSegment) {
      return null;
    }
  }

  return patternSegments.length === pathSegments.length ? { params } : null;
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

export function findRuntimePageRouteMatch(
  routes: readonly RuntimePageRoute[],
  requestPath: string,
  area?: RuntimePageRoute['area']
): { route: RuntimePageRoute; params: Record<string, string> } | null {
  const normalizedPath = normalizeRuntimePath(requestPath);

  for (const route of routes) {
    if (area && route.area !== area) {
      continue;
    }

    const match = matchRuntimePathWithParams(route.path, normalizedPath);
    if (match) {
      return { route, params: match.params };
    }
  }

  return null;
}

export function findRuntimeApiRouteMatch(
  routes: readonly RuntimeApiRoute[],
  requestPath: string,
  method: string
): { route: RuntimeApiRoute; params: Record<string, string> } | null {
  const normalizedMethod = normalizeRuntimeMethod(method);
  const normalizedPath = normalizeRuntimePath(requestPath);

  for (const route of routes) {
    if (route.method !== normalizedMethod) {
      continue;
    }

    const match = matchRuntimePathWithParams(route.path, normalizedPath);
    if (match) {
      return { route, params: match.params };
    }
  }

  return null;
}
