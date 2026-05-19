export type PlanCapabilityValueType = 'boolean' | 'string' | 'number' | 'enum';
export type PlanCapabilityOwnerType = 'host' | 'product' | 'suite' | 'bundle' | 'plugin';
export type PlanCapabilityValue = boolean | string | number;
export type LocalizedPlanCapabilityText = Record<string, string | undefined>;

export interface PlanCapabilityOption {
  value: string | number;
  label?: LocalizedPlanCapabilityText;
}

export interface PlanCapabilityDefinition {
  key: string;
  valueType: PlanCapabilityValueType;
  ownerType: PlanCapabilityOwnerType;
  ownerId: string;
  required: boolean;
  defaultValue?: PlanCapabilityValue;
  options?: PlanCapabilityOption[];
  label?: LocalizedPlanCapabilityText;
  description?: LocalizedPlanCapabilityText;
  group?: string;
  sortOrder: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

export type PlanCapabilityIssueCode =
  | 'required'
  | 'invalidBoolean'
  | 'invalidNumber'
  | 'invalidString'
  | 'invalidOption'
  | 'missingOptions';

export interface PlanCapabilityValidationIssue {
  key: string;
  code: PlanCapabilityIssueCode;
  value?: unknown;
}

export interface PlanCapabilityValueSetResult {
  success: boolean;
  values: Record<string, PlanCapabilityValue>;
  issues: PlanCapabilityValidationIssue[];
}

export interface NormalizePlanCapabilityContext {
  ownerType: PlanCapabilityOwnerType;
  ownerId: string;
  source?: string;
}

const ENTITLEMENT_KEY_MAX_LENGTH = 120;
const SCOPED_ENTITLEMENT_KEY_PATTERN =
  /^[a-zA-Z][a-zA-Z0-9_-]{0,63}(?:\.[a-zA-Z][a-zA-Z0-9_-]{0,63})+$/;

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readNumber(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readLocalizedText(value: unknown): LocalizedPlanCapabilityText | undefined {
  if (typeof value === 'string' && value.trim()) {
    return { default: value.trim() };
  }

  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  const entries = Object.entries(record)
    .filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && entry[1].trim().length > 0
    )
    .map(([locale, text]) => [locale.trim(), text.trim()] as const)
    .filter(([locale]) => locale.length > 0);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function readPlanCapabilityValue(value: unknown): PlanCapabilityValue | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  return typeof value === 'boolean' || typeof value === 'string' ? value : undefined;
}

function readPlanCapabilityOptions(value: unknown): PlanCapabilityOption[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const options: PlanCapabilityOption[] = [];
  for (const item of value) {
    const record = readRecord(item);
    if (!record) {
      continue;
    }
    const optionValue = readPlanCapabilityValue(record.value);
    if (typeof optionValue === 'boolean' || optionValue === undefined) {
      continue;
    }
    const label = readLocalizedText(record.label);
    options.push({
      value: optionValue,
      ...(label ? { label } : {}),
    });
  }

  return options.length > 0 ? options : undefined;
}

export function isValidPlanCapabilityKey(key: string): boolean {
  return key.length <= ENTITLEMENT_KEY_MAX_LENGTH && SCOPED_ENTITLEMENT_KEY_PATTERN.test(key);
}

export function normalizePlanCapabilityDefinition(
  value: unknown,
  context: NormalizePlanCapabilityContext
): PlanCapabilityDefinition {
  const record = readRecord(value);
  const key = record ? readString(record, 'key') : undefined;
  const valueType = record ? readString(record, 'valueType') : undefined;
  const sourceLabel = context.source ? ` in ${context.source}` : '';

  if (!record || !key || !valueType) {
    throw new Error(`Plan capability${sourceLabel} must declare key and valueType.`);
  }

  if (!isValidPlanCapabilityKey(key)) {
    throw new Error(
      `Plan capability "${key}"${sourceLabel} must use a scoped key such as "product.feature".`
    );
  }

  if (!isPlanCapabilityValueType(valueType)) {
    throw new Error(
      `Plan capability "${key}"${sourceLabel} has unsupported valueType "${valueType}".`
    );
  }

  const definition: PlanCapabilityDefinition = {
    key,
    valueType,
    ownerType: context.ownerType,
    ownerId: context.ownerId,
    required: readBoolean(record, 'required', false),
    defaultValue: readPlanCapabilityValue(record.defaultValue),
    options: readPlanCapabilityOptions(record.options),
    label: readLocalizedText(record.label),
    description: readLocalizedText(record.description),
    group: readString(record, 'group'),
    sortOrder: readNumber(record, 'sortOrder', 100),
    source: context.source,
    metadata: readRecord(record.metadata),
  };

  if (definition.valueType === 'enum' && !definition.options?.length) {
    throw new Error(`Enum plan capability "${key}"${sourceLabel} must declare options.`);
  }

  if (definition.defaultValue !== undefined) {
    const parsedDefault = parsePlanCapabilityValue(definition, definition.defaultValue);
    if (!parsedDefault.success) {
      throw new Error(`Plan capability "${key}"${sourceLabel} has an invalid defaultValue.`);
    }
    definition.defaultValue = parsedDefault.value;
  }

  return definition;
}

export function normalizePlanCapabilityDefinitions(
  value: unknown,
  context: NormalizePlanCapabilityContext
): PlanCapabilityDefinition[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    const sourceLabel = context.source ? ` in ${context.source}` : '';
    throw new Error(`planCapabilities${sourceLabel} must be an array.`);
  }
  return value.map((item) => normalizePlanCapabilityDefinition(item, context));
}

export function isPlanCapabilityValueType(value: string): value is PlanCapabilityValueType {
  return value === 'boolean' || value === 'string' || value === 'number' || value === 'enum';
}

function isEmptyCapabilityInput(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim());
}

export function parsePlanCapabilityValue(
  definition: PlanCapabilityDefinition,
  value: unknown
):
  | { success: true; value?: PlanCapabilityValue }
  | { success: false; issue: PlanCapabilityValidationIssue } {
  if (isEmptyCapabilityInput(value)) {
    if (definition.required) {
      return { success: false, issue: { key: definition.key, code: 'required', value } };
    }
    return { success: true };
  }

  switch (definition.valueType) {
    case 'boolean':
      if (typeof value === 'boolean') {
        return { success: true, value };
      }
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') {
          return { success: true, value: true };
        }
        if (normalized === 'false') {
          return { success: true, value: false };
        }
      }
      return { success: false, issue: { key: definition.key, code: 'invalidBoolean', value } };

    case 'number': {
      const numberValue =
        typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
      if (Number.isFinite(numberValue)) {
        return { success: true, value: numberValue };
      }
      return { success: false, issue: { key: definition.key, code: 'invalidNumber', value } };
    }

    case 'string':
      if (typeof value === 'string') {
        return { success: true, value: value.trim() };
      }
      return { success: false, issue: { key: definition.key, code: 'invalidString', value } };

    case 'enum': {
      const options = definition.options;
      if (!options?.length) {
        return { success: false, issue: { key: definition.key, code: 'missingOptions', value } };
      }
      const selected = options.find((option) => String(option.value) === String(value));
      if (selected) {
        return { success: true, value: selected.value };
      }
      return { success: false, issue: { key: definition.key, code: 'invalidOption', value } };
    }
  }
}

export function validatePlanCapabilityValueSet(
  definitions: readonly PlanCapabilityDefinition[],
  features: Record<string, unknown>,
  options: { requireAll?: boolean } = {}
): PlanCapabilityValueSetResult {
  const requireAll = options.requireAll ?? true;
  const values: Record<string, PlanCapabilityValue> = {};
  const issues: PlanCapabilityValidationIssue[] = [];

  for (const definition of definitions) {
    const hasValue = Object.prototype.hasOwnProperty.call(features, definition.key);
    if (!requireAll && !hasValue) {
      continue;
    }

    const parsed = parsePlanCapabilityValue(definition, features[definition.key]);
    if (!parsed.success) {
      issues.push(parsed.issue);
      continue;
    }
    if (parsed.value !== undefined) {
      values[definition.key] = parsed.value;
    }
  }

  return {
    success: issues.length === 0,
    values,
    issues,
  };
}

export function getLocalizedPlanCapabilityText(
  text: LocalizedPlanCapabilityText | undefined,
  locale: string
): string | undefined {
  if (!text) {
    return undefined;
  }

  const normalizedLocale = locale.toLowerCase();
  const shortLocale = normalizedLocale.split('-')[0];
  return (
    text[locale] ??
    text[normalizedLocale] ??
    text[shortLocale] ??
    text.default ??
    text.en ??
    Object.values(text).find(
      (value): value is string => typeof value === 'string' && value.length > 0
    )
  );
}

export function formatPlanCapabilityKey(key: string): string {
  return key
    .split('.')
    .map((segment) => segment.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase()))
    .join(' / ');
}

export function getPlanCapabilityLabel(
  definition: PlanCapabilityDefinition,
  locale: string
): string {
  return (
    getLocalizedPlanCapabilityText(definition.label, locale) ??
    formatPlanCapabilityKey(definition.key)
  );
}

export function getPlanCapabilityOptionLabel(option: PlanCapabilityOption, locale: string): string {
  return getLocalizedPlanCapabilityText(option.label, locale) ?? String(option.value);
}
