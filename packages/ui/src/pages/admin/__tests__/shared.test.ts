
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { formatCents } from '../shared';

// 币种感知 formatCents：零小数币与 Go 侧 billing/money/money.go 的
// zeroDecimal 集合对齐（当前仅 JPY）——金额即最小单位，不除 100、无小数点。
describe('formatCents（币种感知）', () => {
  it('两位小数币：默认 CNY 用 ¥ 符号，恒两位小数', () => {
    expect(formatCents(990)).toBe('¥9.90');
    expect(formatCents(0)).toBe('¥0.00');
    expect(formatCents(100000)).toBe('¥1,000.00');
  });

  it('非 CNY 两位小数币：ISO 代码前缀，大小写不敏感', () => {
    expect(formatCents(1999, 'USD')).toBe('USD 19.99');
    expect(formatCents(990, 'eur')).toBe('EUR 9.90');
  });

  it('零小数币（JPY）：不除 100、无小数点', () => {
    expect(formatCents(4500, 'JPY')).toBe('JPY 4,500');
    expect(formatCents(100, 'jpy')).toBe('JPY 100');
    expect(formatCents(0, 'JPY')).toBe('JPY 0');
  });
});
