
import { Fragment, type ReactNode } from 'react'
import { cn } from '../lib/utils'
import { PageEmpty } from './Page'
import { Skeleton } from './ui/skeleton'
import { Button } from './ui/button'

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
  /** 行 key 生成器。第二参数是该行在 rows 中的下标，用于同业务键多行（如同 code 多版本）时拼出唯一 key。少参回调仍然兼容。 */
  rowKey: (row: T, index: number) => string
  loading?: boolean
  empty?: ReactNode
  /** 整行点击回调。传入后行 hover 显示 pointer 光标。 */
  onRowClick?: (row: T) => void
  /**
   * 展开行扩展点：对每行调用，返回非 null 时在该行下方插入一个展开行
   * （单个 td，colSpan 覆盖全部列）。展开/收起状态由调用方用行数据自行表达
   * （收起的行返回 null 即不渲染）——本组件不持有内部展开状态。
   */
  renderExpanded?: (row: T, index: number) => ReactNode

  pagination?: DataTablePagination
}

export function DataTable<T>({ columns, rows, rowKey, loading = false, empty, onRowClick, renderExpanded, pagination }: DataTableProps<T>) {
  
  
  
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
              rows.map((row, index) => {
                const expanded = renderExpanded ? renderExpanded(row, index) : null
                return (
                  <Fragment key={rowKey(row, index)}>
                    <tr
                      className={cn('border-b last:border-0 hover:bg-muted/30', onRowClick && 'cursor-pointer')}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                    >
                      {columns.map((col) => (
                        <td key={col.key} className={cn('px-4 py-3', col.className)}>
                          {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')}
                        </td>
                      ))}
                    </tr>
                    {expanded !== null && (
                      <tr className="border-b last:border-0" data-slot="data-table-expanded-row">
                        <td colSpan={columns.length} className="px-4 py-3">
                          {expanded}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })
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
