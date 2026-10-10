
import type { ReactNode } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { PloykitProvider } from '@ploykit/hooks'
import { ConfirmProvider } from './components/ConfirmDialog'
import { Toaster } from './components/toast'

/**
 * 框架级全局 Provider 一步到位组合件：PloykitProvider > ConfirmProvider > Toaster。
 *
 * 产品侧用它替换"逐个手挂三层 Provider"的样板（example/web/src/routes.tsx 的
 * AppProviders 即此组合的 historically hand-written 版本）。嵌套顺序即依赖顺序：
 * confirm 与 toast 均不依赖 auth/workspace 上下文，但统一挂在最外层可保证任何
 * 页面（含登录前页面）都能调用 useConfirm / toast。
 */
export function AppProviders({ children, queryClient }: {
  children: ReactNode
  /** 透传给 PloykitProvider；不传时由其内部创建默认 QueryClient。 */
  queryClient?: QueryClient
}) {
  return (
    <PloykitProvider queryClient={queryClient}>
      <ConfirmProvider>
        {children}
        <Toaster />
      </ConfirmProvider>
    </PloykitProvider>
  )
}
