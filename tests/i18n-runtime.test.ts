import assert from 'node:assert/strict';
import test from 'node:test';
import { readHostMessageValue } from '../apps/host-next/lib/host-i18n';
import {
  formatBytes,
  formatCurrencyMinor,
  formatRelativeTime,
} from '../apps/host-next/lib/i18n-format';

test('host formatter localizes bytes, currency, and relative time', () => {
  assert.equal(formatBytes(1536, 'en'), '1.5 KB');
  assert.equal(formatBytes(1536, 'zh'), '1.5 KB');
  assert.equal(formatCurrencyMinor(1299, 'usd', 'en'), '$12.99');
  assert.match(formatCurrencyMinor(1299, 'usd', 'zh'), /12\.99/);
  assert.equal(
    formatRelativeTime('2026-05-24T04:00:00.000Z', 'en', {
      now: Date.parse('2026-05-24T07:00:00.000Z'),
    }),
    '3h ago'
  );
  assert.equal(
    formatRelativeTime('2026-05-24T04:00:00.000Z', 'zh', {
      now: Date.parse('2026-05-24T07:00:00.000Z'),
    }),
    '3 小时前'
  );
});

test('host locale lookup keeps structured array copy available', () => {
  const zhStats = readHostMessageValue<unknown[]>('zh', 'site.home.stats');
  const enStats = readHostMessageValue<unknown[]>('en', 'site.home.stats');

  assert.equal(Array.isArray(zhStats), true);
  assert.equal(Array.isArray(enStats), true);
  assert.equal(zhStats.length, enStats.length);
});
