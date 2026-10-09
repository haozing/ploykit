import { describe, it, expect } from 'vitest'
import { ApiError } from '@ploykit/client'
import { apiErrorMessage } from '../api-error'



describe('apiErrorMessage', () => {
  it('已知英文文案 → 中文可行动文案（email already registered / slug already taken）', () => {
    expect(apiErrorMessage(new ApiError(409, 'E_CONFLICT', 'email already registered')))
      .toBe('该邮箱已注册，可直接登录或换个邮箱重试')
    expect(apiErrorMessage(new ApiError(409, 'E_CONFLICT', 'slug already taken')))
      .toBe('该标识已被占用，请换个工作区名称重试')
    
    expect(apiErrorMessage(new ApiError(409, 'E_CONFLICT', '  Email Already Registered ')))
      .toBe('该邮箱已注册，可直接登录或换个邮箱重试')
  })

  it('E_QUOTA_EXCEEDED 错误码 → 配额用尽 + 升级指引（优先于 message）', () => {
    expect(apiErrorMessage(new ApiError(402, 'E_QUOTA_EXCEEDED', 'quota exceeded for workspaces')))
      .toBe('配额已用尽，可在 设置→计费 升级套餐后重试')
  })

  it('X4：超时/中止/渠道不支持/畸形响应码 → 中文可行动文案', () => {
    expect(apiErrorMessage(new ApiError(0, 'E_TIMEOUT', 'request timed out after 15000ms')))
      .toBe('请求超时，网络可能较慢，请稍后重试')
    expect(apiErrorMessage(new ApiError(0, 'E_ABORTED', 'request aborted by caller')))
      .toBe('请求已取消')
    expect(apiErrorMessage(new ApiError(400, 'E_CHANNEL_TEST_UNSUPPORTED', 'manual channel cannot be tested')))
      .toContain('不支持测试连接')
    expect(apiErrorMessage(new ApiError(502, 'E_MALFORMED_RESPONSE', 'non-JSON response (502)')))
      .toContain('无法识别的响应')
  })

  it('X4/B-settings-2：服务端中文 details 优先于英文 message', () => {
    expect(apiErrorMessage(new ApiError(400, 'E_VALIDATION', 'invalid settings key/value', '必须是 0..100000 的整数（0 = 关闭限流）')))
      .toBe('必须是 0..100000 的整数（0 = 关闭限流）')
    
    expect(apiErrorMessage(new ApiError(409, 'E_CONFLICT', 'email already registered', { field: 'email' })))
      .toBe('该邮箱已注册，可直接登录或换个邮箱重试')
  })

  it('402（无已知码）→ 需要升级（details 并入）；404 → 不存在；403 → 权限不足', () => {
    expect(apiErrorMessage(new ApiError(402, 'E_PLAN_LIMIT', 'seats limit')))
      .toContain('当前套餐不支持此操作')
    expect(apiErrorMessage(new ApiError(402, 'E_PLAN_LIMIT', 'seats limit', '成员数超出当前套餐上限')))
      .toContain('成员数超出当前套餐上限')
    expect(apiErrorMessage(new ApiError(404, 'E_NOT_FOUND', 'workspace not found')))
      .toBe('不存在或无权访问')
    expect(apiErrorMessage(new ApiError(403, 'E_FORBIDDEN', 'forbidden'))).toBe('权限不足')
  })

  it('X4：401/429 给中文兜底（429 带 Retry-After 秒数提示）', () => {
    expect(apiErrorMessage(new ApiError(401, 'E_UNAUTHENTICATED', 'unauthenticated')))
      .toBe('登录已过期或未登录，请重新登录后再试')
    expect(apiErrorMessage(new ApiError(429, 'E_RATE_LIMITED', 'too many requests')))
      .toBe('请求过于频繁，请稍后再试')
    expect(apiErrorMessage(new ApiError(429, 'E_RATE_LIMITED', 'too many requests', undefined, 30)))
      .toBe('请求过于频繁，请稍后再试（约 30 秒后可重试）')
  })

  it('X4/B-users-5：5xx 不再透传英文原文，统一中文兜底', () => {
    expect(apiErrorMessage(new ApiError(500, 'E_INTERNAL', 'internal error')))
      .toBe('服务暂时不可用，请稍后重试；若持续出现请联系平台管理员')
  })

  it('4xx 未知 ApiError 保留原始 message；网络异常给可重试文案；其余走 fallback', () => {
    
    expect(apiErrorMessage(new ApiError(400, 'E_BAD_JSON', 'boom'))).toBe('boom')
    expect(apiErrorMessage(new TypeError('fetch failed'))).toBe('网络连接失败，请检查网络后重试')
    expect(apiErrorMessage({}, '兜底文案')).toBe('兜底文案')
  })

  
  
  describe('G7.4 域映射补齐', () => {
    type Case = { name: string; err: ApiError; expect: string | RegExp }
    const cases: Case[] = [
      {
        name: "E_UNAUTHENTICATED 'current password incorrect' → 改密域文案（压过 401 兜底）",
        err: new ApiError(401, 'E_UNAUTHENTICATED', 'current password incorrect'),
        expect: /当前密码不正确，请确认后重新输入/,
      },
      {
        name: "E_VALIDATION 'name required (<=64 chars)' → 名称约束（字节口径）",
        err: new ApiError(400, 'E_VALIDATION', 'name required (<=64 chars)'),
        expect: /64 字节/,
      },
      {
        name: "E_VALIDATION 'name required' → 精确子类优先于通用兜底",
        err: new ApiError(400, 'E_VALIDATION', 'name required'),
        expect: /名称不能为空$/,
      },
      {
        name: 'E_VALIDATION 未知文案（无 details）→ 通用校验兜底，不再直出英文',
        err: new ApiError(400, 'E_VALIDATION', 'meter display_name required'),
        expect: /请求参数有误/,
      },
      {
        name: "前缀匹配：'slug must be 4-40 chars of [a-z0-9-]…' → 标识约束中文",
        err: new ApiError(400, 'E_VALIDATION', "slug must be 4-40 chars of [a-z0-9-], not starting/ending with '-'"),
        expect: /标识格式有误/,
      },
      {
        name: '前缀匹配：egress 预检拒绝（含 ADR 编号原文）→ 公网 https 指引',
        err: new ApiError(400, 'E_VALIDATION', 'egress: "hook.internal" resolves to a private/reserved address 10.0.0.8 — outbound blocked by the SSRF guard'),
        expect: '回调地址不可达私网/被安全策略拦截，请改用公网 https 地址',
      },
      {
        name: '前缀匹配：egressx: 前缀（引擎配置侧）同文案',
        err: new ApiError(400, 'E_VALIDATION', 'egressx: URL parse failed'),
        expect: '回调地址不可达私网/被安全策略拦截，请改用公网 https 地址',
      },
      {
        name: 'E_INVALID_CRON → cron 中文格式指引',
        err: new ApiError(400, 'E_INVALID_CRON', 'invalid cron expression (expect 5 fields: minute hour day month weekday)'),
        expect: /Cron 表达式格式有误/,
      },
      {
        name: 'E_INVALID_TZ → 时区中文指引',
        err: new ApiError(400, 'E_INVALID_TZ', 'invalid timezone (expect IANA name, e.g. Asia/Shanghai)'),
        expect: /时区无效/,
      },
      {
        name: 'E_CONFLICT 未知冲突（order is not pending）→ 通用冲突兜底',
        err: new ApiError(409, 'E_CONFLICT', 'order is not pending'),
        expect: /操作与当前状态冲突/,
      },
      {
        name: 'E_CONFLICT 已有精确映射（last owner）不被通用兜底吞掉',
        err: new ApiError(409, 'E_CONFLICT', 'last owner cannot leave'),
        expect: '最后一个所有者不能离开工作区，请先转移所有权或删除工作区',
      },
      {
        name: "E_CONFLICT 'target is already an owner'（成员转让）→ 域文案",
        err: new ApiError(409, 'E_CONFLICT', 'target is already an owner'),
        expect: '对方已是所有者，无需重复转让所有权',
      },
      {
        name: "前缀匹配：'workspace cannot be deleted: open orders exist'（删除前置拦截）→ 域文案",
        err: new ApiError(409, 'E_CONFLICT', 'workspace cannot be deleted: open orders exist'),
        expect: '工作区暂时无法删除：存在未满足的前置条件（如未完结订单或活跃资源），请先处理后再试',
      },
    ]

    it.each(cases)('$name', ({ err, expect: expected }) => {
      const got = apiErrorMessage(err)
      if (expected instanceof RegExp) expect(got).toMatch(expected)
      else expect(got).toBe(expected)
    })

    it('优先级回归：消息级 > details > 码级（同一错误三种来源层层兜底）', () => {
      
      expect(apiErrorMessage(new ApiError(400, 'E_VALIDATION', 'bad value', '限流值必须是 0..100000 的整数')))
        .toBe('限流值必须是 0..100000 的整数')
      
      expect(apiErrorMessage(new ApiError(402, 'E_QUOTA_EXCEEDED', 'quota exceeded')))
        .toBe('配额已用尽，可在 设置→计费 升级套餐后重试')
      
      expect(apiErrorMessage(new ApiError(401, 'E_UNAUTHENTICATED', 'session expired')))
        .toBe('登录已过期或未登录，请重新登录后再试')
    })
  })
})
