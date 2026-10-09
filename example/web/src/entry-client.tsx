
import { StrictMode } from 'react'
import { BrowserRouter } from 'react-router'
import { createClientEntry } from '@ploykit/runtime/hydrate'
import { ErrorBoundary, PageError } from '@ploykit/ui'
import routes, { AppProviders } from './routes'
import './index.css'

createClientEntry({
  routes,
  mount: (children) => (
    <StrictMode>
      <BrowserRouter>
        <AppProviders>
          <ErrorBoundary
            fallback={(error, reset) => (
              <PageError message={`页面渲染出错：${error.message}`} onRetry={reset} />
            )}
          >
            {children}
          </ErrorBoundary>
        </AppProviders>
      </BrowserRouter>
    </StrictMode>
  ),
})
