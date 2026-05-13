/**
 * Toast Hook
 *
 * Wrapper around sonner toast for consistent usage
 */

import { toast as sonnerToast } from 'sonner';

export interface ToastProps {
  title?: string;
  description?: string;
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info';
}

export function useToast() {
  return {
    toast: ({ title, description, variant = 'default' }: ToastProps) => {
      const message = title || description || '';
      const descriptionText = title && description ? description : undefined;

      switch (variant) {
        case 'success':
          return sonnerToast.success(message, {
            description: descriptionText,
          });
        case 'error':
          return sonnerToast.error(message, {
            description: descriptionText,
          });
        case 'warning':
          return sonnerToast.warning(message, {
            description: descriptionText,
          });
        case 'info':
          return sonnerToast.info(message, {
            description: descriptionText,
          });
        default:
          return sonnerToast(message, {
            description: descriptionText,
          });
      }
    },
  };
}
