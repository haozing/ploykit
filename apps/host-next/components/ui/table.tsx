import type { ReactNode } from 'react';
import { cn } from './cn';
import { Skeleton } from './state';

export function DataTable({
  columns,
  rows,
  empty = '暂无记录',
  loading = false,
  loadingRows = 3,
  className,
  title,
  description,
  actions,
  minWidthClass = 'min-w-[720px]',
  density = 'regular',
}: {
  columns: readonly string[];
  rows: readonly (readonly ReactNode[])[];
  empty?: ReactNode;
  loading?: boolean;
  loadingRows?: number;
  className?: string;
  title?: string;
  description?: string;
  actions?: ReactNode;
  minWidthClass?: string;
  density?: 'regular' | 'compact';
}) {
  const compact = density === 'compact';
  return (
    <div
      className={cn(
        'min-w-0 overflow-hidden rounded-admin-md border border-admin-border bg-admin-surface shadow-admin-card',
        className
      )}
      aria-busy={loading}
    >
      {title || description || actions ? (
        <div
          className={cn(
            'flex flex-col gap-3 border-b border-admin-border sm:flex-row sm:items-center sm:justify-between',
            compact ? 'px-4 py-3 sm:px-5' : 'px-5 py-4'
          )}
        >
          <div className="min-w-0">
            {title ? <h2 className="truncate text-base font-semibold leading-6 text-admin-text">{title}</h2> : null}
            {description ? (
              <p className="mt-1 text-sm leading-6 text-admin-text-muted">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className={cn('w-full border-collapse text-left text-sm', minWidthClass)}>
          <thead className="bg-admin-surface-muted text-xs uppercase tracking-normal text-admin-text-subtle">
            <tr>
              {columns.map((column) => (
                <th key={column} className={cn('whitespace-nowrap font-semibold', compact ? 'px-4 py-2.5' : 'px-5 py-3')}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-admin-border">
            {loading
              ? Array.from({ length: loadingRows }).map((_, rowIndex) => (
                  <tr key={`loading:${rowIndex}`}>
                    {columns.map((column) => (
                      <td key={`${rowIndex}:${column}`} className={cn(compact ? 'px-4 py-3' : 'px-5 py-4')}>
                        <Skeleton label={`${column} 加载中`} />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="text-admin-text transition duration-150 hover:bg-admin-surface-muted/70">
                    {row.map((cell, cellIndex) => (
                      <td key={`${rowIndex}:${cellIndex}`} className={cn('align-middle leading-5', compact ? 'px-4 py-3' : 'px-5 py-4')}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
            {!loading && rows.length === 0 ? (
              <tr>
                <td className="px-5 py-10 text-center text-sm text-admin-text-muted" colSpan={columns.length}>
                  {empty}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
