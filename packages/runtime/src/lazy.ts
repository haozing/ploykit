import { lazy, type ComponentType } from 'react'

/**
 * 路由级代码分割的页面句柄：把一个动态 import 包成可以直接放进路由表的
 * 组件，浏览器只在真正进入这条路由时才下载它的 chunk。
 *
 * 为什么需要它而不是直接用 `React.lazy`：
 *
 * - **pageId 稳定**。`routeTable()` 由组件名推导 pageId（`BlogPost` →
 *   `blog-post`），而 `React.lazy()` 返回的是对象、没有 `name`；不补
 *   `displayName` 的话所有懒页面会退化成匿名 + `-2/-3` 后缀，pageId 与
 *   组件身份脱钩，Go 侧对账和 props 注入就失去了可读的锚点。
 * - **可预热**。TanStack Router 在 `defaultPreload: 'intent'` 下会调用
 *   `route.options.component.preload()`（router-core 的 routeNeedsLoad 认这个
 *   钩子），并用它的返回值等待预热完成；React.lazy 自己不暴露任何预热入口，
 *   这里补上并把 import 承诺记忆化，预热与首次渲染共用同一次网络请求。
 *
 * 约束（写进文档，不靠运行时兜底）：懒页面只用于 `render: 'csr'`。
 * `render: 'static'` 的页面在 SSR 沙箱里同步渲染，renderToString 期间不会
 * 等待 promise —— 静态页必须保持同步导入（平台侧有断言拦截产物里的挂起标记）。
 */
export function lazyPage(
  name: string,
  load: () => Promise<{ default: ComponentType<any> }>,
): ComponentType<any> {
  let pending: Promise<{ default: ComponentType<any> }> | undefined
  // 失败必须清掉记忆：否则一次网络抖动之后，这个路由在整个会话里都加载
  // 失败（React.lazy 内部同样会缓存拒绝，届时连重试入口都没有）。
  const once = () => {
    if (!pending) {
      pending = load().catch((err: unknown) => {
        pending = undefined
        throw err
      })
    }
    return pending
  }

  const Lazy = lazy(once) as unknown as ComponentType<any> & {
    displayName?: string
    preload?: () => Promise<unknown>
  }
  Lazy.displayName = name
  // 返回承诺让 TanStack 的预取路径能等待完成；错误在这里吞掉（预取是
  // best-effort，真正的失败会在渲染时由 React.lazy 抛出并交给错误边界，
  // 在这里提前报错只会产生一次无人消费的 unhandled rejection）。
  Lazy.preload = () => once().catch(() => {})
  return Lazy
}
