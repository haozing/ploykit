/**
 * ════════════════════════════════════════════════════════════
 * Toast NotificationsComponent
 * ════════════════════════════════════════════════════════════
 *
 * 简单of Toast NotificationsSystem，用at显示Success/ErrorMessage
 *
 * 特性：
 * - 自动消失（3second(s)）
 * - Success/Error两种Type
 * - 动画效果
 */

'use client';

import { useEffect } from 'react';

export type ToastType = 'success' | 'error';

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
  duration?: number;
}

export function Toast({ message, type, onClose, duration = 3000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const bgColor = type === 'success' ? 'var(--color-success)' : 'var(--color-destructive)';

  return (
    <div
      className="fixed bottom-8 right-8 px-6 py-4 rounded-lg shadow-lg text-white max-w-md z-50 animate-slide-in"
      style={{
        backgroundColor: bgColor,
        animation: 'slideIn 0.3s ease-out',
      }}
    >
      <div className="flex items-center gap-3">
        {/* Icon */}
        {type === 'success' ? (
          <svg
            className="w-6 h-6 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg
            className="w-6 h-6 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        )}

        {/* Message */}
        <p className="font-medium">{message}</p>

        {/* Close button */}
        <button
          onClick={onClose}
          className="ml-auto flex-shrink-0 hover:opacity-80 transition-opacity"
          aria-label="Close notification"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <style jsx>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
