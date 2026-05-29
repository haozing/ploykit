import { DEFAULT_LANGUAGE, type SupportedLanguage } from './i18n';

export interface HostFormatOptions {
  timeZone?: string;
  now?: number;
}

const LOCALE_BY_LANGUAGE: Record<SupportedLanguage, string> = {
  zh: 'zh-CN',
  en: 'en-US',
};

function localeForLanguage(language: SupportedLanguage): string {
  return LOCALE_BY_LANGUAGE[language] ?? LOCALE_BY_LANGUAGE[DEFAULT_LANGUAGE];
}

export function formatNumber(
  value: number,
  language: SupportedLanguage = DEFAULT_LANGUAGE,
  options: Intl.NumberFormatOptions = {}
): string {
  return new Intl.NumberFormat(localeForLanguage(language), options).format(value);
}

export function formatBytes(
  bytes: number,
  language: SupportedLanguage = DEFAULT_LANGUAGE
): string {
  const safeBytes = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (safeBytes < 1024) {
    return `${formatNumber(safeBytes, language, { maximumFractionDigits: 0 })} B`;
  }
  if (safeBytes < 1024 * 1024) {
    return `${formatNumber(safeBytes / 1024, language, {
      maximumFractionDigits: 1,
      minimumFractionDigits: 1,
    })} KB`;
  }
  return `${formatNumber(safeBytes / 1024 / 1024, language, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })} MB`;
}

export function formatCurrencyMinor(
  amount: number,
  currency: string,
  language: SupportedLanguage = DEFAULT_LANGUAGE
): string {
  const normalizedCurrency = currency.trim().toUpperCase();
  try {
    return new Intl.NumberFormat(localeForLanguage(language), {
      style: 'currency',
      currency: normalizedCurrency,
      maximumFractionDigits: 2,
    }).format(amount / 100);
  } catch {
    return `${formatNumber(amount, language)} ${normalizedCurrency || 'CUR'}`;
  }
}

export function formatDate(
  value: string | number | Date,
  language: SupportedLanguage = DEFAULT_LANGUAGE,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return new Intl.DateTimeFormat(localeForLanguage(language), options).format(date);
}

export function formatRelativeTime(
  value: string | number | Date | null | undefined,
  language: SupportedLanguage = DEFAULT_LANGUAGE,
  options: HostFormatOptions = {}
): string {
  const date = value instanceof Date ? value : new Date(value ?? '');
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  const now = options.now ?? Date.now();
  const elapsed = Math.max(0, now - date.getTime());
  const hours = Math.floor(elapsed / (60 * 60 * 1000));
  if (hours < 1) {
    return language === 'zh' ? '刚刚' : 'just now';
  }
  if (hours < 24) {
    return language === 'zh' ? `${hours} 小时前` : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return language === 'zh' ? `${days} 天前` : `${days}d ago`;
  }
  return formatDate(date, language, {
    month: 'short',
    day: 'numeric',
    timeZone: options.timeZone,
  });
}

export function createHostFormatter(
  language: SupportedLanguage,
  options: HostFormatOptions = {}
) {
  return {
    number(value: number, numberOptions?: Intl.NumberFormatOptions) {
      return formatNumber(value, language, numberOptions);
    },
    bytes(value: number) {
      return formatBytes(value, language);
    },
    currencyMinor(value: number, currency: string) {
      return formatCurrencyMinor(value, currency, language);
    },
    date(value: string | number | Date, dateOptions?: Intl.DateTimeFormatOptions) {
      return formatDate(value, language, {
        timeZone: options.timeZone,
        ...(dateOptions ?? {}),
      });
    },
    relativeTime(value: string | number | Date | null | undefined) {
      return formatRelativeTime(value, language, options);
    },
  };
}
