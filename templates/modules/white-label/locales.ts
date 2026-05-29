import enMessages from './locales/en.json';
import zhMessages from './locales/zh.json';

export type TemplateLanguage = 'zh' | 'en';

export function languageFromRequest(request: Request | undefined): TemplateLanguage {
  if (!request) {
    return 'zh';
  }
  const first = new URL(request.url).pathname.split('/').filter(Boolean)[0];
  return first === 'en' ? 'en' : 'zh';
}

export function languageFromValue(value: string | undefined): TemplateLanguage {
  return value === 'en' ? 'en' : 'zh';
}

export function templateCopy(language: string | undefined) {
  return languageFromValue(language) === 'en' ? enMessages : zhMessages;
}

export function localizedHref(language: string | undefined, path = '/') {
  const lang = languageFromValue(language);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return normalizedPath === '/' ? `/${lang}` : `/${lang}${normalizedPath}`;
}
