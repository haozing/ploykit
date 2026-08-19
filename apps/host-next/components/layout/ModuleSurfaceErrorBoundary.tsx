'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ModuleSurfaceErrorBoundaryProps {
  moduleId: string;
  children: ReactNode;
}

interface ModuleSurfaceErrorBoundaryState {
  hasError: boolean;
}

export class ModuleSurfaceErrorBoundary extends Component<
  ModuleSurfaceErrorBoundaryProps,
  ModuleSurfaceErrorBoundaryState
> {
  state: ModuleSurfaceErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ModuleSurfaceErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Module surface failed: ${this.props.moduleId}`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Module surface unavailable.
        </div>
      );
    }

    return this.props.children;
  }
}
