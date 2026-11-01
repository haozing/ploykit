import * as z from 'zod/mini'
import { t } from '../i18n'

/**
 * 密码强度规则的唯一真源。
 *
 * 为什么独立成模块而不是留在 RegisterPage 里：这条 schema 有三个消费者
 * （注册页、重置密码页、账号安全页改密），其中账号安全页属于**设置区**、
 * 与注册页毫无页面级关系。从 RegisterPage 导入 schema 会把整个注册页组件
 * （表单、AuthShell、按钮栈）连带拖进设置区的 chunk——为一个纯校验规则付
 * 一整个页面的体积。抽出来以后，三个消费者共享的只有这条规则本身。
 *
 * 规则与服务端 password.go 对齐：至少 10 位、按字节计不超过 128、大写/
 * 小写/数字/符号至少占三类。
 *
 * 校验消息走 i18n（g8 分片 lib.password.*）：error 传函数（zod error map）
 * 而非字符串——消息在 safeParse 时才求值，随模块级 t() 的当前语言变化
 * （默认 en；zh 产品挂 UiLangProvider 后无需重建 schema）。
 */

export function passwordKinds(pw: string): number {
  let kinds = 0
  if (/[0-9]/.test(pw)) kinds++
  if (/[a-z]/.test(pw)) kinds++
  if (/[A-Z]/.test(pw)) kinds++
  if (/[^0-9a-zA-Z]/.test(pw)) kinds++
  return kinds
}

export const passwordSchema = z.string().check(
  z.minLength(10, { error: () => t('lib.password.min') }),
  z.refine(
    (pw) => new TextEncoder().encode(pw).length <= 128,
    { error: () => t('lib.password.maxBytes') },
  ),
  z.refine(
    (pw) => passwordKinds(pw) >= 3,
    { error: () => t('lib.password.kinds') },
  ),
)
