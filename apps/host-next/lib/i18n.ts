export const SUPPORTED_LANGUAGES = ['zh', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: SupportedLanguage = 'zh';
export const HOST_LANGUAGE_HEADER = 'x-ploykit-lang';
export const HOST_PATHNAME_HEADER = 'x-ploykit-pathname';

export type LocalizedCopy<T> = Record<SupportedLanguage, T>;

export function isSupportedLanguage(value: string): value is SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(value as SupportedLanguage);
}

export function languageFromPathname(pathname: string | null | undefined): SupportedLanguage {
  const segment = pathname?.split('/').filter(Boolean)[0];
  return segment && isSupportedLanguage(segment) ? segment : DEFAULT_LANGUAGE;
}

export function languageFromHeaders(headers: Pick<Headers, 'get'>): SupportedLanguage {
  const explicit = headers.get(HOST_LANGUAGE_HEADER);
  if (explicit && isSupportedLanguage(explicit)) {
    return explicit;
  }
  return languageFromPathname(headers.get(HOST_PATHNAME_HEADER));
}

export function languageFromRequest(request: Request): SupportedLanguage {
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return languageFromPathname(new URL(referer).pathname);
    } catch {
      return languageFromHeaders(request.headers);
    }
  }
  return languageFromHeaders(request.headers);
}

export function stripLanguagePrefix(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] && isSupportedLanguage(parts[0])) {
    const rest = parts.slice(1).join('/');
    return rest ? `/${rest}` : '/';
  }
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

export function localizedPath(lang: SupportedLanguage, path = '/'): string {
  const normalizedPath = stripLanguagePrefix(path.startsWith('/') ? path : `/${path}`);
  return normalizedPath === '/' ? `/${lang}` : `/${lang}${normalizedPath}`;
}

export function localizedAdminPath(lang: SupportedLanguage, path = '/'): string {
  const suffix = path === '/' ? '' : path.startsWith('/') ? path : `/${path}`;
  return localizedPath(lang, `/admin${suffix}`);
}

export function localizedDashboardPath(lang: SupportedLanguage, path = '/'): string {
  const suffix = path === '/' ? '' : path.startsWith('/') ? path : `/${path}`;
  return localizedPath(lang, `/dashboard${suffix}`);
}

export function localized<T>(lang: SupportedLanguage, copy: LocalizedCopy<T>): T {
  return copy[lang] ?? copy[DEFAULT_LANGUAGE];
}

export function selectLanguageCopy<T>(lang: SupportedLanguage, copy: LocalizedCopy<T>): T {
  return copy[lang] ?? copy[DEFAULT_LANGUAGE];
}
