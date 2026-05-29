export function modulePathFromSegments(segments: readonly string[] | undefined): string {
  const cleanSegments = (segments ?? []).filter(Boolean);
  return cleanSegments.length > 0 ? `/${cleanSegments.join('/')}` : '/';
}

export function dashboardHref(modulePath: string): string {
  const path = modulePath.startsWith('/') ? modulePath : `/${modulePath}`;
  return path === '/' ? '/dashboard' : `/dashboard${path}`;
}

export function adminHref(modulePath: string): string {
  const path = modulePath.startsWith('/') ? modulePath : `/${modulePath}`;
  return path === '/' ? '/admin' : `/admin${path}`;
}

export function createHostRequest(pathname: string, init?: RequestInit): Request {
  const baseUrl = process.env.PLOYKIT_HOST_URL ?? 'http://localhost:3000';
  return new Request(new URL(pathname, baseUrl), init);
}

export function hostBaseUrl(): string {
  return process.env.PLOYKIT_HOST_URL ?? 'http://localhost:3000';
}

function firstHeaderValue(value: string | null): string | null {
  return value?.split(',')[0]?.trim() || null;
}

export function requestBaseUrl(request: Request): URL {
  const fallback = new URL(request.url);
  const host = firstHeaderValue(request.headers.get('x-forwarded-host')) ?? request.headers.get('host');
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'));
  const protocol = forwardedProto ? `${forwardedProto.replace(/:$/, '')}:` : fallback.protocol;

  if (!host) {
    return fallback;
  }

  try {
    return new URL(`${protocol}//${host}`);
  } catch {
    return fallback;
  }
}

export function requestUrl(pathname: string, request: Request): URL {
  return new URL(pathname, requestBaseUrl(request));
}
