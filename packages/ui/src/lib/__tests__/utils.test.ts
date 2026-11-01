import { describe, it, expect, afterEach } from 'vitest'
import { setUiLang } from '../../i18n'
import {
  browserTzLabel,
  formatDateTime,
  formatDateTimeTz,
  statusLabel,
  ROLE_LABEL,
  DIM_LABEL,
  dimLabel,
} from '../utils'


describe('时区口径标注（B1）', () => {
  it('browserTzLabel 恒有非空标签（shortOffset→short→"Local timezone"逐档兜底）', () => {
    const label = browserTzLabel()
    expect(label.length).toBeGreaterThan(0)

    expect(label).toMatch(/^(GMT|UTC|Local timezone)/)
  })

  it('formatDateTimeTz = 本地时间 + " (标签)" 口径后缀', () => {
    const iso = '2026-10-12T01:00:00Z'
    expect(formatDateTimeTz(iso)).toBe(`${formatDateTime(iso)} (${browserTzLabel()})`)
  })

  it('非法时间不抛异常（与 formatDateTime 同一容错口径）', () => {
    expect(typeof formatDateTimeTz('not-a-date')).toBe('string')
  })
})

describe('标签映射 i18n（B 方案：默认 en，zh 随 setUiLang 切换）', () => {
  afterEach(() => setUiLang('en'))

  it('statusLabel 默认 en；未知状态透传原键', () => {
    expect(statusLabel('PAID')).toBe('Paid')
    expect(statusLabel('dead')).toBe('Dead letter / delivery failed')
    expect(statusLabel('unknown-status')).toBe('unknown-status')
  })

  it('ROLE_LABEL / DIM_LABEL 索引访问即取词（getter 惰性翻译）；未知键 undefined', () => {
    expect(ROLE_LABEL.owner).toBe('Owner')
    expect(DIM_LABEL.tasks_monthly).toBe('Tasks (this month)')
    expect(dimLabel('webhooks')).toBe('Webhook subscriptions')
    expect(ROLE_LABEL['nope']).toBeUndefined()
  })

  it('setUiLang("zh") 后映射即时切中文（无需重导模块）', () => {
    setUiLang('zh')
    expect(statusLabel('paid')).toBe('已支付')
    expect(ROLE_LABEL.admin).toBe('管理员')
    expect(dimLabel('seats')).toBe('成员席位')
  })
})
