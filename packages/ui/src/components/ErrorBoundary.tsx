
import { Component, type ReactNode } from 'react'

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
        <p className="text-sm text-red-600">出错了</p>
        {error.message && <p className="mt-1 text-xs text-gray-400">{error.message}</p>}
        <button onClick={this.reset} className="mt-4 px-4 py-2 text-sm border rounded-md hover:bg-gray-50">
          重试
        </button>
      </div>
    )
  }
}
