import { defineConfig } from 'vitest/config'



// 文件级 `// @vitest-environment node` 注释覆盖默认 jsdom 环境。
export default defineConfig({
  test: {
    environment: 'jsdom',
  },
})
