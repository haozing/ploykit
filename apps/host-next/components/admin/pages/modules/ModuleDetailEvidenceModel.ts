import type { AdminModuleDetailView } from '@host/lib/admin-module-operations';

export type AdminModuleDetailModule = NonNullable<AdminModuleDetailView['module']>;
export type AdminModuleDetailContract = AdminModuleDetailView['contract'];
export type AdminModuleDetailDiagnostics = AdminModuleDetailView['presentedDiagnostics'];

export function joinOrNone(values: readonly string[], fallback = 'none'): string {
  return values.length > 0 ? values.join(', ') : fallback;
}
