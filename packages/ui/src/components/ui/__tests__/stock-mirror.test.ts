import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// stock 镜像不变式：components/ui 与 shadcn registry 输出保持一致（唯一允许的差异
// 是 adopt-shadcn.mjs 的 import 路径改写），业务概念禁止进入该目录。
// 本守卫钉住 import 白名单；未来 re-sync 时若 diff 出现白名单外依赖，说明有人
// 手改了 stock 文件——去组合层（AppShell/业务组件）实现，而不是改这里。
const uiDir = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('components/ui stock 镜像守卫', () => {
  const files = readdirSync(uiDir).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))

  it('目录非空且为 23+ 件 stock 组件', () => {
    expect(files.length).toBeGreaterThanOrEqual(23)
  })

  for (const f of files) {
    it(`${f} 的 import 全部在白名单内`, () => {
      const src = readFileSync(join(uiDir, f), 'utf8')
      const imports = [...src.matchAll(/from ["']([^"']+)["']/g)].map((m) => m[1])
      for (const spec of imports) {
        const ok =
          spec === 'react' || spec.startsWith('react/') ||
          spec === '@base-ui/react' || spec.startsWith('@base-ui/react/') ||
          spec.startsWith('@base-ui/') ||
          spec === 'class-variance-authority' || spec === 'clsx' || spec === 'tailwind-merge' ||
          spec === 'lucide-react' ||
          spec === '../../lib/utils' || spec === '../../hooks/use-mobile' ||
          /^\.\.?\//.test(spec) // 同目录兄弟 ui 件（./button、./separator 等）
        // 白名单之外的"包级"或"跨层"导入直接失败：
        //  - @ploykit/*（业务包）      - ../../provider、../../pages（包内跨层）
        expect(ok, `${f} 引用了非白名单模块: ${spec}`).toBe(true)
        expect(spec.startsWith('@ploykit/'), `${f} 引入了业务包 ${spec}`).toBe(false)
      }
    })
  }
})
