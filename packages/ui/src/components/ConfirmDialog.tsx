
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from './ui/alert-dialog'

interface ConfirmOptions {
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

// 缺省值必须是 null + useConfirm fail-fast（对齐 hooks 包 useAuthCtx 的行为）：
// 曾经的缺省值是 `async () => false`，产品忘挂 ConfirmProvider 时 confirm 静默返回
// false，"重置 Key"之类的按钮点了没反应且无任何报错，排查损耗极大。
const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)

  const confirm = useCallback((opts: ConfirmOptions) => {
    
    
    
    
    return new Promise<boolean>((resolve) => {
      let settled = false
      setState({
        ...opts,
        resolve: (v: boolean) => {
          if (settled) return
          settled = true
          resolve(v)
        },
      })
    })
  }, [])

  const handleClose = (result: boolean) => {
    state?.resolve(result)
    setState(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={!!state} onOpenChange={(open: boolean) => !open && handleClose(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{state?.title}</AlertDialogTitle>
            {state?.description && <AlertDialogDescription>{state.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handleClose(false)}>
              {state?.cancelText ?? '取消'}
            </AlertDialogCancel>
            <AlertDialogAction
              variant={state?.danger ? 'destructive' : 'default'}
              onClick={() => handleClose(true)}
            >
              {state?.confirmText ?? '确认'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm must be used within ConfirmProvider')
  return confirm
}
