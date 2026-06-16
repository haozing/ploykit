import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import { assertAdminSession } from './admin-session';
import { getHostRuntime, invalidateHostRuntime } from './create-host';
import { DEFAULT_HOST_PRODUCT_ID } from './default-scope';
import {
  HOST_SETTINGS_SCHEMA,
  readHostSettingsView,
  writeHostSettings,
  type HostRuntimeSettings,
  type HostSettingKey,
  type HostSettingRisk,
  type HostSettingValueSource,
} from './host-settings';
import { isSupportedLanguage } from './i18n';

const DEMO_PRODUCT_ID = DEFAULT_HOST_PRODUCT_ID;

export type AdminHostSettingSource = 'env' | 'admin-override' | 'default';
export type AdminHostSettingsSource = AdminHostSettingSource | 'mixed';

export interface AdminHostSettingsFieldView {
  key: HostSettingKey;
  value: string | boolean | number;
  defaultValue: string | boolean | number;
  source: AdminHostSettingSource;
  editable: boolean;
  requiresRestart: boolean;
  secret: boolean;
  secretRef: boolean;
  risk: HostSettingRisk;
  scope: 'product' | 'system';
  envKeys: string[];
  description: string;
}

export interface AdminHostSettingsView extends HostRuntimeSettings {
  source: AdminHostSettingsSource;
  fieldSources: Record<HostSettingKey, AdminHostSettingSource>;
  fields: AdminHostSettingsFieldView[];
  version?: number;
  updatedAt?: string;
}

export type AdminHostSettingsUpdateInput = Partial<HostRuntimeSettings> & {
  reason?: string;
};

function booleanSetting(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value === 'true' || value === '1' || value === 'yes';
  }
  return fallback;
}

function numberSetting(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), min), max) : fallback;
}

function adminSettingSource(source: HostSettingValueSource): AdminHostSettingSource {
  return source === 'store' ? 'admin-override' : source;
}

function adminSettingsSource(source: HostSettingValueSource | 'mixed'): AdminHostSettingsSource {
  return source === 'store' ? 'admin-override' : source;
}

function settingsUpdateValues(input: Partial<HostRuntimeSettings>): Partial<HostRuntimeSettings> {
  return Object.fromEntries(
    HOST_SETTINGS_SCHEMA.map((schema) => {
      const value = input[schema.key];
      return [schema.key, typeof value === 'string' ? value.trim() : value];
    }).filter(([, value]) => value !== undefined)
  ) as Partial<HostRuntimeSettings>;
}

const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function rejectInvalidSetting(key: HostSettingKey): never {
  throw new Error(`ADMIN_SETTINGS_INVALID:${key}`);
}

function assertStringSetting(
  key: HostSettingKey,
  value: unknown,
  options: { maxLength: number; email?: boolean; timezone?: boolean }
): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > options.maxLength) {
    rejectInvalidSetting(key);
  }
  if (options.email && (!EMAIL_ADDRESS_PATTERN.test(value) || value.length > 254)) {
    rejectInvalidSetting(key);
  }
  if (options.timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    } catch {
      rejectInvalidSetting(key);
    }
  }
}

function assertNumberSetting(key: HostSettingKey, value: unknown, min: number, max: number): void {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Math.floor(value) !== value ||
    value < min ||
    value > max
  ) {
    rejectInvalidSetting(key);
  }
}

function assertBooleanSetting(key: HostSettingKey, value: unknown): void {
  if (typeof value !== 'boolean') {
    rejectInvalidSetting(key);
  }
}

function assertEnumSetting(
  key: HostSettingKey,
  value: unknown,
  allowedValues: readonly string[]
): void {
  if (typeof value !== 'string' || !allowedValues.includes(value)) {
    rejectInvalidSetting(key);
  }
}

function assertAdminHostSettingsUpdate(input: Partial<HostRuntimeSettings>): void {
  if (input.siteName !== undefined) {
    assertStringSetting('siteName', input.siteName, { maxLength: 120 });
  }
  if (input.supportEmail !== undefined) {
    assertStringSetting('supportEmail', input.supportEmail, { maxLength: 254, email: true });
  }
  if (input.defaultLocale !== undefined) {
    if (typeof input.defaultLocale !== 'string' || !isSupportedLanguage(input.defaultLocale)) {
      rejectInvalidSetting('defaultLocale');
    }
  }
  if (input.timezone !== undefined) {
    assertStringSetting('timezone', input.timezone, { maxLength: 64, timezone: true });
  }
  if (input.requireEmailVerification !== undefined) {
    assertBooleanSetting('requireEmailVerification', input.requireEmailVerification);
  }
  if (input.sessionMaxAgeDays !== undefined) {
    assertNumberSetting('sessionMaxAgeDays', input.sessionMaxAgeDays, 1, 365);
  }
  if (input.passwordMinLength !== undefined) {
    assertNumberSetting('passwordMinLength', input.passwordMinLength, 8, 128);
  }
  if (input.emailProvider !== undefined) {
    assertEnumSetting('emailProvider', input.emailProvider, ['disabled', 'log', 'webhook']);
  }
  if (input.fromEmail !== undefined) {
    assertStringSetting('fromEmail', input.fromEmail, { maxLength: 254, email: true });
  }
  if (input.fromName !== undefined) {
    assertStringSetting('fromName', input.fromName, { maxLength: 80 });
  }
  if (input.digestFrequency !== undefined) {
    assertEnumSetting('digestFrequency', input.digestFrequency, [
      'immediate',
      'daily',
      'weekly',
      'off',
    ]);
  }
}

function settingValueForAudit(value: unknown): unknown {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : null;
}

function settingsChangeSummary(current: AdminHostSettingsView, next: HostRuntimeSettings) {
  return HOST_SETTINGS_SCHEMA.map((schema) => {
    const previousValue = current[schema.key];
    const nextValue = next[schema.key];
    if (previousValue === nextValue) {
      return null;
    }
    return {
      key: schema.key,
      previous: settingValueForAudit(previousValue),
      next: settingValueForAudit(nextValue),
      sourceBefore: current.fieldSources[schema.key],
      sourceAfter: current.fieldSources[schema.key] === 'env' ? 'env' : 'admin-override',
      risk: schema.risk,
      requiresRestart: schema.requiresRestart,
      scope: schema.scope,
    };
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function highestSettingsRisk(changes: readonly { risk: HostSettingRisk }[]): HostSettingRisk {
  if (changes.some((change) => change.risk === 'high')) {
    return 'high';
  }
  if (changes.some((change) => change.risk === 'medium')) {
    return 'medium';
  }
  return 'low';
}

export async function getAdminHostSettingsView(): Promise<AdminHostSettingsView> {
  const hostRuntime = await getHostRuntime();
  const settings = await readHostSettingsView(hostRuntime.runtimeStore.store, DEMO_PRODUCT_ID);
  const fieldSources = Object.fromEntries(
    Object.entries(settings.fieldSources).map(([key, source]) => [key, adminSettingSource(source)])
  ) as Record<HostSettingKey, AdminHostSettingSource>;
  const fields: AdminHostSettingsFieldView[] = settings.fields.map((field) => ({
    ...field,
    defaultValue: field.defaultValue,
    source: adminSettingSource(field.source),
  }));
  return {
    siteName: settings.siteName,
    supportEmail: settings.supportEmail,
    defaultLocale: settings.defaultLocale,
    timezone: settings.timezone,
    requireEmailVerification: settings.requireEmailVerification,
    sessionMaxAgeDays: settings.sessionMaxAgeDays,
    passwordMinLength: settings.passwordMinLength,
    emailProvider: settings.emailProvider,
    fromEmail: settings.fromEmail,
    fromName: settings.fromName,
    digestFrequency: settings.digestFrequency,
    source: adminSettingsSource(settings.source),
    fieldSources,
    fields,
    version: settings.version,
    updatedAt: settings.updatedAt,
  };
}

export async function updateAdminHostSettings(
  session: ModuleHostSession,
  input: AdminHostSettingsUpdateInput
) {
  assertAdminSession(session);
  const current = await getAdminHostSettingsView();
  const { reason, ...rawSettingsInput } = input;
  const settingsInput = settingsUpdateValues(rawSettingsInput);
  const writableSettingsInput = Object.fromEntries(
    Object.entries(settingsInput).filter(
      ([key]) => current.fieldSources[key as HostSettingKey] !== 'env'
    )
  ) as Partial<HostRuntimeSettings>;
  assertAdminHostSettingsUpdate(writableSettingsInput);
  const next: AdminHostSettingsView = {
    ...current,
    ...writableSettingsInput,
    requireEmailVerification: booleanSetting(
      writableSettingsInput.requireEmailVerification,
      current.requireEmailVerification
    ),
    sessionMaxAgeDays: numberSetting(
      writableSettingsInput.sessionMaxAgeDays,
      current.sessionMaxAgeDays,
      1,
      365
    ),
    passwordMinLength: numberSetting(
      writableSettingsInput.passwordMinLength,
      current.passwordMinLength,
      8,
      128
    ),
    digestFrequency: writableSettingsInput.digestFrequency ?? current.digestFrequency,
    source: 'admin-override',
    updatedAt: new Date().toISOString(),
  };
  const diff = settingsChangeSummary(current, next);
  const hostRuntime = await getHostRuntime();
  const saved = await writeHostSettings(hostRuntime.runtimeStore.store, {
    productId: DEMO_PRODUCT_ID,
    workspaceId: null,
    actorId: session.actorId ?? session.user?.id,
    settings: next,
  });
  const savedView = await getAdminHostSettingsView();
  await hostRuntime.runtimeStore.store.recordAudit({
    productId: DEMO_PRODUCT_ID,
    workspaceId: session.workspaceId ?? null,
    actorId: session.actorId ?? session.user?.id,
    type: 'admin.settings.updated',
    metadata: {
      fields: diff.map((change) => change.key),
      settingId: saved.id,
      version: saved.version,
      reason,
      risk: highestSettingsRisk(diff),
      requiresRestart: diff.some((change) => change.requiresRestart),
      ignoredEnvFields: Object.keys(settingsInput).filter(
        (key) => current.fieldSources[key as HostSettingKey] === 'env'
      ),
      diff,
    },
  });
  invalidateHostRuntime();
  return savedView;
}
