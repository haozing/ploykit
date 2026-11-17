import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// findBy* 默认等待 1s；并行跑测试时动态渲染 + react-query 微任务常常超过，
// 失败信息却只是"找不到元素"。放宽到 5s（与 packages/ui 的 vitest.setup 一致）。
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
