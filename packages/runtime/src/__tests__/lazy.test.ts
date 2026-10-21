import { describe, expect, it } from 'vitest'
import { lazyPage } from '../lazy'

describe('lazyPage', () => {
  it('displayName 用于稳定推导 pageId（React.lazy 自身没有 name）', () => {
    const C = lazyPage('BlogPost', () => Promise.resolve({ default: () => null }))
    expect(C.displayName).toBe('BlogPost')
  })

  it('preload 返回承诺，且与首次渲染共用同一次 import', async () => {
    let calls = 0
    const C = lazyPage('Pricing', () => {
      calls++
      return Promise.resolve({ default: () => null })
    })

    const p = C.preload!()
    expect(p).toBeInstanceOf(Promise)
    await p
    await C.preload!()
    expect(calls).toBe(1)
  })

  it('加载失败后不记忆失败：下一次调用会重新尝试', async () => {
    let calls = 0
    const C = lazyPage('Flaky', () => {
      calls++
      return calls === 1
        ? Promise.reject(new Error('network'))
        : Promise.resolve({ default: () => null })
    })

    await C.preload!() // 吞掉错误
    expect(calls).toBe(1)
    await expect(C.preload!()).resolves.toBeDefined()
    expect(calls).toBe(2)
  })
})
