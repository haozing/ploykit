import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn';

const controlClass =
  'h-10 w-full rounded-admin-md border border-admin-border bg-admin-surface px-3 text-sm text-admin-text shadow-sm shadow-slate-950/5 outline-none transition placeholder:text-admin-text-subtle focus:border-admin-primary focus:ring-2 focus:ring-admin-primary/20 disabled:cursor-not-allowed disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref
) {
  return <input ref={ref} {...props} className={cn(controlClass, className)} />;
});

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(controlClass, 'min-h-28 resize-y py-2 leading-6', className)}
    />
  );
}

export function Select({
  children,
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select {...props} className={cn(controlClass, className)}>
      {children}
    </select>
  );
}

export function Checkbox({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn('inline-flex items-center gap-2 text-sm text-admin-text', className)}>
      <input
        {...props}
        type="checkbox"
        className="h-4 w-4 rounded border-admin-border text-admin-primary focus:ring-admin-primary"
      />
      <span>{label}</span>
    </label>
  );
}

export function Switch({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn('inline-flex items-center gap-3 text-sm text-admin-text', className)}>
      <input
        {...props}
        type="checkbox"
        role="switch"
        className="h-4 w-8 rounded-full border-admin-border text-admin-primary focus:ring-admin-primary"
      />
      <span>{label}</span>
    </label>
  );
}

export function FormField({
  label,
  htmlFor,
  name,
  type = 'text',
  placeholder,
  children,
}: {
  label: string;
  htmlFor?: string;
  name?: string;
  type?: string;
  placeholder?: string;
  children?: ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-admin-text" htmlFor={htmlFor}>
      <span>{label}</span>
      {children ?? <Input name={name} type={type} placeholder={placeholder} />}
    </label>
  );
}
