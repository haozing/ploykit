import { describe, it, expect, afterEach } from 'vitest'
import { setUiLang } from '../../i18n'
import { passwordSchema } from '../password-schema'

/** 校验消息 i18n（B 方案）：error 传函数（zod error map）→ safeParse 时按
 *  模块级 t() 的当前语言取词。锁定"惰性求值 + en 默认 + zh 随 setUiLang"。 */

const firstMessage = (pw: string): string | undefined => {
  const r = passwordSchema.safeParse(pw)
  if (r.success) return undefined
  return (r.error as { issues: Array<{ message: string }> }).issues[0]?.message
}

describe('passwordSchema 校验消息 i18n', () => {
  afterEach(() => setUiLang('en'))

  it('默认 en：三条规则消息经 t() 取词', () => {
    expect(firstMessage('Ab1!')).toBe('Password must be at least 10 characters')
    expect(firstMessage('abcdefghijklmnop')).toBe('Must include at least three of: uppercase, lowercase, numbers, symbols')
    expect(firstMessage('密码'.repeat(22) + 'Ab1!')).toContain('Password too long')
  })

  it('setUiLang("zh") 后同一 schema 消息即时切中文（无需重建）', () => {
    setUiLang('zh')
    expect(firstMessage('Ab1!')).toBe('密码至少 10 位')
    expect(firstMessage('abcdefghijklmnop')).toBe('需包含大写/小写/数字/符号中的至少三类')
    expect(firstMessage('密码'.repeat(22) + 'Ab1!')).toContain('密码过长')
  })

  it('合法密码不受消息改造影响', () => {
    expect(passwordSchema.safeParse('Abcdef12345!').success).toBe(true)
    expect(passwordSchema.safeParse('short1!A').success).toBe(false)
  })
})
