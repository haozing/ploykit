'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { cn } from './cn';

function RadixDialog({
  title,
  children,
  open = true,
  alert = false,
  className,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
  alert?: boolean;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 grid w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-md border border-border bg-card p-5 text-card-foreground shadow-lg',
            alert && 'border-destructive/40',
            className
          )}
          role={alert ? 'alertdialog' : 'dialog'}
        >
          <DialogPrimitive.Title className="text-lg font-semibold text-foreground">
            {title}
          </DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Dialog(props: {
  title: string;
  children: ReactNode;
  open?: boolean;
  className?: string;
}) {
  return <RadixDialog {...props} />;
}

export function AlertDialog(props: {
  title: string;
  children: ReactNode;
  open?: boolean;
  className?: string;
}) {
  return <RadixDialog {...props} alert />;
}
