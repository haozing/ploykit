export type HostClientTransitionArea = 'admin' | 'dashboard';

export interface HostClientTransitionInput {
  area: HostClientTransitionArea;
  href: string;
  currentUrl: string;
  button?: number;
  defaultPrevented?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: string | null;
  download?: boolean;
}

export interface HostClientTransitionDecision {
  shouldNavigate: boolean;
  href?: string;
  reason?: string;
}

function isLocalizedAreaPath(pathname: string, area: HostClientTransitionArea): boolean {
  if (pathname === `/${area}` || pathname.startsWith(`/${area}/`)) {
    return true;
  }
  return new RegExp(`^/[a-z]{2}(?:-[A-Z]{2})?/${area}(?:/|$)`).test(pathname);
}

function targetPath(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

export function resolveHostClientTransitionHref(
  input: HostClientTransitionInput
): HostClientTransitionDecision {
  if (input.defaultPrevented) {
    return { shouldNavigate: false, reason: 'event-prevented' };
  }
  if ((input.button ?? 0) !== 0) {
    return { shouldNavigate: false, reason: 'non-primary-button' };
  }
  if (input.metaKey || input.ctrlKey || input.shiftKey || input.altKey) {
    return { shouldNavigate: false, reason: 'modified-click' };
  }
  if (input.target && input.target.toLowerCase() !== '_self') {
    return { shouldNavigate: false, reason: 'targeted-link' };
  }
  if (input.download) {
    return { shouldNavigate: false, reason: 'download-link' };
  }

  let current: URL;
  let target: URL;
  try {
    current = new URL(input.currentUrl);
    target = new URL(input.href, current);
  } catch {
    return { shouldNavigate: false, reason: 'invalid-url' };
  }

  if (target.origin !== current.origin) {
    return { shouldNavigate: false, reason: 'external-origin' };
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { shouldNavigate: false, reason: 'unsupported-protocol' };
  }
  if (!isLocalizedAreaPath(target.pathname, input.area)) {
    return { shouldNavigate: false, reason: 'outside-area' };
  }
  if (target.pathname === current.pathname && target.search === current.search) {
    return { shouldNavigate: false, reason: 'same-document' };
  }

  return { shouldNavigate: true, href: targetPath(target) };
}
