import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { FormField } from '../FormField'
import { useZodForm } from '../../hooks/useZodForm'

const schema = z.object({ email: z.string().email('邮箱格式无效') })
type FormValues = z.infer<typeof schema>

let submitted: string[] = []


function DemoForm() {
  const { register, handleSubmit, formState } = useZodForm<FormValues>({ schema })
  return (
    <form
      onSubmit={handleSubmit((values) => submitted.push(values.email))}
      noValidate
    >
      <FormField label="邮箱" error={formState.errors.email?.message} htmlFor="email">
        <input id="email" {...register('email')} />
      </FormField>
      <button type="submit">提交</button>
    </form>
  )
}

describe('useZodForm + FormField', () => {
  it('空值提交 → formState.errors.email 非空且 FormField 显示错误文案', async () => {
    submitted = []
    render(<DemoForm />)
    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    expect(await screen.findByText('邮箱格式无效')).toBeInTheDocument()
    expect(submitted).toEqual([]) 
  })

  it('合法值提交 → 通过校验、无错误文案、onSubmit 收到值', async () => {
    submitted = []
    render(<DemoForm />)
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'a@b.com' } })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    await waitFor(() => expect(submitted).toEqual(['a@b.com']))
    expect(screen.queryByText('邮箱格式无效')).not.toBeInTheDocument()
  })

  it('FormField 渲染 label 并通过 htmlFor 关联控件', () => {
    render(
      <FormField label="名称" htmlFor="name">
        <input id="name" />
      </FormField>,
    )
    expect(screen.getByLabelText('名称')).toBe(screen.getByRole('textbox'))
  })
})



describe('FormField aria 回连（G7.3 / B5）', () => {
  it('出错时控件 aria-invalid=true 且 aria-describedby 同时指向说明与错误节点', () => {
    render(
      <FormField
        label="昵称" htmlFor="f1" error="请输入昵称" description="对外展示的名称"
      >
        <input id="f1" />
      </FormField>,
    )
    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toBe('f1-desc f1-error')
    
    expect(document.getElementById('f1-desc')).toHaveTextContent('对外展示的名称')
    const alert = document.getElementById('f1-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent('请输入昵称')
  })

  it('无错误时不设置 aria-invalid，aria-describedby 仅指向说明节点', () => {
    render(
      <FormField label="头像链接" htmlFor="f2" description="可选，需 http(s):// 开头">
        <input id="f2" />
      </FormField>,
    )
    const input = screen.getByRole('textbox')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input.getAttribute('aria-describedby')).toBe('f2-desc')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('缺 htmlFor 时：aria-invalid 仍注入（自包含属性），aria-describedby 不注入（id 无锚点）', () => {
    render(
      <FormField label="名称" error="不能为空">
        <input />
      </FormField>,
    )
    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(screen.getByRole('alert')).toHaveTextContent('不能为空')
  })

  it('调用方自带 aria-describedby 时拼接不覆盖', () => {
    render(
      <FormField label="名称" htmlFor="f3" error="不能为空">
        <input id="f3" aria-describedby="custom-hint" />
      </FormField>,
    )
    expect(screen.getByRole('textbox').getAttribute('aria-describedby')).toBe('custom-hint f3-error')
  })

  it('required：label 渲染 aria-hidden 星号（不进可访问名），控件 aria-required=true', () => {
    render(
      <FormField label="昵称" htmlFor="f4" required>
        <input id="f4" />
      </FormField>,
    )
    const star = screen.getByText('*')
    expect(star).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-required', 'true')
    
    expect(screen.getByRole('textbox', { name: '昵称' })).toBeInTheDocument()
  })

  it('children 为字符串等非元素时安全渲染（不注入）', () => {
    render(
      <FormField label="区块" htmlFor="f5" error="不能为空">
        纯文本插槽
      </FormField>,
    )
    expect(screen.getByText('纯文本插槽')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('不能为空')
  })
})
