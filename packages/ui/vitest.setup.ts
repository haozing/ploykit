import '@testing-library/jest-dom/vitest'

import { configure } from '@testing-library/react'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * `findBy*` 的默认等待是 1s，而这套测试里有若干断言要等一次**动态 import**
 * （本批引入的按需加载：登录 tabs、确认弹窗、密码 schema 拆包）。单跑时这些
 * 只有几十毫秒，但全量并行（83 个文件各自建一个 jsdom）时会跨过 1s，失败
 * 信息却是"找不到元素"——看起来像功能坏了，实际只是调度抖动。
 *
 * 等待窗口调到 5s：真实的功能缺失仍然会失败（只是慢 4 秒），而负载抖动不再
 * 伪装成回归。`testTimeout` 同步调到 15s，保证等待窗口小于用例上限。
 */
configure({ asyncUtilTimeout: 5_000 })

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

afterEach(cleanup)
