export interface ModuleRoutePathMatch {
  params: Record<string, string>;
}

interface CompiledSegment {
  kind: 'static' | 'param' | 'catchAll';
  value: string;
}

export interface CompiledModuleRoutePath {
  path: string;
  segments: readonly CompiledSegment[];
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function normalizePath(value: string): string {
  const path = `/${trimSlashes(value)}`;
  return path === '/' ? '/' : path.replace(/\/+/g, '/');
}

function compileSegment(segment: string): CompiledSegment {
  const catchAll = segment.match(/^\[\.\.\.([A-Za-z][A-Za-z0-9_]*)\]$/);
  if (catchAll) {
    return { kind: 'catchAll', value: catchAll[1] };
  }

  const param =
    segment.match(/^\[([A-Za-z][A-Za-z0-9_]*)\]$/) ?? segment.match(/^:([A-Za-z][A-Za-z0-9_]*)$/);
  if (param) {
    return { kind: 'param', value: param[1] };
  }

  return { kind: 'static', value: segment };
}

export function compileModuleRoutePath(path: string): CompiledModuleRoutePath {
  const normalized = normalizePath(path);
  const segments = normalized === '/' ? [] : trimSlashes(normalized).split('/').map(compileSegment);
  return { path: normalized, segments };
}

export function matchModuleRoutePath(
  compiled: CompiledModuleRoutePath,
  pathname: string
): ModuleRoutePathMatch | null {
  const target = normalizePath(pathname);
  const targetSegments = target === '/' ? [] : trimSlashes(target).split('/');
  const params: Record<string, string> = {};

  for (let index = 0; index < compiled.segments.length; index += 1) {
    const segment = compiled.segments[index];
    const targetSegment = targetSegments[index];

    if (segment.kind === 'catchAll') {
      const rest = targetSegments.slice(index);
      if (rest.length === 0) {
        return null;
      }
      params[segment.value] = rest.map(decodeURIComponent).join('/');
      return { params };
    }

    if (targetSegment === undefined) {
      return null;
    }

    if (segment.kind === 'static' && segment.value !== targetSegment) {
      return null;
    }

    if (segment.kind === 'param') {
      params[segment.value] = decodeURIComponent(targetSegment);
    }
  }

  return targetSegments.length === compiled.segments.length ? { params } : null;
}
