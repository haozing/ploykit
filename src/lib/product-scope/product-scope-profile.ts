import type { RuntimeProduct } from '@/lib/plugin-runtime/catalog/runtime-catalog-types';
import {
  PRODUCT_SCOPE_MODES,
  type ProductScopeMode,
  type ProductScopeProfile,
} from './product-scope-types';

const PRODUCT_SCOPE_MODE_SET = new Set<string>(PRODUCT_SCOPE_MODES);

export const DEFAULT_PRODUCT_SCOPE_PROFILE = {
  mode: 'hidden-default',
  label: 'Workspace',
  pluralLabel: 'Workspaces',
  allowCreate: false,
  allowSwitch: false,
  allowMembers: false,
  defaultNameTemplate: '{userName} Workspace',
} satisfies ProductScopeProfile;

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
  fallback: string
): string {
  return readOptionalString(record, key) ?? fallback;
}

function readBoolean(
  record: Record<string, unknown>,
  key: string,
  fallback: boolean
): boolean {
  const value = record[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readMode(value: unknown, source: string): ProductScopeMode {
  if (typeof value === 'string' && PRODUCT_SCOPE_MODE_SET.has(value)) {
    return value as ProductScopeMode;
  }

  throw new Error(
    `${source}.mode must be one of: ${PRODUCT_SCOPE_MODES.map((mode) => `"${mode}"`).join(', ')}.`
  );
}

export function normalizeProductScopeProfile(
  value: unknown,
  source = 'scopeProfile'
): ProductScopeProfile | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source} must be an object when provided.`);
  }

  const record = value as Record<string, unknown>;
  const mode = readMode(record.mode, source);
  const fallbackLabel =
    mode === 'domain-alias' ? 'Scope' : mode === 'explicit-workspace' ? 'Workspace' : 'Workspace';

  return {
    mode,
    label: readRequiredString(record, 'label', fallbackLabel),
    pluralLabel: readRequiredString(record, 'pluralLabel', `${fallbackLabel}s`),
    icon: readOptionalString(record, 'icon'),
    routePrefix: readOptionalString(record, 'routePrefix'),
    allowCreate: readBoolean(record, 'allowCreate', mode !== 'hidden-default'),
    allowSwitch: readBoolean(record, 'allowSwitch', mode !== 'hidden-default'),
    allowMembers: readBoolean(record, 'allowMembers', mode !== 'hidden-default'),
    defaultNameTemplate: readOptionalString(record, 'defaultNameTemplate'),
  };
}

export function resolveProductScopeProfile(
  product: Pick<RuntimeProduct, 'id' | 'name' | 'scopeProfile'> | null | undefined
): ProductScopeProfile {
  return {
    ...DEFAULT_PRODUCT_SCOPE_PROFILE,
    defaultNameTemplate: product?.name
      ? `{userName} ${product.name}`
      : DEFAULT_PRODUCT_SCOPE_PROFILE.defaultNameTemplate,
    ...(product?.scopeProfile ?? {}),
  };
}

export function formatDefaultScopeName(input: {
  template?: string;
  userName?: string | null;
  userEmail?: string | null;
  productName: string;
  label: string;
}): string {
  const userName = input.userName?.trim() || input.userEmail?.split('@')[0]?.trim() || 'Default';
  const template = input.template?.trim() || `{userName} ${input.label}`;

  return template
    .replaceAll('{userName}', userName)
    .replaceAll('{userEmail}', input.userEmail?.trim() || userName)
    .replaceAll('{productName}', input.productName)
    .replaceAll('{label}', input.label)
    .trim();
}

