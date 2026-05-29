import type { ReactNode } from 'react';
import { cn } from '@host/components/ui/cn';

const slotClassById: Record<string, string> = {
  hero: 'w-full',
  'header.actions':
    'flex min-w-0 flex-wrap items-center justify-end gap-2 overflow-hidden [&_*]:min-w-0',
  'main.before': 'grid w-full min-w-0 gap-3 overflow-hidden',
  'main.after': 'grid w-full min-w-0 gap-3 overflow-hidden',
  'footer.before': 'grid w-full min-w-0 gap-3 overflow-hidden',
  side: 'grid w-full min-w-0 gap-3 overflow-hidden lg:max-w-sm',
  diagnostics: 'grid w-full min-w-0 gap-3 overflow-hidden',
};

export function HostPageSlot({
  slotId,
  className,
  children,
}: {
  slotId: string;
  className?: string;
  children?: ReactNode;
}) {
  if (!children) {
    return null;
  }

  return (
    <div
      data-host-page-slot={slotId}
      className={cn(slotClassById[slotId] ?? 'grid w-full min-w-0 gap-3 overflow-hidden', className)}
    >
      {children}
    </div>
  );
}
