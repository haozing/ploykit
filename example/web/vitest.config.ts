import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const rootRequire = createRequire(path.join(here, '../../node_modules/'))

/**
 * 解析单一 React 实例的目录。
 *
 * npm workspaces 会在 example/web/node_modules 里也放一份 react/react-dom
 * （与根同版本），而挂在根 node_modules 的 @testing-library/react 用根那一份
 * react-dom。两套实例 → hook dispatcher 对不上，症状是
 * "Invalid hook call / Cannot read properties of null (reading 'useEffect')"。
 * 先试根（框架包实际解析到的位置），拿不到再退回本包自己的副本。
 */
function resolvePkgDir(name: string): string {
  const probe = createRequire(import.meta.url)
  for (const req of [rootRequire, probe]) {
    try {
      // 从包入口回溯到包根（入口在 <pkg>/...）
      const entry = req.resolve(name)
      const marker = `${path.sep}node_modules${path.sep}${name.split('/').join(path.sep)}${path.sep}`
      const idx = entry.lastIndexOf(marker)
      if (idx >= 0) return entry.slice(0, idx + marker.length - 1)
    } catch {
      // 换下一个解析起点
    }
  }
  throw new Error(`[vitest.config] cannot resolve ${name} — run npm install at the repo root`)
}

const reactDir = resolvePkgDir('react')
const reactDomDir = resolvePkgDir('react-dom')

/**
 * example/web 的最小测试工程（jsdom + @testing-library/react）。
 *
 * 依赖全部复用 monorepo 已安装的版本（vitest 5 / @testing-library/react 16.3 /
 * jsdom 29——与 packages/ui 的 devDependencies 同一批，npm workspaces 提升到
 * 根 node_modules），不引入新依赖。resolve.conditions ['development'] 与
 * tsconfig 的 customConditions 一致：@ploykit/* 的 exports 在 development 条件
 * 下指向源码（src/index.ts），测试因此不依赖预先 build 产物。
 *
 * 覆盖面：api/video.ts 的契约与 URL 构造（纯函数 + fetch 形状）、帧数公式、
 * radio 组键盘导航，以及两个页面（列表页取数/模板流、工作室页权限门控）。
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    server: {
      deps: {
        // 框架包走 Vite 管线（development 条件 → 源码），上面的 alias 与
        // conditions 对它们才生效。
        inline: [/@ploykit\//, /@tanstack\//, /@testing-library\//],
      },
    },
  },
  resolve: {
    conditions: ['development'],
    alias: [
      { find: /^react$/, replacement: path.join(reactDir, 'index.js') },
      { find: /^react\/(.*)$/, replacement: path.join(reactDir, '$1') },
      { find: /^react-dom$/, replacement: path.join(reactDomDir, 'index.js') },
      { find: /^react-dom\/(.*)$/, replacement: path.join(reactDomDir, '$1') },
    ],
    dedupe: [
      'react', 'react-dom', 'react-router', 'react-router-dom',
      '@tanstack/react-query', 'zod',
    ],
  },
})
