/**
 * Client-side authentication helpers
 *
 * Provides utilities for handling session expiration in client components.
 * - `redirectToLogin` ensures users are routed to the login page with a callback URL.
 * - `apiFetch` wraps the native fetch API and automatically redirects when a response
 *   returns HTTP 401 (unauthorized).
 *
 * Updated to support multi-language routing (e.g., /zh/login, /en/login)
 */

import { HTTP_STATUS } from '@/lib/_core/constants';
import { defaultLocale, locales, type Locale } from '@/i18n/config';

/**
 * Auth related routes (without language prefix)
 */
const AUTH_ROUTES = ['login', 'register', 'forgot-password'];
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Extract language from pathname (e.g., /zh/pricing -> 'zh', /pricing -> default locale)
 */
function extractLanguageFromPath(pathname: string): Locale {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length > 0 && locales.includes(segments[0] as Locale)) {
    return segments[0] as Locale;
  }
  return defaultLocale;
}

/**
 * Build a login path with the appropriate language prefix
 */
function getLoginPath(lang: Locale = defaultLocale): string {
  return `/${lang}/login`;
}

/**
 * Internal redirect guard so we don't trigger multiple redirects when several requests fail.
 */
let isRedirecting = false;

/**
 * Determine whether the current path is already an auth route.
 * Handles both language-prefixed routes (/zh/login) and non-prefixed routes (/login)
 */
function isAuthRoute(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);

  // Check if first segment is a language code
  if (segments.length > 0 && locales.includes(segments[0] as Locale)) {
    // Language-prefixed path: check second segment
    return segments.length > 1 && AUTH_ROUTES.includes(segments[1]);
  }

  // Non-prefixed path: check first segment
  return segments.length > 0 && AUTH_ROUTES.includes(segments[0]);
}

/**
 * Build a safe callback URL for redirecting after login.
 *
 * Ensures we only use same-origin paths to prevent open redirects.
 */
function buildCallbackUrl(explicit?: string): string | null {
  if (explicit) {
    try {
      // Treat explicit value as relative path. If it is absolute, only allow same-origin.
      const asUrl = new URL(
        explicit,
        typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
      );
      if (
        asUrl.origin !== (typeof window !== 'undefined' ? window.location.origin : asUrl.origin)
      ) {
        return null;
      }
      return `${asUrl.pathname}${asUrl.search}`;
    } catch {
      return null;
    }
  }

  if (typeof window === 'undefined') {
    return null;
  }

  const { pathname, search } = window.location;

  if (isAuthRoute(pathname)) {
    return null;
  }

  return `${pathname}${search}`;
}

/**
 * Redirect the user to the login page, preserving their current location.
 *
 * @param options.callbackUrl Optional explicit callback path.
 */
export function redirectToLogin(options: { callbackUrl?: string } = {}): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (isRedirecting) {
    return;
  }

  const callbackUrl = buildCallbackUrl(options.callbackUrl);

  // Avoid redirect loops when already on an auth route.
  if (callbackUrl === null && isAuthRoute(window.location.pathname)) {
    return;
  }

  // Extract language from current path
  const currentLang = extractLanguageFromPath(window.location.pathname);
  const loginPath = getLoginPath(currentLang);
  const loginUrl = new URL(loginPath, window.location.origin);

  if (callbackUrl && callbackUrl !== loginPath) {
    loginUrl.searchParams.set('callbackUrl', callbackUrl);
  }

  isRedirecting = true;
  window.location.assign(loginUrl.toString());
}

/**
 * Extended fetch options that include redirect behaviour for unauthorized responses.
 */
export interface ApiFetchOptions extends RequestInit {
  /**
   * Whether to trigger a login redirect when the response is unauthorized.
   * Defaults to true.
   */
  redirectOnUnauthorized?: boolean;
}

/**
 * Fetch wrapper that automatically redirects to login when a request returns 401.
 *
 * @param input - Request URL or Request object.
 * @param init - Fetch options (with optional redirect flag).
 * @returns Fetch Response.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: ApiFetchOptions
): Promise<Response> {
  const { redirectOnUnauthorized = true, ...requestInit } = init ?? {};
  const method = (
    requestInit.method ||
    (input instanceof Request ? input.method : undefined) ||
    'GET'
  ).toUpperCase();
  const headers = new Headers(
    requestInit.headers ?? (input instanceof Request ? input.headers : undefined)
  );
  const shouldAttachCsrfSignal =
    STATE_CHANGING_METHODS.has(method) && !headers.has('X-Requested-With');

  if (shouldAttachCsrfSignal) {
    headers.set('X-Requested-With', 'XMLHttpRequest');
  }

  const response = await fetch(
    input,
    shouldAttachCsrfSignal || requestInit.headers
      ? {
          ...requestInit,
          headers,
        }
      : requestInit
  );

  if (redirectOnUnauthorized && response.status === HTTP_STATUS.UNAUTHORIZED) {
    redirectToLogin();
  }

  return response;
}
