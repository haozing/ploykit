// 解耦回归哨兵（orkome）：@ploykit/runtime 主桶曾因 routes/hydrate 值导入
// react-router，使不用 RR 的消费方（TanStack Router）连桶都 import 不了。
// 本文件两条防线：
// 1. 静态图检查 —— 从 index.ts / hydrate.ts 出发递归解析相对导入，断言模
//    块图不触及 react-router（也不经子路径 router-react-router.ts 绕回）；
// 2. 功能检查 —— 只从主桶 + hydrate 子路径 import，用「自定义组装器 + 自
//    定义 matchPage」走完 table 构建与水合注入全链，全程图内无任何具体
//    router。
// 注意：本文件自身严禁 import react-router / ../router-react-router，否则
// 防线 2 失去意义。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
// 仅允许这两个入口（主桶 + hydrate 子路径）——与 TanStack 消费方的导入面一致
import { createClientEntry, PROPS_SCRIPT_ID, serializeProps } from '../hydrate'
import { routeTable } from '../routes'

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..')

// 从 entry 出发递归收集相对导入闭包（.ts/.tsx），返回触及的所有模块说明符
function relativeImportClosure(entry: string): string[] {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    const code = readFileSync(file, 'utf8')
    for (const m of code.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const spec = m[1]!
      const base = join(dirname(file), spec)
      const resolved = [`${base}.ts`, `${base}.tsx`, base].find((c) => {
        try {
          readFileSync(c)
          return true
        } catch {
          return false
        }
      })
      if (resolved) queue.push(resolved)
    }
  }
  return [...seen]
}

describe('主桶模块图 router 无关（orkome 解耦哨兵）', () => {
  it('index.ts / hydrate.ts 的相对导入闭包不触及 react-router（直接或经 router-react-router.ts）', () => {
    for (const entry of ['index.ts', 'hydrate.ts']) {
      const closure = relativeImportClosure(join(srcDir, entry))
      expect(closure.length).toBeGreaterThan(1)
      for (const file of closure) {
        expect(file, `${entry} 的模块图触及 ${file}`).not.toMatch(/router-react-router\.tsx?$/)
        const code = readFileSync(file, 'utf8')
        expect(code, `${file} 值/类型导入了 react-router`).not.toMatch(
          /from\s+['"]react-router/,
        )
      }
    }
  })

  it('自定义组装器 + 自定义 matchPage：水合 props 注入全链可用（图内无 react-router）', () => {
    function WorkPage(props: { marker?: string } | undefined) {
      const marker = props?.marker ?? 'no-props'
      return createElement('p', { 'data-marker': marker }, marker)
    }

    // TanStack 消费方同款：自备组装器（这里用最普通的单元素树）+ 自备匹配器
    const customAssembler = {
      assemble(pages: ReadonlyArray<{ pageId: string; component: React.ComponentType<any> }>, propsByPageId?: Record<string, unknown>) {
        // 非 router 组装的示例：单页应用壳逐页直挂（仅证明缝可用，非推荐形态）
        return createElement(
          'div',
          null,
          pages.map((p) => createElement(p.component, { key: p.pageId, ...((propsByPageId?.[p.pageId] as object) ?? {}) })),
        )
      },
    }
    const matchPage = (pathname: string, pages: ReadonlyArray<{ path: string; pageId: string }>) =>
      pages.find((p) => p.path === pathname)?.pageId ?? null

    const table = routeTable({ '/work': { component: WorkPage, render: 'static' } }, customAssembler)
    expect(table.pages.map((p) => p.pageId)).toEqual(['work-page'])

    const props = { marker: 'from-ssr' }
    // 根内预置与服务端一致的标记（真实 SSR 产物的替身，含自定义组装器的
    // 包裹层 div），水合不触发不匹配恢复
    document.body.innerHTML = `<div id="root"><div><p data-marker="from-ssr">from-ssr</p></div></div>
<script type="application/json" id="${PROPS_SCRIPT_ID}" data-page-id="work-page">${serializeProps(props)}</script>`
    window.history.pushState({}, '', '/work')

    createClientEntry({
      routes: table,
      mount: (c) => c,
      matchPage,
    })
    // matchPage 命中 /work → work-page 拿到 SSR props（不经 react-router 的
    // matchRoutes，也不经嵌入 pageId 的回退梯子）
    expect(document.querySelector('[data-marker]')?.textContent).toBe('from-ssr')
  })
})
