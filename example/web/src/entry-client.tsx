
import { StrictMode } from 'react'
import { createClientEntry } from '@ploykit/runtime/hydrate'
import { matchTanstackPage } from '@ploykit/runtime/router-tanstack'
import { ErrorBoundary, PageError } from '@ploykit/ui'
import routes from './routes'
import './index.css'

// TanStack 迁移后的客户端入口：router（含 AppProviders，经 assembler 的
// wrapInRouter 挂进 router context）由 routes() 元素自建——mount 只保留
// router 之外的层（StrictMode / ErrorBoundary）。hydrate 时 TanstackRouterMount
// 先同步 populateSync 出与服务端一致的匹配链（否则水合树对不上），随后
// Transitioner 在 layout effect 里走常规异步 load 收敛。
createClientEntry({
  routes,
  matchPage: matchTanstackPage,
  mount: (children) => (
    <StrictMode>
      <ErrorBoundary
        fallback={(error, reset) => (
          <PageError message={`页面渲染出错：${error.message}`} onRetry={reset} />
        )}
      >
        {children}
      </ErrorBoundary>
    </StrictMode>
  ),
})
