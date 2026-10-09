import { describe, it, expect } from 'vitest'
import { browserTzLabel, formatDateTime, formatDateTimeTz } from '../utils'


describe('时区口径标注（B1）', () => {
  it('browserTzLabel 恒有非空标签（shortOffset→short→"本地时区"逐档兜底）', () => {
    const label = browserTzLabel()
    expect(label.length).toBeGreaterThan(0)
    
    expect(label).toMatch(/^(GMT|UTC|本地时区)/)
  })

  it('formatDateTimeTz = 本地时间 + " (标签)" 口径后缀', () => {
    const iso = '2026-10-12T01:00:00Z'
    expect(formatDateTimeTz(iso)).toBe(`${formatDateTime(iso)} (${browserTzLabel()})`)
  })

  it('非法时间不抛异常（与 formatDateTime 同一容错口径）', () => {
    expect(typeof formatDateTimeTz('not-a-date')).toBe('string')
  })
})
