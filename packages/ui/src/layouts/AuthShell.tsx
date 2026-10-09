
import type { ReactNode } from 'react'

export interface AuthShellProps {
  children: ReactNode
  
  brand?: ReactNode
  
  footer?: ReactNode
}

export function AuthShell({ children, brand, footer }: AuthShellProps) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-background p-6 md:p-10">
      <div className="w-full max-w-sm">
        {brand && <div className="mb-6 flex flex-col items-center gap-2 text-center">{brand}</div>}
        {children}
        {footer && (
          <div className="mt-6 text-center text-xs text-muted-foreground">{footer}</div>
        )}
      </div>
    </div>
  )
}
