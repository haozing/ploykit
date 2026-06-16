import { dashboardInlineText } from '@host/lib/dashboard-copy';
import type { SupportedLanguage } from '@host/lib/i18n';

export function formatTaskName(lang: SupportedLanguage, name: string): string {
  if (name === 'public-tools-export' || name === 'public tools export') {
    return dashboardInlineText(lang, 'export_public_tools_data_201afecb');
  }
  return name.includes('-') || name.includes('_')
    ? dashboardInlineText(lang, 'user_task_f874d779')
    : name;
}

export function formatTaskResult(lang: SupportedLanguage, result: unknown): string {
  if (result && typeof result === 'object' && 'exportedRows' in result) {
    const rows = Number((result as { exportedRows?: unknown }).exportedRows ?? 0);
    return dashboardInlineText(lang, 'exported_value_row_value_210f20bf', {
      value1: rows,
      value2: rows === 1 ? '' : 's',
    });
  }
  return dashboardInlineText(lang, 'the_task_is_complete_bed21f2c');
}

export function progressDescription(lang: SupportedLanguage, progress: number): string {
  return dashboardInlineText(lang, 'value_complete_c3f68502', { value1: progress });
}
