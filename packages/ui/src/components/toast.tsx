
import type { ComponentProps } from 'react'
import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner'
import { useT } from '../i18n'




import 'sonner/dist/styles.css'

type SonnerToast = typeof sonnerToast


const originalError = sonnerToast.error
const errorWithLongerDuration: SonnerToast['error'] = (message, data) =>
  originalError(message, { duration: 8000, ...data })

export const toast: SonnerToast = Object.assign(sonnerToast, {
  error: errorWithLongerDuration,
})

export function Toaster(props: ComponentProps<typeof SonnerToaster>) {
  // 通知区 aria-label 走 i18n 字典（默认 en）；{...props} 在后，宿主仍可覆盖。
  const t = useT()
  return <SonnerToaster richColors position="top-right" containerAriaLabel={t('ui.toast.containerAria')} {...props} />
}
