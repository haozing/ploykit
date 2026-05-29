import test from 'node:test';
import assert from 'node:assert/strict';
import { adminInlineText } from '../apps/host-next/lib/admin-inline-i18n';

test('admin inline zh fallback does not replace inside English words', () => {
  assert.equal(adminInlineText('zh', 'Growth metrics'), '增长指标');
  assert.equal(adminInlineText('zh', 'Growth'), '增长');
  assert.equal(adminInlineText('zh', 'Product profile'), '产品主题档案');
  assert.equal(adminInlineText('zh', 'Theme component preview'), '主题组件预览');
  assert.equal(adminInlineText('zh', 'Operational diagnostics section'), '运行诊断区');
  assert.equal(adminInlineText('zh', 'Payment and tax profiles'), '支付与税务档案');
});

test('admin inline zh translates role and status labels without admin ambiguity', () => {
  assert.equal(adminInlineText('zh', 'Admin'), '管理员');
  assert.equal(adminInlineText('zh', 'admin'), '管理员');
  assert.equal(adminInlineText('zh', 'Pending verification'), '待验证');
  assert.equal(adminInlineText('zh', 'Suspended'), '已暂停');
  assert.equal(adminInlineText('zh', 'yes'), '是');
});

