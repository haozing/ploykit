
import { ApiError } from '../../hooks/useApi';
import { apiErrorMessage } from '../../lib/api-error';


export const ADMIN_PAGE_SIZE = 20;


export function adminError(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status === 403) {
    return '需要平台管理员权限（当前账号无权访问管理控制台）';
  }
  return apiErrorMessage(err, fallback);
}


export interface AdminListEnvelope<T> {
  items: T[];
  total: number;
}


export function adminListQuery(
  page: number,
  pageSize: number = ADMIN_PAGE_SIZE,
  filters: Record<string, string | undefined> = {},
): string {
  const p = new URLSearchParams();
  p.set('page', String(page));
  p.set('page_size', String(pageSize));
  for (const [k, v] of Object.entries(filters)) {
    if (v && v.trim()) p.set(k, v.trim());
  }
  return `?${p.toString()}`;
}


export function formatCents(cents: number, currency = 'CNY'): string {
  const symbol =
    currency.toUpperCase() === 'CNY' ? '¥' : `${currency.toUpperCase()} `;
  return `${symbol}${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
