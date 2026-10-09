
import { ApiError } from '@ploykit/client'


const KNOWN_MESSAGES: Record<string, string> = {
  'invalid credentials': '邮箱或密码不正确，请检查后重试',
  
  
  'current password incorrect': '当前密码不正确，请确认后重新输入',
  '当前密码不正确，请确认后重新输入': '当前密码不正确，请确认后重新输入',
  '新密码不能与当前密码相同': '新密码不能与当前密码相同，请换一个新密码',
  'email already registered': '该邮箱已注册，可直接登录或换个邮箱重试',
  'slug already taken': '该标识已被占用，请换个工作区名称重试',
  'already a member': '该用户已是本工作区成员，无需重复邀请',
  'invitation already pending': '该邮箱已有一封待处理的邀请，可先撤销旧邀请再重发',
  'target is already an owner': '对方已是所有者，无需重复转让所有权',
  
  'name required (<=64 chars)': '名称不能为空，且不超过 64 字节（约 21 个汉字）',
  'name required': '名称不能为空',
}


const KNOWN_MESSAGE_PREFIXES: Array<[prefix: string, text: string]> = [
  
  ['slug must be', '标识格式有误：需 4-40 位小写字母、数字或连字符（-），且不能以连字符开头或结尾'],
  
  
  ['last owner cannot leave', '最后一个所有者不能离开工作区，请先转移所有权或删除工作区'],
  
  ['avatar_url must be', '头像链接格式有误：需以 http(s) 开头且不超过 2048 字符'],
  
  ['workspace cannot be deleted', '工作区暂时无法删除：存在未满足的前置条件（如未完结订单或活跃资源），请先处理后再试'],
  
  ['egress:', '回调地址不可达私网/被安全策略拦截，请改用公网 https 地址'],
  ['egressx:', '回调地址不可达私网/被安全策略拦截，请改用公网 https 地址'],
]


const KNOWN_CODES: Record<string, string> = {
  E_QUOTA_EXCEEDED: '配额已用尽，可在 设置→计费 升级套餐后重试',
  E_TIMEOUT: '请求超时，网络可能较慢，请稍后重试',
  E_ABORTED: '请求已取消',
  
  E_CHANNEL_TEST_UNSUPPORTED: '该支付渠道不支持测试连接（manual 渠道无外部端点可探测）',
  
  E_MALFORMED_RESPONSE: '服务返回了无法识别的响应，请稍后重试；若持续出现请联系平台管理员',
  
  E_VALIDATION: '请求参数有误，请检查填写内容后重试',
  
  E_INVALID_CRON: 'Cron 表达式格式有误（应为 5 段：分 时 日 月 周），请检查后重试',
  E_INVALID_TZ: '时区无效，请填写 IANA 时区名（如 Asia/Shanghai）',
  
  
  E_CONFLICT: '操作与当前状态冲突，请刷新页面查看最新状态后再试',
}


function detailsText(details: unknown): string | undefined {
  return typeof details === 'string' && details.trim() !== '' ? details.trim() : undefined
}

function knownMessage(message: string): string | undefined {
  const normalized = message.trim().toLowerCase()
  const exact = KNOWN_MESSAGES[normalized]
  if (exact) return exact
  return KNOWN_MESSAGE_PREFIXES.find(([prefix]) => normalized.startsWith(prefix))?.[1]
}

export function apiErrorMessage(err: unknown, fallback = '操作失败'): string {
  if (err instanceof ApiError) {
    
    const byMessage = knownMessage(err.message)
    if (byMessage) return byMessage
    
    
    const details = detailsText(err.details)
    if (details) return details
    
    
    if (err.code && KNOWN_CODES[err.code]) return KNOWN_CODES[err.code]
    if (err.status === 402) {
      return '当前套餐不支持此操作。可在 设置→计费 升级套餐'
    }
    if (err.status === 401) return '登录已过期或未登录，请重新登录后再试'
    if (err.status === 429) {
      
      const wait = err.retryAfter !== undefined && err.retryAfter > 0 ? `（约 ${err.retryAfter} 秒后可重试）` : ''
      return `请求过于频繁，请稍后再试${wait}`
    }
    if (err.status >= 500) return '服务暂时不可用，请稍后重试；若持续出现请联系平台管理员'
    if (err.status === 404) return '不存在或无权访问'
    if (err.status === 403) return '权限不足' + (err.message && err.message !== 'forbidden' ? `：${err.message}` : '')
    return err.message || fallback
  }
  
  if (err instanceof TypeError) return '网络连接失败，请检查网络后重试'
  return err instanceof Error && err.message ? err.message : fallback
}
