import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { Slider } from '../slider'

function Demo({ onChange }: { onChange?: (v: number) => void }) {
  const [value, setValue] = useState(50)
  return (
    <Slider
      value={value}
      onValueChange={(v) => {
        setValue(v)
        onChange?.(v)
      }}
      min={0}
      max={100}
      step={10}
    />
  )
}

describe('slider 冒烟', () => {
  it('受控渲染：thumb 的隐藏 input 反映 value/min/max/step', () => {
    const { container } = render(<Demo />)
    const input = screen.getByRole('slider') as HTMLInputElement
    expect(input).toHaveAttribute('type', 'range')
    expect(input).toHaveValue('50')
    expect(input).toHaveAttribute('min', '0')
    expect(input).toHaveAttribute('max', '100')
    expect(input).toHaveAttribute('step', '10')
    expect(container.querySelector('[data-slot="slider"]')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-slot="slider-thumb"]')).toHaveLength(1)
  })

  it('disabled：根元素带 data-disabled，input 禁用', () => {
    const { container } = render(<Slider defaultValue={30} disabled />)
    const input = screen.getByRole('slider') as HTMLInputElement
    expect(input).toBeDisabled()
    expect(container.querySelector('[data-slot="slider"]')).toHaveAttribute('data-disabled')
  })

  it('键盘 step 交互：hidden range input 上 ArrowUp 触发 onValueChange（步进 +step）', () => {
    const onChange = vi.fn()
    render(<Demo onChange={onChange} />)
    const input = screen.getByRole('slider') as HTMLInputElement

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledTimes(1)
    const calls = onChange.mock.calls as unknown as number[][]
    if (calls.length > 0) {
      expect(calls[0][0]).toBe(60)
      expect(input).toHaveValue('60')
    }
  })

  it('range 模式：数组 value 渲染两个 thumb / 两个 slider input', () => {
    render(<Slider defaultValue={[20, 80]} />)
    const inputs = screen.getAllByRole('slider') as HTMLInputElement[]
    expect(inputs).toHaveLength(2)
    expect(inputs[0]).toHaveValue('20')
    expect(inputs[1]).toHaveValue('80')
  })

  it('thumbAriaLabel：role="slider" 的隐藏 input 拿到可访问名', () => {
    render(<Slider defaultValue={40} thumbAriaLabel="BGM 音量" />)
    const input = screen.getByRole('slider', { name: 'BGM 音量' }) as HTMLInputElement
    expect(input).toHaveAttribute('type', 'range')
    expect(input).toHaveAccessibleName('BGM 音量')
  })

  it('thumbAriaLabel 多 thumb：每个 input 的名字带序号（互不重名）', () => {
    render(<Slider defaultValue={[20, 80]} thumbAriaLabel="裁剪" />)
    expect(screen.getByRole('slider', { name: '裁剪 1' })).toHaveValue('20')
    expect(screen.getByRole('slider', { name: '裁剪 2' })).toHaveValue('80')
  })
})
