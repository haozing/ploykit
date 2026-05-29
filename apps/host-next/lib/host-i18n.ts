import enMessages from '../locales/en.json';
import zhMessages from '../locales/zh.json';
import { DEFAULT_LANGUAGE, type SupportedLanguage } from './i18n';

interface MessageDictionary {
  [key: string]: unknown;
}

const messages: Record<SupportedLanguage, MessageDictionary> = {
  zh: zhMessages as MessageDictionary,
  en: enMessages as MessageDictionary,
};

export interface TranslateOptions {
  fallback?: string;
  values?: Record<string, string | number | boolean | null | undefined>;
}

export type HostTranslate = (key: string, options?: TranslateOptions) => string;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPathValue(source: MessageDictionary, key: string): unknown {
  return key.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current)) {
      return undefined;
    }
    return current[segment];
  }, source);
}

function readPath(source: MessageDictionary, key: string): string | null {
  const value = readPathValue(source, key);
  return typeof value === 'string' ? value : null;
}

function interpolate(message: string, values: TranslateOptions['values']): string {
  if (!values) {
    return message;
  }

  return message.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined || value === null ? match : String(value);
  });
}

export function translateHostMessage(
  lang: SupportedLanguage,
  key: string,
  options: TranslateOptions = {}
): string {
  const dictionary = messages[lang] ?? messages[DEFAULT_LANGUAGE];
  const fallbackDictionary = messages[DEFAULT_LANGUAGE];
  const message =
    readPath(dictionary, key) ?? readPath(fallbackDictionary, key) ?? options.fallback ?? key;
  return interpolate(message, options.values);
}

export function createHostTranslator(lang: SupportedLanguage, namespace?: string): HostTranslate {
  return (key, options) =>
    translateHostMessage(lang, namespace ? `${namespace}.${key}` : key, options);
}

export function readHostMessageValue<T>(lang: SupportedLanguage, key: string): T {
  const dictionary = messages[lang] ?? messages[DEFAULT_LANGUAGE];
  const fallbackDictionary = messages[DEFAULT_LANGUAGE];
  const value = readPathValue(dictionary, key) ?? readPathValue(fallbackDictionary, key);

  if (value === undefined) {
    throw new Error(`Missing host locale key: ${key}`);
  }

  return value as T;
}
