import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from './ui/alert-dialog'

/**
 * 确认弹窗的视觉实现（Base UI AlertDialog 原语）。
 *
 * **单独成模块是被 ConfirmDialog.tsx 懒加载的**：这套原语实测 23.0 KB gzip，
 * 而它只服务于"删除/重置/转让"这类破坏性操作。留在根 Provider 里等于让每个
 * 页面为可能一辈子用不上的一次交互付这笔字节。
 *
 * 本文件刻意不导出 hook、不含状态——纯粹的受控展示组件，这样它可以被安全
 * 地动态 import 而不影响 ConfirmProvider 的同步 API。
 */

export interface ConfirmDialogState {
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

export default function ConfirmDialogBody({
  state,
  onClose,
}: {
  state: ConfirmDialogState
  onClose: (result: boolean) => void
}) {
  return (
    <AlertDialog open onOpenChange={(open: boolean) => !open && onClose(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state.title}</AlertDialogTitle>
          {state.description && (
            <AlertDialogDescription>{state.description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onClose(false)}>
            {state.cancelText ?? '取消'}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={state.danger ? 'destructive' : 'default'}
            onClick={() => onClose(true)}
          >
            {state.confirmText ?? '确认'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
