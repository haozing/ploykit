
import { Component, type ReactNode } from 'react'
import { t } from '../i18n'

export interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode)
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error('[ErrorBoundary] 子树渲染出错:', error)
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children
    const { fallback } = this.props
    if (fallback !== undefined) {
      return typeof fallback === 'function' ? fallback(error, this.reset) : fallback
    }
    return (
      <div role="alert" className="flex flex-col items-center justify-center py-12 text-center">
        <div className="text-4xl mb-3">⚠️</div>
        {/* class 组件 render 内不能用 hook：默认错误态文案走模块级 t（g9：ui.errorBoundary.*），
            Provider 挂载时 setUiLang 已对齐当前语言。 */}
        <p className="text-sm text-destructive">{t('ui.errorBoundary.title')}</p>
        {error.message && <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>}
        <button onClick={this.reset} className="mt-4 px-4 py-2 text-sm border rounded-md hover:bg-muted">
          {t('ui.errorBoundary.retry')}
        </button>
      </div>
    )
  }
}
