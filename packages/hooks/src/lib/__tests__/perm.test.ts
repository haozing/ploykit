import { describe, it, expect } from 'vitest'
import { roleSatisfies } from '../perm'



describe('roleSatisfies 九宫格', () => {
  const cases: Array<{ role: string; perm?: 'admin' | 'owner'; expected: boolean }> = [
    
    { role: 'member', expected: true },
    { role: 'member', perm: 'admin', expected: false },
    { role: 'member', perm: 'owner', expected: false },
    
    { role: 'admin', expected: true },
    { role: 'admin', perm: 'admin', expected: true },
    { role: 'admin', perm: 'owner', expected: false },
    
    { role: 'owner', expected: true },
    { role: 'owner', perm: 'admin', expected: true },
    { role: 'owner', perm: 'owner', expected: true },
  ]

  for (const { role, perm, expected } of cases) {
    it(`role=${role} perm=${perm ?? 'undefined'} → ${expected}`, () => {
      expect(roleSatisfies(role, perm)).toBe(expected)
    })
  }
})

describe('roleSatisfies 边界', () => {
  it('role 未加载（undefined）：全员项可见，其余按最小权限隐藏', () => {
    expect(roleSatisfies(undefined, undefined)).toBe(true)
    expect(roleSatisfies(undefined, 'admin')).toBe(false)
    expect(roleSatisfies(undefined, 'owner')).toBe(false)
  })

  it('未知角色字符串不满足任何档位（除 undefined perm）', () => {
    expect(roleSatisfies('guest', undefined)).toBe(true)
    expect(roleSatisfies('guest', 'admin')).toBe(false)
    expect(roleSatisfies('guest', 'owner')).toBe(false)
  })
})
