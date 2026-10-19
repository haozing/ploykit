
import { createElement } from 'react'
import { matchRoutes, Route, Routes } from 'react-router'
import type { PageSpec, RouteAssembler } from './routes'


// react-router 专属的运行时实现，全部集中在这一子路径
// （@ploykit/runtime/router-react-router）。主入口 @ploykit/runtime 的模块
// 图保持 router 无关：TanStack Router 等消费方可直接 import 桶文件，而 RR
// 消费方从这里显式取组装器/匹配器注入。


export function reactRouterAssembler(): RouteAssembler {
  return {
    assemble(pages, propsByPageId) {
      return createElement(
        Routes,
        null,
        pages.map((p) =>
          createElement(Route, {
            key: p.path,
            path: p.path,
            element: createElement(p.component, propsByPageId?.[p.pageId]),
          }),
        ),
      )
    },
  }
}


// matchPage 的 react-router 实现（供 createClientEntry 的 matchPage 选项）：
// 用 matchRoutes 把当前 pathname 对到客户端自己的路由表上，返回叶子
// pageId。path 模式是字符串字面量，压缩后两端一致 —— 这是 #17 修复的根
// 基（组件名会被 minify 改写而 path 不会）。无命中返回 null（由 hydrate
// 的回退梯子接管：嵌入 pageId → 警告）。
export function matchRoutePage(pathname: string, pages: PageSpec[]): string | null {
  const matches = matchRoutes(
    pages.map((p) => ({ path: p.path, id: p.pageId })),
    pathname,
  )
  const leaf = matches && matches[matches.length - 1]
  return (leaf && leaf.route.id) || null
}
