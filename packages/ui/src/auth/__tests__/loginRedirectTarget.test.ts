import { describe, expect, it } from 'vitest'
import { loginRedirectTarget } from '../useSignInFlow'

/**
 * 开放重定向守卫。
 *
 * 这条规则在本次重构里从 SignInForm.tsx 搬到了 useSignInFlow.ts（逻辑与 UI
 * 分离），所以行为必须逐项锁住。重点不是 `//host`（老朋友，谁都记得），而是
 * **同样会被 URL 解析器当成分隔符的写法**：
 *
 *   new URL('/\\evil.com', 'https://good.example/')  →  https://evil.com/
 *   new URL('/\t/evil.com', 'https://good.example/') →  https://evil.com/
 *
 * 两者都不以 `//` 开头，朴素前缀守卫会放行，然后在 window.location 赋值时
 * 变成跨站跳转。
 */
describe('loginRedirectTarget（开放重定向守卫）', () => {
  it('站内绝对路径原样放行（含查询串与 hash）', () => {
    expect(loginRedirectTarget('/app')).toBe('/app')
    expect(loginRedirectTarget('/admin/settings')).toBe('/admin/settings')
    expect(loginRedirectTarget('/app?tab=2#top')).toBe('/app?tab=2#top')
  })

  it('非字符串 / 空串 / 相对路径落到兜底', () => {
    expect(loginRedirectTarget(undefined)).toBe('/app')
    expect(loginRedirectTarget(null)).toBe('/app')
    expect(loginRedirectTarget(42)).toBe('/app')
    expect(loginRedirectTarget('')).toBe('/app')
    expect(loginRedirectTarget('app')).toBe('/app')
    expect(loginRedirectTarget('https://evil.com/x')).toBe('/app')
  })

  it('协议相对地址被拒（//host）', () => {
    expect(loginRedirectTarget('//evil.com')).toBe('/app')
    expect(loginRedirectTarget('///evil.com')).toBe('/app')
  })

  it('反斜杠绕过被拒：浏览器把 \\ 当作 /，/\\evil.com 等价于 //evil.com', () => {
    expect(loginRedirectTarget('/\\evil.com')).toBe('/app')
    expect(loginRedirectTarget('/a\\b')).toBe('/app')
    expect(loginRedirectTarget('\\\\evil.com')).toBe('/app')
  })

  it('控制字符绕过被拒：解析器剥离 TAB/LF/CR 后变成 //host', () => {
    expect(loginRedirectTarget('/\t/evil.com')).toBe('/app')
    expect(loginRedirectTarget('/\n/evil.com')).toBe('/app')
    expect(loginRedirectTarget('/\r/evil.com')).toBe('/app')
    expect(loginRedirectTarget('/\u0000/evil.com')).toBe('/app')
  })

  it('兜底目标可按调用方覆盖（管理端门传 /admin）', () => {
    expect(loginRedirectTarget('//evil.com', '/admin')).toBe('/admin')
    expect(loginRedirectTarget('/app', '/admin')).toBe('/app')
  })
})
