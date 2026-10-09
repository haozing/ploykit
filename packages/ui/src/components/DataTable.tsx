
import type { ReactNode } from 'react'
import { cn } from '../lib/utils'
import { PageEmpty } from './Page'
import { Skeleton } from './ui/skeleton'
import { Button } from './ui/Button'

export interface Column<T> {
  key: string
  header: ReactNode
  render?: (row: T) => ReactNode
  className?: string
}


export interface DataTablePagination {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  loading?: boolean
  empty?: ReactNode
  
  pagination?: DataTablePagination
}

export function DataTable<T>({ columns, rows, rowKey, loading = false, empty, pagination }: DataTableProps<T>) {
  
  
  
  const stalePage =
    !!pagination && !loading && rows.length === 0 && (pagination.total > 0 || pagination.page > 1)
  if (!loading && rows.length === 0 && !stalePage) {
    return <>{empty ?? <PageEmpty />}</>
  }
  const lastPage = pagination ? Math.max(1, Math.ceil(pagination.total / Math.max(1, pagination.pageSize))) : 1
  return (
    
    <div className="bg-card rounded-lg border overflow-hidden">
      {/* X1（admin-ui 卷）：容器只保圆角裁切，表格本体放内层横向滚动层——
          窄视口或长内容（超长名/事件码）下，overflow-hidden 直接把右侧列
          （多为操作列）裁成不可达且无滚动出口（users/workspaces/orders/
          webhook-deliveries/sso/overview 六页 S1 共同根因）。 */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-muted-foreground">
              {columns.map((col) => (
                <th key={col.key} className={cn('px-4 py-3 font-medium whitespace-nowrap', col.className)}>{col.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="border-b last:border-0">
                {columns.map((col) => (
                  <td key={col.key} className={cn('px-4 py-3', col.className)}>
                    <Skeleton className="h-4 w-full" />
                  </td>
                ))}
              </tr>
            ) : stalePage ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  本页没有数据，可返回上一页
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={rowKey(row)} className="border-b last:border-0 hover:bg-muted/30">
                  {columns.map((col) => (
                    <td key={col.key} className={cn('px-4 py-3', col.className)}>
                      {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pagination && (
        <div
          data-slot="data-table-pagination"
          aria-busy={loading || undefined}
          className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground"
        >
          {/* B-users-8：加载中不显示"共 0 条 · 第 1/1 页"假总数——置灰为加载文案 */}
          {loading ? (
            <span>加载中…</span>
          ) : (
            <span>
              共 <span className="font-medium text-foreground">{pagination.total}</span> 条 · 第{' '}
              <span className="font-medium text-foreground">
                {pagination.page}/{lastPage}
              </span>{' '}
              页
            </span>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={loading || pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
            >
              上一页
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={loading || pagination.page >= lastPage}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
