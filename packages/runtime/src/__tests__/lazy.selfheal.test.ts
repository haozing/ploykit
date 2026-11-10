// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lazyPage } from '../lazy'

// node 环境：window 由 stubGlobal 提供——绕开 jsdom 对 location 的
// [Unforgeable]（不可重定义）限制，完整驱动 reloadForChunkFetchError 的
// 全部分支（首次重载 / 冷却抑制 / 冷却过期再重载 / 非抓取型失败不重载 /
// SSR 无 window 安全）。
//
// 断言经由 preload：preload 把 rejection 吞成 resolve（既有语义），但内层
// catch 的重载副作用先行发生——对副作用断言即可。
describe('lazyPage chunk 抓取失败自愈', () => {
  const RELOAD_AT_KEY = 'ploykit:lazyPage:chunkReloadAt'
  const reload = vi.fn()
  let store: Record<string, string>
  let now: number

  beforeEach(() => {
    vi.useFakeTimers()
    now = 1_700_000_000_000
    vi.setSystemTime(now)
    store = {}
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v
        },
      },
      location: { reload },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    reload.mockClear()
  })

  const chunkFail = () =>
    Promise.reject(
      new Error(
        'TypeError: Failed to fetch dynamically imported module: https://x/assets/EditorPage-abc123.js',
      ),
    )

  it('Chrome 形态的抓取失败触发一次重载，并记录时刻', async () => {
    const C = lazyPage('Editor', chunkFail)
    await C.preload!()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(store[RELOAD_AT_KEY]).toBe(String(now))
  })

  it('Firefox / Safari 形态同样识别', async () => {
    for (const msg of [
      'error loading dynamically imported module: https://x/assets/P-1.js',
      'Importing a module script failed.',
    ]) {
      // 推出冷却窗口：两次失败模拟两次独立的部署窗口
      vi.setSystemTime((now += 11_000))
      const C = lazyPage('P', () => Promise.reject(new Error(msg)))
      await C.preload!()
    }
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('冷却窗口内的再次失败不再重载（防回环）', async () => {
    const C = lazyPage('P', chunkFail)
    await C.preload!()
    expect(reload).toHaveBeenCalledTimes(1)
    // 重载落回同一版本（比如部署还没完成）→ 立即再失败：不重载
    await C.preload!()
    expect(reload).toHaveBeenCalledTimes(1)
    // 冷却过期后的新失败：允许再次自愈（下一次部署的窗口）
    vi.setSystemTime(now + 11_000)
    await C.preload!()
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('模块求值错误（非抓取型）不重载，交给错误边界', async () => {
    const C = lazyPage(
      'Broken',
      () => Promise.reject(new TypeError('Cannot read properties of undefined (reading x)')),
    )
    await C.preload!()
    expect(reload).not.toHaveBeenCalled()
  })

  it('非 Error 拒绝值不重载', async () => {
    const C = lazyPage('P', () => Promise.reject('boom'))
    await C.preload!()
    expect(reload).not.toHaveBeenCalled()
  })

  it('SSR（无 window）安全：不重载', async () => {
    vi.stubGlobal('window', undefined)
    const C = lazyPage('P', chunkFail)
    await C.preload!()
    expect(reload).not.toHaveBeenCalled()
  })
})
