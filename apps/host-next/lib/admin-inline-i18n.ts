import { readHostMessageValue } from './host-i18n';
import type { SupportedLanguage } from './i18n';
import { adminInlineEnExact, adminInlineZhExact } from './admin-inline-i18n-dictionaries';
import { adminInlineZhPhrases } from './admin-inline-i18n-phrases';

type InlineValues = Record<string, string | number | boolean | null | undefined>;

function interpolateInline(message: string, values?: InlineValues): string {
  if (!values) {
    return message;
  }
  return message.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined || value === null ? match : String(value);
  });
}

function readAdminInlineCatalog(lang: SupportedLanguage): Record<string, string> {
  try {
    return readHostMessageValue<Record<string, string>>(lang, 'admin.inline');
  } catch {
    return {};
  }
}

export function adminInlineText(
  lang: SupportedLanguage,
  text: string,
  values?: InlineValues
): string {
  const catalogMessage = readAdminInlineCatalog(lang)[text];
  if (catalogMessage !== undefined) {
    return interpolateInline(catalogMessage, values);
  }
  if (lang === 'en') {
    return interpolateInline(adminInlineEnExact[text] ?? text, values);
  }
  const exact = adminInlineZhExact[text];
  if (exact) {
    return interpolateInline(exact, values);
  }
  if (/[\u4e00-\u9fff]/.test(text)) {
    return interpolateInline(text, values);
  }
  const preserved: string[] = [];
  let translated = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (match) => {
    const token = `__INLINE_EMAIL_${preserved.length}__`;
    preserved.push(match);
    return token;
  });
  for (const [pattern, replacement] of adminInlineZhPhrases) {
    translated = translated.replace(pattern, replacement);
  }
  preserved.forEach((value, index) => {
    translated = translated.replace(`__INLINE_EMAIL_${index}__`, value);
  });
  return interpolateInline(translated, values);
}

export function adminInlineColumns(lang: SupportedLanguage, columns: readonly string[]): string[] {
  return columns.map((column) => adminInlineText(lang, column));
}
