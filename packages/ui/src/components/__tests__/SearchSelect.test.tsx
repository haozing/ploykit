import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SearchSelect } from '../SearchSelect'

const options = [
  { value: 'a', label: '甲组' },
  { value: 'b', label: '乙组' },
  { value: 'c', label: '丙组' },
]

describe('SearchSelect', () => {
  it('渲染触发按钮并显示占位文案', () => {
    render(<SearchSelect options={options} value={null} onChange={() => {}} triggerAriaLabel="名单组" />)
    const trigger = screen.getByRole('combobox', { name: '名单组' })
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveTextContent('请选择')
  })

  it('受控 value 回显对应 label（未匹配时显示占位）', () => {
    const { rerender } = render(
      <SearchSelect options={options} value="b" onChange={() => {}} triggerAriaLabel="组" />,
    )
    expect(screen.getByRole('combobox', { name: '组' })).toHaveTextContent('乙组')
    rerender(<SearchSelect options={options} value={null} onChange={() => {}} triggerAriaLabel="组" />)
    expect(screen.getByRole('combobox', { name: '组' })).toHaveTextContent('请选择')
  })

  it('点击触发按钮展开选项，点选回调原始 value', async () => {
    const onChange = vi.fn()
    render(<SearchSelect options={options} value={null} onChange={onChange} triggerAriaLabel="组" />)
    fireEvent.click(screen.getByRole('combobox', { name: '组' }))
    const option = await screen.findByRole('option', { name: '乙组' })
    fireEvent.click(option)
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('数值型 value 保持原始类型（不做字符串化）', async () => {
    const numOptions = [
      { value: 1, label: '一级' },
      { value: 2, label: '二级' },
    ]
    const onChange = vi.fn()
    render(<SearchSelect options={numOptions} value={null} onChange={onChange} triggerAriaLabel="等级" />)
    fireEvent.click(screen.getByRole('combobox', { name: '等级' }))
    fireEvent.click(await screen.findByRole('option', { name: '二级' }))
    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('clearable 且有值时点清除按钮回调 null', async () => {
    const onChange = vi.fn()
    render(
      <SearchSelect options={options} value="a" onChange={onChange} clearable triggerAriaLabel="组" />,
    )
    const clear = screen.getByRole('button', { name: '清除选择' })
    fireEvent.click(clear)
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('disabled 时触发按钮不可交互', () => {
    render(<SearchSelect options={options} value={null} onChange={() => {}} disabled triggerAriaLabel="组" />)
    expect(screen.getByRole('combobox', { name: '组' })).toBeDisabled()
  })

  it('searchable：弹层内输入过滤后仅保留匹配项', async () => {
    render(
      <SearchSelect options={options} value={null} onChange={() => {}} searchable triggerAriaLabel="组" />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: '组' }))
    const input = await screen.findByPlaceholderText('搜索…')
    fireEvent.change(input, { target: { value: '丙' } })
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: '甲组' })).not.toBeInTheDocument()
      expect(screen.getByRole('option', { name: '丙组' })).toBeInTheDocument()
    })
  })

  it('无匹配项时展示 emptyText 覆盖文案', async () => {
    render(
      <SearchSelect
        options={options}
        value={null}
        onChange={() => {}}
        searchable
        emptyText="没有这个组"
        triggerAriaLabel="组"
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: '组' }))
    const input = await screen.findByPlaceholderText('搜索…')
    fireEvent.change(input, { target: { value: 'zzz' } })
    expect(await screen.findByText('没有这个组')).toBeInTheDocument()
  })

  it('options 数组重建（引用变化）后仍回显原选中项', () => {
    const { rerender } = render(
      <SearchSelect options={options} value="b" onChange={() => {}} triggerAriaLabel="组" />,
    )
    rerender(
      <SearchSelect
        options={options.map((o) => ({ ...o }))}
        value="b"
        onChange={() => {}}
        triggerAriaLabel="组"
      />,
    )
    expect(screen.getByRole('combobox', { name: '组' })).toHaveTextContent('乙组')
  })
})
