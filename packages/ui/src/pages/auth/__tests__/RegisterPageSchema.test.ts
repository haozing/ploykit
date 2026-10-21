import { describe, expect, it } from 'vitest'
import { passwordSchema, registerSchema } from '../RegisterPage'

/**
 * 注册页校验规则的行为锁定。
 *
 * 这一组断言直接的动机是一次依赖迁移：schema 从 `zod` 全量换到 `zod/mini`
 * 后，`.min()/.max()/.email()` 这类链式 API 全部改写成 `.check(z.minLength()…)`。
 * 两种写法在类型上都合法，但**规则漏写不会报错**——页面照样渲染、表单照样
 * 提交，只是少了一条校验。所以这里逐条按"用户看到的文案"钉住行为。
 */
describe('registerSchema（zod/mini 迁移后）', () => {
  const ok = { email: 'user@example.com', password: 'Abcdef12345!' }

  it('合法输入通过', () => {
    expect(registerSchema.safeParse(ok).success).toBe(true)
  })

  it('昵称可省略，空串也接受', () => {
    expect(registerSchema.safeParse({ ...ok }).success).toBe(true)
    expect(registerSchema.safeParse({ ...ok, display_name: '' }).success).toBe(true)
    expect(registerSchema.safeParse({ ...ok, display_name: '小明' }).success).toBe(true)
  })

  it('邮箱：空 → 请输入邮箱；格式错 → 邮箱格式不正确；超长 → 邮箱过长', () => {
    const msg = (email: string) => {
      const r = registerSchema.safeParse({ ...ok, email })
      return r.success ? null : r.error.issues[0]?.message
    }
    expect(msg('')).toBe('请输入邮箱')
    expect(msg('not-an-email')).toBe('邮箱格式不正确')
    expect(msg('a'.repeat(250) + '@x.com')).toBe('邮箱过长')
  })

  it('密码：少于 10 位 / 类别不足 / 超过 128 字节 各自有专属文案', () => {
    const msg = (password: string) => {
      const r = registerSchema.safeParse({ ...ok, password })
      return r.success ? null : r.error.issues[0]?.message
    }
    expect(msg('Ab1!')).toBe('密码至少 10 位')
    expect(msg('abcdefghij')).toBe('需包含大写/小写/数字/符号中的至少三类')
    // 44 个汉字 = 132 字节 > 128，但长度只有 44 字符（长度规则不会拦）
    expect(msg('密码'.repeat(22) + 'Ab1!')).toContain('密码过长')
  })

  it('passwordSchema 独立使用时规则一致（被账号安全页复用）', () => {
    expect(passwordSchema.safeParse('Abcdef12345!').success).toBe(true)
    expect(passwordSchema.safeParse('short1!A').success).toBe(false)
  })
})
