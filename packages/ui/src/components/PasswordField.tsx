
import { useState, type ComponentProps } from 'react'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from './ui/input-group'

// 密码可见性切换（Input Group 官方配方）：InputGroup 包裹输入框，addon 内放
// Eye/EyeOff 图标按钮，点击在 type="password"|"text" 间切换。每处 <PasswordField>
// 都是独立实例，多个密码框的可见状态互不影响。FormField 经 cloneElement 注入到
// 直接子元素的 aria-describedby / aria-invalid / aria-required，连同 id、autoComplete
// （以及 form.register 返回的 name/onChange/onBlur/ref）一起经 ...props 落到
// InputGroupInput 上——label htmlFor=id 关联不因包裹层而断。
export function PasswordField(props: ComponentProps<'input'>) {
  const [visible, setVisible] = useState(false)
  return (
    <InputGroup>
      <InputGroupInput type={visible ? 'text' : 'password'} {...props} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          variant="ghost"
          aria-label={visible ? '隐藏密码' : '显示密码'}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
