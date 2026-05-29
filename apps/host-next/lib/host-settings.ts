import { DEFAULT_LANGUAGE, type SupportedLanguage } from './i18n';
import type {
  RuntimeStore,
  RuntimeStoreSettingRecord,
} from '@/lib/module-runtime/stores/runtime-store-types';
import { DEFAULT_HOST_PRODUCT_ID } from './default-scope';

export const HOST_SETTINGS_NAMESPACE = 'host';
export const HOST_SETTINGS_KEY = 'runtime';

export interface HostRuntimeSettings {
  siteName: string;
  supportEmail: string;
  defaultLocale: SupportedLanguage;
  timezone: string;
  requireEmailVerification: boolean;
  sessionMaxAgeDays: number;
  passwordMinLength: number;
  emailProvider: string;
  fromEmail: string;
  fromName: string;
  digestFrequency: 'immediate' | 'daily' | 'weekly' | 'off';
}

export type HostSettingKey = keyof HostRuntimeSettings;
export type HostSettingValueSource = 'env' | 'store' | 'default';
export type HostSettingsSource = HostSettingValueSource | 'mixed';
export type HostSettingRisk = 'low' | 'medium' | 'high';
export type HostSettingScope = 'product' | 'system';

export interface HostSettingsView extends HostRuntimeSettings {
  source: HostSettingsSource;
  fieldSources: Record<HostSettingKey, HostSettingValueSource>;
  fields: HostResolvedSettingsField[];
  version?: number;
  updatedAt?: string;
}

export interface HostSettingsFieldSchema {
  key: HostSettingKey;
  type: 'string' | 'boolean' | 'number' | 'enum';
  defaultValue: string | boolean | number;
  overridable: boolean;
  editable: boolean;
  requiresRestart: boolean;
  secret: boolean;
  secretRef: boolean;
  risk: HostSettingRisk;
  scope: HostSettingScope;
  envKeys: string[];
  description: string;
  allowedValues?: string[];
  min?: number;
  max?: number;
}

export interface HostResolvedSettingsField {
  key: HostSettingKey;
  value: string | boolean | number;
  defaultValue: string | boolean | number;
  source: HostSettingValueSource;
  editable: boolean;
  requiresRestart: boolean;
  secret: boolean;
  secretRef: boolean;
  risk: HostSettingRisk;
  scope: HostSettingScope;
  envKeys: string[];
  description: string;
}

export const HOST_SETTINGS_SCHEMA: readonly HostSettingsFieldSchema[] = [
  {
    key: 'siteName',
    type: 'string',
    defaultValue: 'PloyKit',
    overridable: true,
    editable: true,
    requiresRestart: false,
    secret: false,
    secretRef: false,
    risk: 'low',
    scope: 'product',
    envKeys: ['PLOYKIT_SITE_NAME'],
    description: 'Public product name shown in shell and notifications.',
  },
  {
    key: 'supportEmail',
    type: 'string',
    defaultValue: 'support@ploykit.local',
    overridable: true,
    editable: true,
    requiresRestart: false,
    secret: false,
    secretRef: false,
    risk: 'low',
    scope: 'product',
    envKeys: ['PLOYKIT_SUPPORT_EMAIL', 'PLOYKIT_CONTACT_TO'],
    description: 'Public support contact address.',
  },
  {
    key: 'defaultLocale',
    type: 'enum',
    defaultValue: DEFAULT_LANGUAGE,
    overridable: true,
    editable: true,
    requiresRestart: false,
    secret: false,
    secretRef: false,
    risk: 'low',
    scope: 'product',
    envKeys: ['PLOYKIT_DEFAULT_LOCALE'],
    allowedValues: ['zh', 'en'],
    description: 'Default language used when no route locale is selected.',
  },
  {
    key: 'timezone',
    type: 'string',
    defaultValue: 'Asia/Hong_Kong',
    overridable: true,
    editable: true,
    requiresRestart: false,
    secret: false,
    secretRef: false,
    risk: 'low',
    scope: 'product',
    envKeys: ['PLOYKIT_TIMEZONE'],
    description: 'Default timezone for admin display and scheduled summaries.',
  },
  {
    key: 'requireEmailVerification',
    type: 'boolean',
    defaultValue: true,
    overridable: true,
    editable: true,
    requiresRestart: false,
    secret: false,
    secretRef: false,
    risk: 'medium',
    scope: 'system',
    envKeys: ['PLOYKIT_REQUIRE_EMAIL_VERIFICATION'],
    description: 'Controls whether host signups must verify email before activation.',
  },
  {
    key: 'sessionMaxAgeDays',
    type: 'number',
    defaultValue: 7,
    overridable: true,
    editable: true,
    requiresRestart: false,
    secret: false,
    secretRef: false,
    risk: 'medium',
    scope: 'system',
    envKeys: ['PLOYKIT_SESSION_MAX_AGE_DAYS'],
    min: 1,
    max: 365,
    description: 'Signed host session lifetime in days.',
  },
  {
    key: 'passwordMinLength',
    type: 'number',
    defaultValue: 8,
    overridable: true,
    editable: true,
    requiresRestart: false,
    secret: false,
    secretRef: false,
    risk: 'medium',
    scope: 'system',
    envKeys: ['PLOYKIT_PASSWORD_MIN_LENGTH'],
    min: 8,
    max: 128,
    description: 'Minimum password length for local host auth.',
  },
  {
    key: 'emailProvider',
    type: 'enum',
    defaultValue: 'log',
    overridable: true,
    editable: true,
    requiresRestart: false,
    secret: false,
    secretRef: false,
    risk: 'medium',
    scope: 'system',
    envKeys: ['PLOYKIT_EMAIL_PROVIDER'],
    allowedValues: ['disabled', 'log', 'webhook'],
    description: 'Email delivery provider. Webhook credentials stay in env/secret storage.',
  },
  {
    key: 'fromEmail',
    type: 'string',
    defaultValue: 'no-reply@ploykit.local',
    overridable: true,
    editable: true,
    requiresRestart: false,
    secret: false,
    secretRef: false,
    risk: 'low',
    scope: 'product',
    envKeys: ['PLOYKIT_EMAIL_FROM'],
    description: 'Email sender address resolved from PLOYKIT_EMAIL_FROM or runtime settings.',
  },
  {
    key: 'fromName',
    type: 'string',
    defaultValue: 'PloyKit',
    overridable: true,
    editable: true,
    requiresRestart: false,
    secret: false,
    secretRef: false,
    risk: 'low',
    scope: 'product',
    envKeys: ['PLOYKIT_EMAIL_FROM'],
    description: 'Email sender display name resolved from PLOYKIT_EMAIL_FROM or runtime settings.',
  },
  {
    key: 'digestFrequency',
    type: 'enum',
    defaultValue: 'immediate',
    overridable: true,
    editable: true,
    requiresRestart: false,
    secret: false,
    secretRef: false,
    risk: 'low',
    scope: 'product',
    envKeys: ['PLOYKIT_NOTIFICATION_DIGEST'],
    allowedValues: ['immediate', 'daily', 'weekly', 'off'],
    description: 'Default notification digest frequency.',
  },
];

const HOST_SETTINGS_SCHEMA_BY_KEY = new Map(
  HOST_SETTINGS_SCHEMA.map((field) => [field.key, field])
);

const HOST_SETTING_KEYS = HOST_SETTINGS_SCHEMA.map((field) => field.key);

function envBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === '1' || value === 'yes';
  return fallback;
}

function envNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), min), max) : fallback;
}

function parseFromName(value: string): { fromName: string; fromEmail: string } {
  const trimmed = value.trim();
  const match = /^(.*)<(.+)>$/.exec(trimmed);
  return {
    fromName: match?.[1]?.trim() || 'PloyKit',
    fromEmail: match?.[2]?.trim() ?? trimmed,
  };
}

function envHasValue(env: NodeJS.ProcessEnv, keys: readonly string[]): boolean {
  return keys.some((key) => typeof env[key] === 'string' && env[key]!.trim().length > 0);
}

function sourceSummary(sources: Record<HostSettingKey, HostSettingValueSource>): HostSettingsSource {
  const unique = new Set(Object.values(sources));
  return unique.size === 1 ? (unique.values().next().value as HostSettingValueSource) : 'mixed';
}

function buildResolvedFields(
  settings: HostRuntimeSettings,
  sources: Record<HostSettingKey, HostSettingValueSource>
): HostResolvedSettingsField[] {
  return HOST_SETTINGS_SCHEMA.map((schema) => ({
    key: schema.key,
    value: settings[schema.key] as string | boolean | number,
    defaultValue: schema.defaultValue,
    source: sources[schema.key],
    editable: schema.editable && sources[schema.key] !== 'env',
    requiresRestart: schema.requiresRestart,
    secret: schema.secret,
    secretRef: schema.secretRef,
    risk: schema.risk,
    scope: schema.scope,
    envKeys: schema.envKeys,
    description: schema.description,
  }));
}

function withSettingsMetadata(
  settings: HostRuntimeSettings,
  sources: Record<HostSettingKey, HostSettingValueSource>,
  options: { updatedAt?: string; version?: number } = {}
): HostSettingsView {
  return {
    ...settings,
    source: sourceSummary(sources),
    fieldSources: sources,
    fields: buildResolvedFields(settings, sources),
    ...(options.version === undefined ? {} : { version: options.version }),
    ...(options.updatedAt === undefined ? {} : { updatedAt: options.updatedAt }),
  };
}

export function baseHostSettings(env = process.env): HostSettingsView {
  const from = env.PLOYKIT_EMAIL_FROM ?? 'PloyKit <no-reply@ploykit.local>';
  const parsed = parseFromName(from);
  const settings: HostRuntimeSettings = {
    siteName: env.PLOYKIT_SITE_NAME ?? 'PloyKit',
    supportEmail: env.PLOYKIT_SUPPORT_EMAIL ?? env.PLOYKIT_CONTACT_TO ?? 'support@ploykit.local',
    defaultLocale: (env.PLOYKIT_DEFAULT_LOCALE as SupportedLanguage) ?? DEFAULT_LANGUAGE,
    timezone: env.PLOYKIT_TIMEZONE ?? 'Asia/Hong_Kong',
    requireEmailVerification: envBoolean(env.PLOYKIT_REQUIRE_EMAIL_VERIFICATION, true),
    sessionMaxAgeDays: envNumber(env.PLOYKIT_SESSION_MAX_AGE_DAYS, 7, 1, 365),
    passwordMinLength: envNumber(env.PLOYKIT_PASSWORD_MIN_LENGTH, 8, 8, 128),
    emailProvider: env.PLOYKIT_EMAIL_PROVIDER ?? 'log',
    fromEmail: parsed.fromEmail,
    fromName: parsed.fromName,
    digestFrequency:
      env.PLOYKIT_NOTIFICATION_DIGEST === 'daily' ||
      env.PLOYKIT_NOTIFICATION_DIGEST === 'weekly' ||
      env.PLOYKIT_NOTIFICATION_DIGEST === 'off'
        ? env.PLOYKIT_NOTIFICATION_DIGEST
        : 'immediate',
  };
  const fieldSources = Object.fromEntries(
    HOST_SETTINGS_SCHEMA.map((schema) => [
      schema.key,
      envHasValue(env, schema.envKeys) ? 'env' : 'default',
    ])
  ) as Record<HostSettingKey, HostSettingValueSource>;
  return withSettingsMetadata(settings, fieldSources);
}

function settingsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : envBoolean(value, fallback);
}

function numberValue(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), min), max) : fallback;
}

function canStoreOverride(base: HostSettingsView, key: HostSettingKey): boolean {
  const schema = HOST_SETTINGS_SCHEMA_BY_KEY.get(key);
  return Boolean(schema?.overridable && schema.editable && base.fieldSources[key] !== 'env');
}

function hasOwnSettingValue(record: Record<string, unknown>, key: HostSettingKey): boolean {
  return Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined;
}

export function mergeHostSettings(base: HostSettingsView, patch: Record<string, unknown>): HostSettingsView {
  const next = settingsRecord(patch);
  const digest = stringValue(next.digestFrequency);
  const sources = { ...base.fieldSources };
  const merged: HostRuntimeSettings = {
    siteName:
      canStoreOverride(base, 'siteName')
        ? (stringValue(next.siteName) ?? base.siteName)
        : base.siteName,
    supportEmail:
      canStoreOverride(base, 'supportEmail')
        ? (stringValue(next.supportEmail) ?? base.supportEmail)
        : base.supportEmail,
    defaultLocale:
      canStoreOverride(base, 'defaultLocale')
        ? ((stringValue(next.defaultLocale) as SupportedLanguage) ?? base.defaultLocale)
        : base.defaultLocale,
    timezone:
      canStoreOverride(base, 'timezone')
        ? (stringValue(next.timezone) ?? base.timezone)
        : base.timezone,
    requireEmailVerification:
      canStoreOverride(base, 'requireEmailVerification')
        ? booleanValue(next.requireEmailVerification, base.requireEmailVerification)
        : base.requireEmailVerification,
    sessionMaxAgeDays:
      canStoreOverride(base, 'sessionMaxAgeDays')
        ? numberValue(next.sessionMaxAgeDays, base.sessionMaxAgeDays, 1, 365)
        : base.sessionMaxAgeDays,
    passwordMinLength:
      canStoreOverride(base, 'passwordMinLength')
        ? numberValue(next.passwordMinLength, base.passwordMinLength, 8, 128)
        : base.passwordMinLength,
    emailProvider:
      canStoreOverride(base, 'emailProvider')
        ? (stringValue(next.emailProvider) ?? base.emailProvider)
        : base.emailProvider,
    fromEmail:
      canStoreOverride(base, 'fromEmail')
        ? (stringValue(next.fromEmail) ?? base.fromEmail)
        : base.fromEmail,
    fromName:
      canStoreOverride(base, 'fromName')
        ? (stringValue(next.fromName) ?? base.fromName)
        : base.fromName,
    digestFrequency:
      canStoreOverride(base, 'digestFrequency') &&
      (digest === 'daily' || digest === 'weekly' || digest === 'off' || digest === 'immediate')
        ? digest
        : base.digestFrequency,
  };
  for (const key of HOST_SETTING_KEYS) {
    if (canStoreOverride(base, key) && hasOwnSettingValue(next, key)) {
      sources[key] = 'store';
    }
  }
  return withSettingsMetadata(merged, sources, {
    updatedAt: typeof patch.updatedAt === 'string' ? patch.updatedAt : base.updatedAt,
  });
}

export async function readHostSettingsView(
  store: RuntimeStore,
  productId = DEFAULT_HOST_PRODUCT_ID
): Promise<HostSettingsView> {
  const latest = await store.getSetting<Record<string, unknown>>({
    productId,
    workspaceId: null,
    namespace: HOST_SETTINGS_NAMESPACE,
    key: HOST_SETTINGS_KEY,
  });
  const base = baseHostSettings();
  if (!latest) {
    return base;
  }
  return {
    ...mergeHostSettings(base, latest.value as Record<string, unknown>),
    updatedAt: latest.updatedAt,
    version: latest.version,
  };
}

export async function writeHostSettings(
  store: RuntimeStore,
  input: {
    productId?: string;
    workspaceId?: string | null;
    actorId?: string | null;
    settings: Partial<HostRuntimeSettings>;
  }
): Promise<RuntimeStoreSettingRecord<Record<string, unknown>>> {
  const settings = input.settings;
  const value = Object.fromEntries(
    HOST_SETTING_KEYS
      .map((key) => [key, settings[key]])
      .filter(([, value]) => value !== undefined)
  );
  return store.upsertSetting({
    productId: input.productId ?? DEFAULT_HOST_PRODUCT_ID,
    workspaceId: input.workspaceId ?? null,
    actorId: input.actorId ?? null,
    namespace: HOST_SETTINGS_NAMESPACE,
    key: HOST_SETTINGS_KEY,
    value,
    status: 'active',
    metadata: {
      fields: Object.keys(settings),
    },
  });
}
