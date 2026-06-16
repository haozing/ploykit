import type { ModuleRuntimeHost } from '../host';

export type ModuleMessageDictionary = Record<string, unknown>;

export interface ModuleTranslateOptions {
  fallback?: string;
  values?: Record<string, string | number | boolean | null | undefined>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function localeCandidates(language: string): string[] {
  const normalized = language.trim();
  const base = normalized.split('-')[0];
  return [...new Set([normalized, base].filter(Boolean))];
}

function readMessage(messages: ModuleMessageDictionary, key: string): string | null {
  const value = key.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current)) {
      return undefined;
    }
    return current[segment];
  }, messages);
  return typeof value === 'string' ? value : null;
}

function interpolate(message: string, values: ModuleTranslateOptions['values']): string {
  if (!values) {
    return message;
  }
  return message.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined || value === null ? match : String(value);
  });
}

export function loadModuleLocaleMessages(
  host: ModuleRuntimeHost,
  moduleId: string,
  language: string
): ModuleMessageDictionary | null {
  const contract = host.getContract(moduleId);
  const entry = host.getMapEntry(moduleId);
  if (!contract || !entry) {
    return null;
  }

  const matchedLocale = localeCandidates(language).find(
    (candidate) => entry.messages?.[candidate] || contract.resources.locales?.[candidate]
  );
  if (!matchedLocale) {
    return null;
  }

  return entry.messages?.[matchedLocale] ?? null;
}

export function translateModuleMessage(
  host: ModuleRuntimeHost,
  moduleId: string,
  language: string,
  key: string,
  options: ModuleTranslateOptions = {}
): string {
  const messages = loadModuleLocaleMessages(host, moduleId, language);
  const message = messages ? readMessage(messages, key) : null;
  return interpolate(message ?? options.fallback ?? key, options.values);
}
