import type {
  ButtonHTMLAttributes,
  ComponentProps,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function Page({ className, ...props }: ComponentProps<'main'>) {
  return <main {...props} className={cx('grid gap-6 p-6 text-slate-950', className)} />;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-normal">{title}</h1>
        {description ? <p className="max-w-3xl text-sm text-slate-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('grid gap-4', className)}>
      {title || description || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            {title ? <h2 className="text-base font-semibold tracking-normal">{title}</h2> : null}
            {description ? <p className="text-sm text-slate-600">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger';

const buttonTone: Record<ButtonTone, string> = {
  primary: 'border-blue-700 bg-blue-700 text-white hover:bg-blue-800',
  secondary: 'border-slate-300 bg-white text-slate-950 hover:bg-slate-50',
  ghost: 'border-transparent bg-transparent text-slate-700 hover:bg-slate-100',
  danger: 'border-red-700 bg-red-700 text-white hover:bg-red-800',
};

export function Button({
  tone = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone }) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex h-10 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-50',
        buttonTone[tone],
        className
      )}
    />
  );
}

export function IconButton({
  label,
  children,
  tone = 'ghost',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  tone?: ButtonTone;
  children: ReactNode;
}) {
  return (
    <Button
      {...props}
      tone={tone}
      aria-label={label}
      title={label}
      className={cx('h-9 w-9 px-0', className)}
    >
      {children}
    </Button>
  );
}

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

const badgeTone: Record<BadgeTone, string> = {
  neutral: 'border-slate-300 bg-slate-50 text-slate-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-red-200 bg-red-50 text-red-700',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: ComponentProps<'span'> & { tone?: BadgeTone }) {
  return (
    <span
      {...props}
      className={cx(
        'inline-flex min-h-6 items-center rounded-md border px-2 text-xs font-semibold',
        badgeTone[tone],
        className
      )}
    />
  );
}

const controlClass =
  'h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 disabled:cursor-not-allowed disabled:opacity-60';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(controlClass, className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea {...props} className={cx(controlClass, 'min-h-28 py-2 leading-6', className)} />
  );
}

export function Select({
  children,
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select {...props} className={cx(controlClass, className)}>
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
    <label className={cx('inline-flex items-center gap-2 text-sm text-slate-800', className)}>
      <input {...props} type="checkbox" className="h-4 w-4 rounded border-slate-300" />
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
    <label className={cx('inline-flex items-center gap-3 text-sm text-slate-800', className)}>
      <input {...props} type="checkbox" role="switch" className="h-4 w-8 rounded-full" />
      <span>{label}</span>
    </label>
  );
}

export function Tabs({
  tabs,
  active,
}: {
  tabs: readonly { id: string; label: ReactNode; href?: string }[];
  active?: string;
}) {
  const activeId = active ?? tabs[0]?.id;
  return (
    <div className="flex flex-wrap gap-2 border-b border-slate-200" role="tablist">
      {tabs.map((tab) => {
        const selected = activeId === tab.id;
        return tab.href ? (
          <a
            key={tab.id}
            href={tab.href}
            className={cx(
              'inline-flex min-h-9 items-center border-b-2 px-3 py-2 text-sm font-semibold',
              selected ? 'border-blue-700 text-blue-700' : 'border-transparent text-slate-600'
            )}
            role="tab"
            aria-selected={selected}
          >
            {tab.label}
          </a>
        ) : (
          <button
            key={tab.id}
            type="button"
            className={cx(
              'inline-flex min-h-9 items-center border-b-2 px-3 py-2 text-sm font-semibold',
              selected ? 'border-blue-700 text-blue-700' : 'border-transparent text-slate-600'
            )}
            role="tab"
            aria-selected={selected}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function StateBlock({
  title,
  description,
  tone = 'neutral',
}: {
  title: ReactNode;
  description?: ReactNode;
  tone?: BadgeTone;
}) {
  return (
    <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-4 text-sm">
      <Badge tone={tone}>{title}</Badge>
      {description ? <p className="text-slate-600">{description}</p> : null}
    </div>
  );
}

export function EmptyState(props: { title: ReactNode; description?: ReactNode }) {
  return <StateBlock {...props} tone="neutral" />;
}

export function ErrorState(props: { title: ReactNode; description?: ReactNode }) {
  return <StateBlock {...props} tone="danger" />;
}

export function LoadingState(props: { title?: ReactNode; description?: ReactNode }) {
  return <StateBlock title={props.title ?? 'Loading'} description={props.description} />;
}

export interface ResourceTableColumn<TRecord extends Record<string, unknown>> {
  key: keyof TRecord & string;
  header: ReactNode;
  render?: (value: TRecord[keyof TRecord & string], record: TRecord) => ReactNode;
}

export function ResourceTable<TRecord extends Record<string, unknown>>({
  rows,
  columns,
  empty,
}: {
  rows: readonly TRecord[];
  columns: readonly ResourceTableColumn<TRecord>[];
  empty?: ReactNode;
}) {
  if (rows.length === 0) {
    return <EmptyState title={empty ?? 'No records'} />;
  }
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="w-full min-w-full border-collapse text-sm">
        <thead className="bg-slate-50 text-left text-slate-600">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className="px-3 py-2 font-semibold">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={String(row.id ?? rowIndex)} className="border-t border-slate-200">
              {columns.map((column) => (
                <td key={column.key} className="px-3 py-2 text-slate-800">
                  {column.render ? column.render(row[column.key], row) : String(row[column.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResourceForm({
  children,
  actions,
  ...props
}: ComponentProps<'form'> & { actions?: ReactNode }) {
  return (
    <form {...props} className={cx('grid gap-4', props.className)}>
      {children}
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </form>
  );
}
