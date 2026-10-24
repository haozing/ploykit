
import { ApiError } from '@ploykit/hooks';
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


// 零小数币（ISO 4217 minor unit exponent = 0）：金额本身就是最小单位，不除 100、
// 无小数点。真源在 Go 侧 billing/money/money.go 的 zeroDecimal（按需扩展、不做
// 投机性全集，当前仅 JPY）；此处硬编码同步集合，扩展时两边一起改。
const ZERO_DECIMAL_CURRENCIES = new Set(['JPY']);


export function formatCents(cents: number, currency = 'CNY'): string {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) {
    return `${code} ${cents.toLocaleString('zh-CN')}`;
  }
  const symbol = code === 'CNY' ? '¥' : `${code} `;
  return `${symbol}${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
