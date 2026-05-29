import { PRESENTATION_THEME_ALLOWED_TOKENS } from '@ploykit/module-sdk/presentation';

export type ModuleThemeTokenValue = string | number;

export const HOST_THEME_ALLOWED_TOKENS = PRESENTATION_THEME_ALLOWED_TOKENS;

export type HostThemeAllowedToken = (typeof HOST_THEME_ALLOWED_TOKENS)[number];

export interface ModuleThemeRuntimeOptions {
  allowedTokens?: readonly string[];
  sourceModuleId?: string;
  scope?: 'site' | 'dashboard' | 'module-page' | 'admin';
}

export interface ModuleThemeTokenResult {
  tokens: Record<string, ModuleThemeTokenValue>;
  rejected: Record<string, ModuleThemeTokenValue>;
  acceptedTokens: Record<string, ModuleThemeTokenValue>;
  rejectedTokens: Record<string, ModuleThemeTokenValue>;
  sourceModuleId?: string;
  scope: 'site' | 'dashboard' | 'module-page' | 'admin';
}

export function resolveModuleThemeTokens(
  requestedTokens: Record<string, ModuleThemeTokenValue>,
  options: ModuleThemeRuntimeOptions = {}
): ModuleThemeTokenResult {
  const allowed = new Set(options.allowedTokens ?? HOST_THEME_ALLOWED_TOKENS);
  const tokens: Record<string, ModuleThemeTokenValue> = {};
  const rejected: Record<string, ModuleThemeTokenValue> = {};

  for (const [key, value] of Object.entries(requestedTokens)) {
    if (allowed.size > 0 && !allowed.has(key)) {
      rejected[key] = value;
      continue;
    }
    tokens[key] = value;
  }

  return {
    tokens,
    rejected,
    acceptedTokens: tokens,
    rejectedTokens: rejected,
    sourceModuleId: options.sourceModuleId,
    scope: options.scope ?? 'module-page',
  };
}
