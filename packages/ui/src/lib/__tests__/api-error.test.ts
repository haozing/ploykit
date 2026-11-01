import { describe, it, expect, afterEach } from 'vitest'
import { ApiError } from '@ploykit/client'
import { apiErrorMessage } from '../api-error'
import { setUiLang } from '../../i18n'



describe('apiErrorMessage', () => {
  afterEach(() => setUiLang('en'))

  it('已知英文文案 → 可行动文案（email already registered / slug already taken）', () => {
    expect(apiErrorMessage(new ApiError(409, 'E_CONFLICT', 'email already registered')))
      .toBe('This email is already registered. Sign in directly or try another email')
    expect(apiErrorMessage(new ApiError(409, 'E_CONFLICT', 'slug already taken')))
      .toBe('This slug is already taken. Try another workspace name')

    expect(apiErrorMessage(new ApiError(409, 'E_CONFLICT', '  Email Already Registered ')))
      .toBe('This email is already registered. Sign in directly or try another email')
  })

  it('E_QUOTA_EXCEEDED 错误码 → 配额用尽 + 升级指引（优先于 message）', () => {
    expect(apiErrorMessage(new ApiError(402, 'E_QUOTA_EXCEEDED', 'quota exceeded for workspaces')))
      .toBe('Quota exhausted. Upgrade your plan in Settings → Billing, then retry')
  })

  it('X4：超时/中止/渠道不支持/畸形响应码 → 可行动文案', () => {
    expect(apiErrorMessage(new ApiError(0, 'E_TIMEOUT', 'request timed out after 15000ms')))
      .toBe('Request timed out; the network may be slow. Please retry later')
    expect(apiErrorMessage(new ApiError(0, 'E_ABORTED', 'request aborted by caller')))
      .toBe('Request canceled')
    expect(apiErrorMessage(new ApiError(400, 'E_CHANNEL_TEST_UNSUPPORTED', 'manual channel cannot be tested')))
      .toContain('does not support test connections')
    expect(apiErrorMessage(new ApiError(502, 'E_MALFORMED_RESPONSE', 'non-JSON response (502)')))
      .toContain('unrecognized response')
  })

  it('E_NETWORK（传输层失败包装，服务趴了）→ 网络文案，不裸显英文 Failed to fetch', () => {
    expect(apiErrorMessage(new ApiError(0, 'E_NETWORK', 'network request failed: Failed to fetch')))
      .toBe('Network connection failed. Check your network and try again')
  })

  it('E_TURNSTILE（人机验证 400）→ 重新验证指引，不透传英文原文', () => {
    expect(apiErrorMessage(new ApiError(400, 'E_TURNSTILE', 'turnstile verification failed')))
      .toBe('Human verification failed. Complete the verification again')
  })

  it('X4/B-settings-2：服务端中文 details 优先于英文 message', () => {
    expect(apiErrorMessage(new ApiError(400, 'E_VALIDATION', 'invalid settings key/value', '必须是 0..100000 的整数（0 = 关闭限流）')))
      .toBe('必须是 0..100000 的整数（0 = 关闭限流）')

    expect(apiErrorMessage(new ApiError(409, 'E_CONFLICT', 'email already registered', { field: 'email' })))
      .toBe('This email is already registered. Sign in directly or try another email')
  })

  it('402（无已知码）→ 需要升级（details 并入）；404 → 不存在；403 → 权限不足', () => {
    expect(apiErrorMessage(new ApiError(402, 'E_PLAN_LIMIT', 'seats limit')))
      .toContain('does not support this action')
    expect(apiErrorMessage(new ApiError(402, 'E_PLAN_LIMIT', 'seats limit', '成员数超出当前套餐上限')))
      .toContain('成员数超出当前套餐上限')
    expect(apiErrorMessage(new ApiError(404, 'E_NOT_FOUND', 'workspace not found')))
      .toBe('Not found or no access')
    expect(apiErrorMessage(new ApiError(403, 'E_FORBIDDEN', 'forbidden'))).toBe('Insufficient permissions')
  })

  it('X4：401/429 给兜底（429 带 Retry-After 秒数提示）', () => {
    expect(apiErrorMessage(new ApiError(401, 'E_UNAUTHENTICATED', 'unauthenticated')))
      .toBe('Your session expired or you are not signed in. Please sign in again')
    expect(apiErrorMessage(new ApiError(429, 'E_RATE_LIMITED', 'too many requests')))
      .toBe('Too many requests. Please try again later')
    expect(apiErrorMessage(new ApiError(429, 'E_RATE_LIMITED', 'too many requests', undefined, 30)))
      .toBe('Too many requests. Please try again later (retryable in about 30s)')
  })

  it('X4/B-users-5：5xx 不再透传英文原文，统一兜底', () => {
    expect(apiErrorMessage(new ApiError(500, 'E_INTERNAL', 'internal error')))
      .toBe('The service is temporarily unavailable. Please retry later; if it persists, contact the platform administrator')
  })

  it('4xx 未知 ApiError 保留原始 message；网络异常给可重试文案；其余走 fallback', () => {

    expect(apiErrorMessage(new ApiError(400, 'E_BAD_JSON', 'boom'))).toBe('boom')
    expect(apiErrorMessage(new TypeError('fetch failed'))).toBe('Network connection failed. Check your network and try again')
    expect(apiErrorMessage({}, 'fallback text')).toBe('fallback text')
    expect(apiErrorMessage({})).toBe('Operation failed')
  })

  it('B 方案 i18n：默认 en；setUiLang("zh") 后同一错误返回中文（模块级 t() 生效）', () => {
    const err = new ApiError(402, 'E_QUOTA_EXCEEDED', 'quota exceeded')
    expect(apiErrorMessage(err)).toBe('Quota exhausted. Upgrade your plan in Settings → Billing, then retry')
    setUiLang('zh')
    expect(apiErrorMessage(err)).toBe('配额已用尽，可在 设置→计费 升级套餐后重试')
    expect(apiErrorMessage(new ApiError(403, 'E_FORBIDDEN', 'no admin perm')))
      .toBe('权限不足：no admin perm')
    expect(apiErrorMessage({})).toBe('操作失败')
  })


  describe('G7.4 域映射补齐', () => {
    type Case = { name: string; err: ApiError; expect: string | RegExp }
    const cases: Case[] = [
      {
        name: "E_UNAUTHENTICATED 'current password incorrect' → 改密域文案（压过 401 兜底）",
        err: new ApiError(401, 'E_UNAUTHENTICATED', 'current password incorrect'),
        expect: /Current password is incorrect/,
      },
      {
        name: "E_VALIDATION 'name required (<=64 chars)' → 名称约束（字节口径）",
        err: new ApiError(400, 'E_VALIDATION', 'name required (<=64 chars)'),
        expect: /64 bytes/,
      },
      {
        name: "E_VALIDATION 'name required' → 精确子类优先于通用兜底",
        err: new ApiError(400, 'E_VALIDATION', 'name required'),
        expect: /Name is required$/,
      },
      {
        name: 'E_VALIDATION 未知文案（无 details）→ 通用校验兜底，不再直出英文',
        err: new ApiError(400, 'E_VALIDATION', 'meter display_name required'),
        expect: /Invalid request parameters/,
      },
      {
        name: "前缀匹配：'slug must be 4-40 chars of [a-z0-9-]…' → 标识约束",
        err: new ApiError(400, 'E_VALIDATION', "slug must be 4-40 chars of [a-z0-9-], not starting/ending with '-'"),
        expect: /Invalid slug/,
      },
      {
        name: '前缀匹配：egress 预检拒绝（含 ADR 编号原文）→ 公网 https 指引',
        err: new ApiError(400, 'E_VALIDATION', 'egress: "hook.internal" resolves to a private/reserved address 10.0.0.8 — outbound blocked by the SSRF guard'),
        expect: 'The callback URL points to a private or policy-blocked address. Use a public https URL instead',
      },
      {
        name: '前缀匹配：egressx: 前缀（引擎配置侧）同文案',
        err: new ApiError(400, 'E_VALIDATION', 'egressx: URL parse failed'),
        expect: 'The callback URL points to a private or policy-blocked address. Use a public https URL instead',
      },
      {
        name: 'E_INVALID_CRON → cron 格式指引',
        err: new ApiError(400, 'E_INVALID_CRON', 'invalid cron expression (expect 5 fields: minute hour day month weekday)'),
        expect: /Invalid cron expression/,
      },
      {
        name: 'E_INVALID_TZ → 时区指引',
        err: new ApiError(400, 'E_INVALID_TZ', 'invalid timezone (expect IANA name, e.g. Asia/Shanghai)'),
        expect: /Invalid timezone/,
      },
      {
        name: 'E_CONFLICT 未知冲突（order is not pending）→ 通用冲突兜底',
        err: new ApiError(409, 'E_CONFLICT', 'order is not pending'),
        expect: /conflicts with the current state/,
      },
      {
        name: 'E_CONFLICT 已有精确映射（last owner）不被通用兜底吞掉',
        err: new ApiError(409, 'E_CONFLICT', 'last owner cannot leave'),
        expect: 'The last owner cannot leave the workspace. Transfer ownership or delete the workspace first',
      },
      {
        name: "E_CONFLICT 'target is already an owner'（成员转让）→ 域文案",
        err: new ApiError(409, 'E_CONFLICT', 'target is already an owner'),
        expect: 'This user is already an owner. No need to transfer ownership again',
      },
      {
        name: "前缀匹配：'workspace cannot be deleted: open orders exist'（删除前置拦截）→ 域文案",
        err: new ApiError(409, 'E_CONFLICT', 'workspace cannot be deleted: open orders exist'),
        expect: 'The workspace cannot be deleted yet: preconditions are unmet (e.g. open orders or active resources). Resolve them first and retry',
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
        .toBe('Quota exhausted. Upgrade your plan in Settings → Billing, then retry')

      expect(apiErrorMessage(new ApiError(401, 'E_UNAUTHENTICATED', 'session expired')))
        .toBe('Your session expired or you are not signed in. Please sign in again')
    })
  })
})
