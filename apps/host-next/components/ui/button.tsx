import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

type ButtonVariant = 'solid' | 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
type ButtonSize = 'default' | 'small' | 'icon';

const variantClass: Record<ButtonVariant, string> = {
  solid: 'bg-admin-primary text-white shadow-sm shadow-blue-950/10 hover:bg-blue-700 dark:text-slate-950 dark:hover:bg-blue-300',
  primary: 'bg-admin-primary text-white shadow-sm shadow-blue-950/10 hover:bg-blue-700 dark:text-slate-950 dark:hover:bg-blue-300',
  secondary: 'border border-admin-border bg-admin-surface text-admin-text shadow-sm shadow-slate-950/5 hover:bg-admin-surface-muted',
  ghost: 'text-admin-text-muted hover:bg-admin-surface-muted hover:text-admin-text',
  danger: 'bg-admin-danger text-white shadow-sm shadow-red-950/10 hover:bg-red-700 dark:hover:bg-red-300 dark:hover:text-slate-950',
  link: 'h-auto min-h-0 rounded-none p-0 text-admin-primary underline-offset-4 hover:underline',
};

const sizeClass: Record<ButtonSize, string> = {
  default: 'h-10 px-4',
  small: 'h-9 px-3 text-xs',
  icon: 'h-9 w-9 p-0',
};

export function Button({
  variant = 'solid',
  size = 'default',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-admin-md text-sm font-semibold transition duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50',
        variantClass[variant],
        sizeClass[size],
        className
      )}
    />
  );
}

export function ButtonLink({
  href,
  variant = 'solid',
  size = 'default',
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-admin-md text-sm font-semibold transition duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary',
        variantClass[variant],
        sizeClass[size],
        className
      )}
    >
      {children}
    </Link>
  );
}

export function IconButton({
  label,
  children,
  variant = 'ghost',
  className,
  ...props
}: ComponentProps<'button'> & {
  label: string;
  variant?: ButtonVariant;
}) {
  return (
    <Button
      {...props}
      variant={variant}
      size="icon"
      className={className}
      aria-label={label}
      title={label}
    >
      {children}
    </Button>
  );
}
