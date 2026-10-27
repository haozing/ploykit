import { defineConfig } from 'vitest/config'



// 文件级 `// @vitest-environment node` 注释覆盖默认 jsdom 环境。
// @tanstack/* inline：router-tanstack 水合回归测试要 vi.doMock
// '@tanstack/router-core/isServer'（模拟 renderx ESBUILD_ALIASES 的 server
// 变体）——externalized 的原生 ESM 不经 vite-node 模块图，mock 不生效。
export default defineConfig({
  test: {
    environment: 'jsdom',
    server: {
      deps: {
        inline: [/@tanstack[\\/]/],
      },
    },
  },
})
