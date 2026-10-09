
import type { ComponentProps } from 'react'
import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner'




import 'sonner/dist/styles.css'

type SonnerToast = typeof sonnerToast


const originalError = sonnerToast.error
const errorWithLongerDuration: SonnerToast['error'] = (message, data) =>
  originalError(message, { duration: 8000, ...data })

export const toast: SonnerToast = Object.assign(sonnerToast, {
  error: errorWithLongerDuration,
})

export function Toaster(props: ComponentProps<typeof SonnerToaster>) {
  return <SonnerToaster richColors position="top-right" containerAriaLabel="通知" {...props} />
}
