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

/**
 * chunk 抓取失败自愈（部署窗口自愈）。
 *
 * 场景：新版本部署轮换并删除了旧的 hashed chunk；一个开着旧会话的标签页
 * 首次进入某条懒路由时，`import()` 抓取的 chunk 已经不存在，或者请求正撞上
 * 二进制重启窗口（反向代理 502/连接重置）。浏览器报
 * "Failed to fetch dynamically imported module"，错误边界接管——用户看到
 * 的就是一次硬故障，必须手动刷新才能恢复。
 *
 * 自愈：识别出「抓取型」失败（而非模块求值错误）后整页 `location.reload()`
 * 一次。重载拿到新 shell（服务端配 `Cache-Control: no-cache` 时必然是新
 * HTML），引用新哈希的 chunk，路由正常进入——错误边界通常来不及画出来。
 *
 * 防回环：sessionStorage 记上次重载时刻，冷却窗口内的再次失败不再重载
 * （此时 origin 真的坏了或网络断了，继续重载只会无限刷新；把错误交给错误
 * 边界如实呈现）。sessionStorage 不可用（隐私模式等）时退化为不重载。
 *
 * 为什么放在 lazyPage 里而不是全局 `vite:preloadError` 监听：应用内所有
 * 路由级动态 import 都从这里过（含 TanStack 的 intent 预热——预热路径把
 * 错误吞掉，但内层 catch 先行触发，重载照样发生），无需新公开 API；而
 * 非「Failed to fetch …」形态的失败（模块求值错误等）不匹配、不重载，
 * 由错误边界如实上报。
 */
const CHUNK_FETCH_ERROR_RE =
  /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i
const RELOAD_AT_KEY = 'ploykit:lazyPage:chunkReloadAt'
const RELOAD_COOLDOWN_MS = 10_000

function isChunkFetchError(err: unknown): boolean {
  return err instanceof Error && CHUNK_FETCH_ERROR_RE.test(err.message)
}

function reloadForChunkFetchError(): void {
  if (typeof window === 'undefined') return
  try {
    // null（从未重载）必须落到「可重载」分支——Number(null) 是 0 且有限，
    // 直接 Number() 会把首次失败误判为冷却期内（测试暴露的边界）。
    const raw = window.sessionStorage.getItem(RELOAD_AT_KEY)
    const prev = raw === null ? NaN : Number(raw)
    if (Number.isFinite(prev) && Date.now() - prev < RELOAD_COOLDOWN_MS) return
    window.sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()))
  } catch {
    // sessionStorage 不可用（隐私模式 / 存储被禁）：不重载，错误边界兜底
    return
  }
  window.location.reload()
}

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
        // 自愈先行于错误传播：重载指令在这里发出，React.lazy 随后把错误
        // 交给错误边界也只是重载落地前的一瞬。
        if (isChunkFetchError(err)) reloadForChunkFetchError()
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
