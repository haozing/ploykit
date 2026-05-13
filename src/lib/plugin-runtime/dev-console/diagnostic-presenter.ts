import type { PluginDiagnostic } from '@/plugin-sdk/diagnostics';

export type PluginDiagnosticDisplayValue = string | readonly string[];

export interface PluginDiagnosticDisplayField {
  label: string;
  value: PluginDiagnosticDisplayValue;
}

export interface PluginDiagnosticDisplay {
  title: string;
  explanation?: string;
  fields: PluginDiagnosticDisplayField[];
}

const DETAIL_LABELS: Record<string, string> = {
  accessPath: 'Access path',
  area: 'Area',
  assumedPermissions: 'Assumed permissions',
  capability: 'Capability',
  column: 'Column',
  declaredOrigins: 'Declared origins',
  firstDeclaration: 'First declaration',
  firstPath: 'Conflicting path',
  line: 'Line',
  method: 'Method',
  path: 'Path',
  reason: 'Reason',
  samplePath: 'Sample path',
  specifier: 'Specifier',
  url: 'URL',
  usedIn: 'Used in',
};

const DIAGNOSTIC_DETAIL_KEYS: Record<string, readonly string[]> = {
  PLUGIN_CAPABILITY_DYNAMIC_ACCESS_UNVERIFIED: [
    'accessPath',
    'capability',
    'assumedPermissions',
    'line',
    'column',
  ],
  PLUGIN_EGRESS_DYNAMIC_URL_UNVERIFIED: ['usedIn', 'line', 'column', 'declaredOrigins', 'reason'],
  PLUGIN_EGRESS_ORIGIN_MISSING: ['url', 'usedIn', 'line', 'column', 'declaredOrigins'],
  PLUGIN_EGRESS_REQUIRED_FOR_HTTP: ['usedIn', 'line', 'column', 'reason'],
  PLUGIN_HTTP_URL_INVALID: ['url', 'usedIn', 'line', 'column'],
  PLUGIN_RUNTIME_API_ROUTE_CONFLICT: [
    'method',
    'path',
    'firstPath',
    'firstDeclaration',
    'samplePath',
    'reason',
  ],
  PLUGIN_RUNTIME_PAGE_ROUTE_CONFLICT: [
    'area',
    'path',
    'firstPath',
    'firstDeclaration',
    'samplePath',
    'reason',
  ],
  PLUGIN_RUNTIME_WEBHOOK_ROUTE_CONFLICT: [
    'method',
    'path',
    'firstPath',
    'firstDeclaration',
    'samplePath',
    'reason',
  ],
};

const DIAGNOSTIC_TITLES: Record<string, string> = {
  PLUGIN_CAPABILITY_DYNAMIC_ACCESS_UNVERIFIED: 'Dynamic capability access',
  PLUGIN_EGRESS_DYNAMIC_URL_UNVERIFIED: 'Dynamic egress URL',
  PLUGIN_EGRESS_ORIGIN_MISSING: 'Missing egress origin',
  PLUGIN_EGRESS_REQUIRED_FOR_HTTP: 'Missing egress declaration',
  PLUGIN_HTTP_URL_INVALID: 'Invalid HTTP URL',
  PLUGIN_RUNTIME_API_ROUTE_CONFLICT: 'API route conflict',
  PLUGIN_RUNTIME_PAGE_ROUTE_CONFLICT: 'Page route conflict',
  PLUGIN_RUNTIME_WEBHOOK_ROUTE_CONFLICT: 'Webhook route conflict',
};

const DIAGNOSTIC_EXPLANATIONS: Record<string, string> = {
  PLUGIN_CAPABILITY_DYNAMIC_ACCESS_UNVERIFIED:
    'plugin check cannot prove the exact method behind this dynamic ctx access, so permissions are counted conservatively and the runtime gate remains the final authority.',
  PLUGIN_EGRESS_DYNAMIC_URL_UNVERIFIED:
    'plugin check cannot prove that this computed URL always stays inside the declared egress list; the runtime egress gate will still reject undeclared origins.',
  PLUGIN_RUNTIME_API_ROUTE_CONFLICT:
    'Two API route declarations can match the same request. Keep plugin routes unambiguous so the runtime does not depend on declaration order.',
  PLUGIN_RUNTIME_PAGE_ROUTE_CONFLICT:
    'Two page route declarations can match the same page URL in the same area. Keep plugin routes unambiguous so navigation and rendering stay deterministic.',
  PLUGIN_RUNTIME_WEBHOOK_ROUTE_CONFLICT:
    'Two webhook route declarations can match the same delivery. Keep webhook paths unambiguous so handler dispatch stays deterministic.',
};

function detailLabel(key: string): string {
  if (DETAIL_LABELS[key]) {
    return DETAIL_LABELS[key];
  }

  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function diagnosticCodeTitle(code: string): string {
  return code
    .replace(/^PLUGIN_/, '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stringifyDetail(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

function normalizeDetailValue(value: unknown): PluginDiagnosticDisplayValue | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    const values = value
      .filter((item) => item !== null && item !== undefined)
      .map((item) => stringifyDetail(item));

    return values.length > 0 ? values : null;
  }

  return stringifyDetail(value);
}

function buildFields(
  details: Record<string, unknown>,
  keys: readonly string[]
): PluginDiagnosticDisplayField[] {
  const fields: PluginDiagnosticDisplayField[] = [];

  for (const key of keys) {
    const value = normalizeDetailValue(details[key]);

    if (value) {
      fields.push({
        label: detailLabel(key),
        value,
      });
    }
  }

  return fields;
}

export function getPluginDiagnosticDisplay(diagnostic: PluginDiagnostic): PluginDiagnosticDisplay {
  const details = diagnostic.details ?? {};
  const detailKeys = DIAGNOSTIC_DETAIL_KEYS[diagnostic.code] ?? Object.keys(details);

  return {
    title: DIAGNOSTIC_TITLES[diagnostic.code] ?? diagnosticCodeTitle(diagnostic.code),
    explanation: DIAGNOSTIC_EXPLANATIONS[diagnostic.code],
    fields: buildFields(details, detailKeys),
  };
}
