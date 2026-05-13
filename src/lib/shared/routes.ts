/**
 *
 */

import { defaultLocale, locales, type Locale } from '@/i18n/config';

/**
 */
export type AuthRoute = 'login' | 'register' | 'forgot-password';

/**
 *
 *
 * @example
 * getAuthRoute('login', 'zh') ->'/zh/login'
 * getAuthRoute('register', 'en') ->'/en/register'
 */
export function getAuthRoute(route: AuthRoute, lang: Locale = defaultLocale): string {
  return `/${lang}/${route}`;
}

/**
 *
 *
 * @example
 * getLangRoute('/pricing', 'zh') ->'/zh/pricing'
 * getLangRoute('/dashboard', 'en') ->'/en/dashboard'
 */
export function getLangRoute(path: string, lang: Locale = defaultLocale): string {
  const cleanPath = path.replace(/^\/+|\/+$/g, '');

  const pathSegments = cleanPath.split('/');
  if (pathSegments[0] === lang) {
    return `/${cleanPath}`;
  }

  if (cleanPath === '') {
    return `/${lang}`;
  }

  return `/${lang}/${cleanPath}`;
}

/**
 *
 *
 * @example
 * extractLangFromPath('/zh/pricing') ->'zh'
 * extractLangFromPath('/en/login') ->'en'
 * extractLangFromPath('/pricing') ->'zh' (default)
 */
export function extractLangFromPath(path: string): Locale {
  const segments = path.split('/').filter(Boolean);
  const firstSegment = segments[0];

  if (firstSegment && locales.includes(firstSegment as Locale)) {
    return firstSegment as Locale;
  }

  return defaultLocale;
}

/**
 *
 *
 * @example
 * isAuthRoute('/zh/login') ->true
 * isAuthRoute('/zh/pricing') ->false
 */
export function isAuthRoute(path: string): boolean {
  const authRoutes: AuthRoute[] = ['login', 'register', 'forgot-password'];

  return authRoutes.some((route) => {
    const pattern = new RegExp(`/(zh|en)?/?${route}(/|$)`);
    return pattern.test(path);
  });
}

/**
 *
 *
 *
 * @example
 * // in
 * redirect(getServerRoute('/login', 'zh'))
 */
export function getServerRoute(path: string, lang: Locale = defaultLocale): string {
  return getLangRoute(path, lang);
}
