'use client';

import { useState, useTransition } from 'react';

export function CopyButton({
  value,
  label = '复制',
  copiedLabel = '已复制',
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="inline-flex min-h-8 items-center justify-center rounded-md px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
      disabled={pending || value.length === 0}
      onClick={() => {
        startTransition(async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
