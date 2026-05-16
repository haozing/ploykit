import type { PluginI18nRuntime, PluginMessages } from './types';

export interface PluginTranslateOptions {
  fallback?: string;
  values?: Record<string, string | number | boolean | null | undefined>;
}

export type PluginTranslate = (key: string, options?: PluginTranslateOptions) => string;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMessage(messages: PluginMessages, key: string): string | null {
  const value = key.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current)) {
      return undefined;
    }

    return current[segment];
  }, messages);

  return typeof value === 'string' ? value : null;
}

function interpolate(message: string, values: PluginTranslateOptions['values']): string {
  if (!values) {
    return message;
  }

  return message.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined || value === null ? match : String(value);
  });
}

export function createPluginTranslator(i18n: PluginI18nRuntime): PluginTranslate {
  return (key, options = {}) => {
    const message = readMessage(i18n.messages, key) ?? options.fallback ?? key;
    return interpolate(message, options.values);
  };
}
