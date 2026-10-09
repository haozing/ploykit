import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import {
  Field, FieldLabel, FieldDescription, FieldError, FieldSeparator, FieldGroup,
} from '../field'

describe('field 体系冒烟', () => {
  it('Field(role=group) + FieldLabel(htmlFor) 关联控件', () => {
    render(
      <Field>
        <FieldLabel htmlFor="name">名称</FieldLabel>
        <input id="name" />
      </Field>,
    )
    expect(screen.getByRole('group')).toBeInTheDocument()
    expect(screen.getByLabelText('名称')).toBe(screen.getByRole('textbox'))
  })

  it('FieldError 渲染 errors 去重后的 message，并保持 role=alert', () => {
    render(
      <FieldError
        errors={[{ message: '必填' }, { message: '必填' }, { message: '邮箱格式无效' }]}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('必填')
    expect(alert).toHaveTextContent('邮箱格式无效')
  })

  it('无内容时 FieldError 不渲染；FieldDescription/FieldSeparator 正常出文案', () => {
    render(
      <FieldGroup>
        <FieldError errors={[]} />
        <FieldDescription>辅助说明文字</FieldDescription>
        <FieldSeparator>Or continue with</FieldSeparator>
      </FieldGroup>,
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('辅助说明文字')).toBeInTheDocument()
    expect(screen.getByText('Or continue with')).toBeInTheDocument()
  })
})
