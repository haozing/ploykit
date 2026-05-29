'use client';

import { ChevronDown, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';
import { cn } from '@host/components/ui/cn';
import type { ThemeMode } from './theme-types';

const themes: readonly {
  value: ThemeMode;
  label: string;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { setTheme, theme = 'system' } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => setMounted(true), []);

  const activeTheme = mounted ? theme : 'system';
  const active = themes.find((item) => item.value === activeTheme) ?? themes[2];
  const ActiveIcon = active.icon;

  return (
    <div
      className={cn(
        'relative inline-flex items-center rounded-admin-md text-admin-text',
        className
      )}
      aria-label="Theme"
    >
      <button
        type="button"
        className={cn(
          'inline-flex h-9 items-center justify-center gap-1.5 rounded-admin-md px-2 text-sm font-medium text-admin-text-muted transition',
          'hover:bg-admin-surface-muted hover:text-admin-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary',
          open && 'bg-admin-surface-muted text-admin-text'
        )}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Theme: ${active.label}`}
        title={`Theme: ${active.label}`}
        onClick={() => setOpen((value) => !value)}
      >
        <ActiveIcon className="h-4 w-4" aria-hidden />
        <ChevronDown className="h-3 w-3 opacity-70" aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-11 z-30 w-36 overflow-hidden rounded-admin-md border border-admin-border bg-admin-surface p-1 shadow-admin-popover"
        >
          {themes.map((item) => {
            const Icon = item.icon;
            const itemActive = activeTheme === item.value;
            return (
              <button
                key={item.value}
                type="button"
                role="menuitemradio"
                aria-checked={itemActive}
                className={cn(
                  'flex h-9 w-full items-center gap-2 rounded-admin-md px-2 text-left text-sm font-medium text-admin-text-muted transition',
                  'hover:bg-admin-surface-muted hover:text-admin-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary',
                  itemActive && 'bg-admin-primary-soft text-admin-primary'
                )}
                onClick={() => {
                  setTheme(item.value);
                  setOpen(false);
                }}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
