import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react'
import type { ConfirmDialogState } from './ConfirmDialogBody'

/**
 * ConfirmProvider —— 全局确认弹窗（Promise 化的 useConfirm）。
 *
 * **为什么弹窗本体是懒加载**：它背后是 Base UI 的 AlertDialog 原语，实测
 * 23.0 KB gzip。这个 Provider 挂在根 Provider 链上，所以静态导入意味着
 * 每一个页面（含落地页之外的所有水合页）都要付这 23KB——而确认弹窗只在
 * 用户点了"删除/重置/转让"这类破坏性操作后才出现。
 *
 * 分工：
 * - **留在入口的**：context + 调用队列（几行代码，无依赖）。
 * - **按需加载的**：AlertDialog 的整套原语（首次 confirm() 触发 import）。
 *
 * 调用方完全不受影响：`useConfirm()` 仍然同步返回一个 `Promise<boolean>`，
 * 弹窗在模块就绪后自行出现。三处细节保证行为不打折：
 * 1. `confirm()` 立即 `setState`（记录请求），弹窗模块与状态并行加载；
 * 2. 加载期间渲染 null——弹层是覆盖层，用户看到的仍是触发它的那个页面，
 *    不存在布局跳动；
 * 3. 子 chunk 加载失败时按「取消」结算并记录错误：否则 Promise 永不
 *    resolve，调用方 `await confirm()` 之后的逻辑（含按钮复位）全部卡死。
 *
 * 这里刻意不用 `React.lazy`：它的失败态是**记忆化**的（一次 chunk 加载
 * 失败后，同一个 lazy 组件每次渲染都会重新抛同一个错误），一次网络抖动
 * 会让确认弹窗在本次会话里永久不可用。挂载时自己 import 则每次 confirm()
 * 都是新的尝试——成功后走模块缓存，几乎零成本。
 *
 * **预渲染安全**：没有 SSR 分支（`state` 初值 null，服务端渲染不出弹窗，
 * 也不会触发动态 import），所以 static/csr 两类页面都适用。
 */

interface ConfirmOptions {
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

type PendingConfirm = ConfirmOptions & { resolve: (v: boolean) => void }

type DialogComponent = ComponentType<{
  state: ConfirmDialogState
  onClose: (result: boolean) => void
}>

// 缺省值必须是 null + useConfirm fail-fast（对齐 hooks 包 useAuthCtx 的行为）：
// 曾经的缺省值是 `async () => false`，产品忘挂 ConfirmProvider 时 confirm 静默返回
// false，"重置 Key"之类的按钮点了没反应且无任何报错，排查损耗极大。
const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PendingConfirm | null>(null)
  // 结算入口读 ref 而不是闭包里的 state：handleClose 必须是稳定引用
  // （Host 的加载 effect 不重跑），而结算又必须拿到当前那次请求的 resolve。
  //
  // 写入必须发生在 confirm() 里同步完成，不能靠 useEffect 同步 state：子模块
  // 加载失败的 catch 是一个微任务，可能早于 passive effect 被冲刷，那时
  // ref 仍为 null，结算就丢了——正是这条兜底要防的死锁。
  const stateRef = useRef<PendingConfirm | null>(null)

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      let settled = false
      const pending: PendingConfirm = {
        ...opts,
        resolve: (v: boolean) => {
          if (settled) return
          settled = true
          stateRef.current = null
          resolve(v)
        },
      }
      // 同一时刻只可能有一个弹窗。第二次 confirm() 若直接覆盖 state，第一个
      // Promise 就永远不会结算——调用方 `await confirm()` 之后的代码（含按钮
      // 复位）永久卡住。按「取消」结算它，再换成新的请求。
      stateRef.current?.resolve(false)
      stateRef.current = pending
      setState(pending)
    })
  }, [])

  const handleClose = useCallback((result: boolean) => {
    stateRef.current?.resolve(result)
    setState(null)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && <ConfirmDialogHost state={state} onClose={handleClose} />}
    </ConfirmContext.Provider>
  )
}

/**
 * 每次出现都重新尝试加载弹窗模块。成功前渲染 null（覆盖层，不影响布局）；
 * 失败则按「取消」结算。`alive` 守卫防止弹窗已关闭后异步结果再上屏。
 */
function ConfirmDialogHost({
  state,
  onClose,
}: {
  state: ConfirmDialogState
  onClose: (result: boolean) => void
}) {
  const [Dialog, setDialog] = useState<DialogComponent | null>(null)

  useEffect(() => {
    let alive = true
    import('./ConfirmDialogBody')
      .then((m) => {
        if (alive) setDialog(() => m.default)
      })
      .catch((err: unknown) => {
        if (!alive) return
        console.error('[ploykit/ui] 确认弹窗模块加载失败，已按「取消」处理', err)
        onClose(false)
      })
    return () => {
      alive = false
    }
    // 只在挂载时加载：onClose 是 useCallback 稳定引用，state 变化不该重取模块。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!Dialog) return null
  return <Dialog state={state} onClose={onClose} />
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm must be used within ConfirmProvider')
  return confirm
}
