import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataTable, type Column } from '../DataTable'

interface Row { id: string; name: string; score: number }

const columns: Column<Row>[] = [
  { key: 'name', header: '名称' },
  { key: 'score', header: '分数', render: (r) => <span>{r.score} 分</span> },
]
const rows: Row[] = [
  { id: 'a', name: '甲', score: 1 },
  { id: 'b', name: '乙', score: 2 },
  { id: 'c', name: '丙', score: 3 },
]

describe('DataTable', () => {
  it('3 行 2 列渲染表头与单元格文案', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />)
    expect(screen.getByText('名称')).toBeInTheDocument()
    expect(screen.getByText('分数')).toBeInTheDocument()
    for (const name of ['甲', '乙', '丙']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    expect(screen.getByText('2 分')).toBeInTheDocument() 
    expect(document.querySelectorAll('tbody tr')).toHaveLength(3)
  })

  it('loading 时渲染列数个 Skeleton 且表头保留', () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} loading />)
    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2)
    expect(screen.getByText('名称')).toBeInTheDocument()
  })

  it('空 rows 显示传入的 empty 文案', () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} empty={<div>这里空空如也</div>} />)
    expect(screen.getByText('这里空空如也')).toBeInTheDocument()
  })

  it('空 rows 且无 empty 时回退 PageEmpty 默认占位', () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} />)
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
  })

  it('传入 pagination 渲染底栏文案，且边界页禁用对应按钮', () => {
    const onPageChange = vi.fn()
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        pagination={{ page: 2, pageSize: 20, total: 42, onPageChange }}
      />,
    )
    
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('2/3')).toBeInTheDocument()
    const prev = screen.getByRole('button', { name: '上一页' })
    const next = screen.getByRole('button', { name: '下一页' })
    expect(prev).toBeEnabled()
    expect(next).toBeEnabled()
    fireEvent.click(next)
    expect(onPageChange).toHaveBeenCalledWith(3)
    fireEvent.click(prev)
    expect(onPageChange).toHaveBeenCalledWith(1)
  })

  it('pagination 首页禁用上一页、末页禁用下一页', () => {
    const first = render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        pagination={{ page: 1, pageSize: 20, total: 42, onPageChange: () => {} }}
      />,
    )
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled()
    expect(screen.getByText('1/3')).toBeInTheDocument()
    first.unmount()

    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        pagination={{ page: 3, pageSize: 20, total: 42, onPageChange: () => {} }}
      />,
    )
    expect(screen.getByRole('button', { name: '上一页' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
    expect(screen.getByText('3/3')).toBeInTheDocument()
  })

  it('空 rows 时不渲染分页底栏（空态行为不受 pagination 影响）', () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        pagination={{ page: 1, pageSize: 20, total: 0, onPageChange: () => {} }}
      />,
    )
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '下一页' })).not.toBeInTheDocument()
  })

  it('P3-10：stale page（有 total 的空页）不整表换空态——空表体+分页栏，保住"上一页"出口', () => {
    
    
    render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        pagination={{ page: 5, pageSize: 20, total: 42, onPageChange: () => {} }}
      />,
    )
    expect(screen.queryByText('暂无数据')).not.toBeInTheDocument()
    expect(screen.getByText('本页没有数据，可返回上一页')).toBeInTheDocument()
    
    expect(screen.getByRole('button', { name: '上一页' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
  })
})
