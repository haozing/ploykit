import { PluginError } from '@ploykit/plugin-sdk';

export const PLUGIN_COMMERCIAL_ERROR_CODES = [
  'PLUGIN_LICENSE_REQUIRED',
  'PLUGIN_PLAN_REQUIRED',
  'PLUGIN_PURCHASE_REQUIRED',
] as const;

export type PluginCommercialErrorCode = (typeof PLUGIN_COMMERCIAL_ERROR_CODES)[number];

const COMMERCIAL_ERROR_CODE_SET: ReadonlySet<string> = new Set(PLUGIN_COMMERCIAL_ERROR_CODES);

export function isPluginCommercialError(error: unknown): error is PluginError {
  return error instanceof PluginError && COMMERCIAL_ERROR_CODE_SET.has(error.code);
}

export function createPluginCommercialRedirectPath(
  lang: string,
  pluginId: string,
  callbackPath: string,
  error: PluginError
): string {
  const purchaseUrl =
    typeof error.details?.purchaseUrl === 'string' ? error.details.purchaseUrl : undefined;

  if (purchaseUrl?.startsWith('/')) {
    return appendCommercialQuery(purchaseUrl, pluginId, callbackPath, error.code);
  }

  return appendCommercialQuery(`/${lang}/pricing`, pluginId, callbackPath, error.code);
}

function appendCommercialQuery(
  path: string,
  pluginId: string,
  callbackPath: string,
  reason: string
): string {
  const separator = path.includes('?') ? '&' : '?';
  const params = new URLSearchParams({
    pluginId,
    reason,
    callbackUrl: callbackPath,
  });

  return `${path}${separator}${params.toString()}`;
}
