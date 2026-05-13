/**
 * ErrorBoundary - React Error Boundary Component
 *
 * Features:
 * - Catch JavaScript errors in child component tree
 * - Record error logs
 * - Display fallback UI instead of crash
 *
 * Use Cases:
 * 1. Root layout - Protect entire application
 * 2. Plugin pages - Isolate plugin errors
 * 3. Critical components - Prevent local errors from affecting global state
 *
 * Usage Example:
 * ```tsx
 * <ErrorBoundary context="root">
 *   <App />
 * </ErrorBoundary>
 *
 * <ErrorBoundary context="plugin:welcome">
 *   <PluginComponent />
 * </ErrorBoundary>
 * ```
 */

'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { ErrorFallback } from './ErrorFallback';

interface Props {
  children: ReactNode;
  /** Custom error UI (optional) */
  fallback?: ReactNode;
  /** Error context (used to identify error source, e.g. 'root', 'plugin:welcome') */
  context?: string;
  /** Error callback (optional) */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  /**
   * Update state when error occurs
   */
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  /**
   * Catch error and record logs
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Use console.error (because we may be on client side, logger only works on server)
    // If client logs needed, can send to logging service
    console.error('React Error Boundary caught error:', {
      context: this.props.context || 'unknown',
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      componentStack: errorInfo.componentStack,
    });

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);
  }

  /**
   * Reset error status
   */
  resetError = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback or default error UI
      return (
        this.props.fallback || (
          <ErrorFallback
            error={this.state.error}
            context={this.props.context}
            onReset={this.resetError}
          />
        )
      );
    }

    return this.props.children;
  }
}
