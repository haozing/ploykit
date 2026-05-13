/**
 * Language Context
 *
 * Manages global language state and provides language-related utilities:
 * - Automatically extracts language from URL path and provides current language state
 * - Provides helper functions for generating language-prefixed paths
 * - Provides language switching functionality
 */

'use client';

import { createContext, useContext, ReactNode, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { defaultLocale, locales, type Locale } from '@/i18n/config';

export const supportedLanguages = locales;

interface LanguageContextType {
  /**
   * Current language extracted from URL path
   * For example: '/zh/pricing' returns 'zh'
   */
  currentLang: Locale;

  /**
   * Generate language-prefixed path
   *
   * @param path - Path without language prefix, e.g., '/login', '/pricing'
   * @returns Path with language prefix, e.g., '/zh/login', '/zh/pricing'
   *
   * @example
   * getLangPath('/login') returns '/zh/login'
   * getLangPath('/zh/login') returns '/zh/login' (already has language prefix, no duplicate)
   */
  getLangPath: (path: string) => string;

  /**
   * Switch to specified language and return new path
   *
   * @param lang - Target language
   * @returns New path after language switch
   *
   * @example
   * Current path: /zh/pricing
   * switchLanguage('en') returns '/en/pricing'
   */
  switchLanguage: (lang: Locale) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

/**
 * Extract language from path
 */
function extractLanguageFromPath(pathname: string): Locale {
  const segments = pathname.split('/').filter(Boolean);
  const firstSegment = segments[0];

  if (firstSegment && supportedLanguages.includes(firstSegment as Locale)) {
    return firstSegment as Locale;
  }

  return defaultLocale;
}

/**
 * Remove language prefix from path
 */
function removeLanguagePrefix(pathname: string, lang: Locale): string {
  if (pathname.startsWith(`/${lang}/`)) {
    return pathname.slice(lang.length + 1); // Remove /{lang}
  }
  if (pathname === `/${lang}`) {
    return '/';
  }
  return pathname;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const currentLang = useMemo(() => {
    return extractLanguageFromPath(pathname);
  }, [pathname]);

  const getLangPath = useMemo(() => {
    return (path: string): string => {
      // Clean leading and trailing slashes to prevent duplicate slashes
      const cleanPath = path.replace(/^\/+|\/+$/g, '');

      // Check if path already has language prefix
      const pathSegments = cleanPath.split('/');
      if (pathSegments[0] && supportedLanguages.includes(pathSegments[0] as Locale)) {
        // Already has language prefix, return as-is
        return `/${cleanPath}`;
      }

      // Add language prefix to root path
      if (cleanPath === '') {
        return `/${currentLang}`;
      }
      return `/${currentLang}/${cleanPath}`;
    };
  }, [currentLang]);

  const switchLanguage = useMemo(() => {
    return (lang: Locale): string => {
      const pathWithoutLang = removeLanguagePrefix(pathname, currentLang);

      if (pathWithoutLang === '/') {
        return `/${lang}`;
      }

      return `/${lang}${pathWithoutLang}`;
    };
  }, [pathname, currentLang]);

  const value = useMemo(
    () => ({
      currentLang,
      getLangPath,
      switchLanguage,
    }),
    [currentLang, getLangPath, switchLanguage]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/**
 * Hook to access language context
 *
 * @throws Error if used outside LanguageProvider
 *
 * @example
 * const { currentLang, getLangPath } = useLanguage();
 * const loginPath = getLangPath('/login'); // '/zh/login'
 */
export function useLanguage() {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }

  return context;
}
