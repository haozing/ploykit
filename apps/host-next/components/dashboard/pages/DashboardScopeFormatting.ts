import { DEFAULT_HOST_PRODUCT_ID, DEFAULT_HOST_WORKSPACE_ID } from '@host/lib/default-scope';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { dashboardInlineText } from '@host/lib/dashboard-copy';
import type { SupportedLanguage } from '@host/lib/i18n';

export function formatProductLabel(
  lang: SupportedLanguage,
  productId: string | null | undefined
): string {
  if (!productId) {
    return adminInlineText(lang, 'Default product');
  }
  return productId === DEFAULT_HOST_PRODUCT_ID
    ? adminInlineText(lang, 'Default product')
    : productId;
}

export function formatWorkspaceLabel(
  lang: SupportedLanguage,
  workspaceId: string | null | undefined
): string {
  if (!workspaceId) {
    return adminInlineText(lang, 'Default workspace');
  }
  return workspaceId === DEFAULT_HOST_WORKSPACE_ID
    ? adminInlineText(lang, 'Default workspace')
    : workspaceId;
}

export function formatWorkspaceDisplayName(
  lang: SupportedLanguage,
  name: string | null | undefined
): string {
  const normalized = String(name ?? '').trim();
  if (!normalized) {
    return adminInlineText(lang, 'Default workspace');
  }
  const localizedNames: Record<string, string> = {
    'Default Workspace': 'workspace_name_default_1f9f0d11',
    'Team Main': 'workspace_name_team_main_93a67cf4',
    'Team Lab': 'workspace_name_team_lab_7d9f2c0a',
  };
  const localizedName = localizedNames[normalized];
  return localizedName ? dashboardInlineText(lang, localizedName) : normalized;
}

export function formatDashboardModuleLabel(lang: SupportedLanguage, moduleId: string): string {
  return moduleId === 'web-shell' ? adminInlineText(lang, 'Workspace') : moduleId;
}
