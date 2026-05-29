import enMessages from './locales/en.json';
import zhMessages from './locales/zh.json';

export type WhiteLabelLanguage = 'zh' | 'en';

export function languageFromRequest(request: Request | undefined): WhiteLabelLanguage {
  if (!request) {
    return 'zh';
  }
  const first = new URL(request.url).pathname.split('/').filter(Boolean)[0];
  return first === 'en' ? 'en' : 'zh';
}

export function languageFromValue(value: string | undefined): WhiteLabelLanguage {
  return value === 'en' ? 'en' : 'zh';
}

export function whiteLabelCopy(language: string | undefined) {
  return languageFromValue(language) === 'en' ? enMessages : zhMessages;
}

export function localizedHref(language: string | undefined, path = '/') {
  const lang = languageFromValue(language);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return normalizedPath === '/' ? `/${lang}` : `/${lang}${normalizedPath}`;
}

export function formatCopy(template: string, values: Record<string, string | number>) {
  return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, key: string) =>
    values[key] === undefined ? match : String(values[key])
  );
}
