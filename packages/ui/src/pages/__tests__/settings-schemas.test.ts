import { describe, expect, it } from 'vitest'
import { profileSchema } from '../account/ProfileSettingsPage'
import { changePwSchema } from '../account/SecuritySettingsPage'
import {
  inviteSchema,
  shareLinkSchema,
} from '../workspace/MembersPage'
import { renameSchema } from '../workspace/WorkspaceGeneralPage'
import { createSchema as scheduleSchema } from '../workspace/SchedulesPage'
import { createSchema as webhookSchema } from '../workspace/WebhooksPage'

/**
 * 设置区各表单 schema 的规则锁定（zod → zod/mini 迁移的回归网）。
 *
 * 导入的是**页面里真实的 schema**，不是规则副本。动机：迁移把
 * `.min()/.max()/.int()/.trim()/.regex()` 链改写成 `.check(z.xxx())`；
 * 这类改写最危险的失败模式是静默丢规则——链式漏一个方法不报错，`.check()`
 * 里少传一个检查器也不报错，只表现为"用户提交了非法值"。
 *
 * 每条都成对写：合法通过 + 非法给出用户看到的文案。
 */

const messageOf = (r: { success: boolean; error?: { issues: Array<{ message: string; path: PropertyKey[] }> } }) =>
  r.success ? null : r.error!.issues[0]?.message

describe('工作区改名 renameSchema', () => {
  it('trim 后非空、最长 64，错误文案逐条对齐', () => {
    const ok = renameSchema.safeParse({ name: '  团队  ' })
    expect(ok.success).toBe(true)
    expect((ok as { data: { name: string } }).data.name).toBe('团队')

    expect(messageOf(renameSchema.safeParse({ name: '   ' }))).toBe('Enter a workspace name')
    expect(messageOf(renameSchema.safeParse({ name: 'x'.repeat(65) }))).toBe('Name can be at most 64 characters')
  })
})

// i18n（B 方案）：各组 schema 文案经字典取文案（error 函数在 safeParse 时求值），
// 无 Provider 的纯函数测试恒为默认 en；rename/webhook（g6）与 invite/shareLink/
// schedule 断言已对齐 en，profile/changePw 断言由账户分区任务对齐。
describe('邀请成员 inviteSchema / shareLinkSchema', () => {
  it('邮箱必填 + 格式、角色枚举', () => {
    expect(inviteSchema.safeParse({ email: 'a@b.co', role: 'admin' }).success).toBe(true)
    expect(messageOf(inviteSchema.safeParse({ email: '', role: 'admin' }))).toBe('Enter an email address')
    expect(messageOf(inviteSchema.safeParse({ email: 'nope', role: 'admin' }))).toBe('Invalid email address')
    expect(inviteSchema.safeParse({ email: 'a@b.co', role: 'owner' }).success).toBe(false)
  })

  it('加入码：整数边界 1..10000 与 1..720', () => {
    const mk = (max_uses: number, ttl_hours: number) => ({ role: 'member', max_uses, ttl_hours })
    expect(shareLinkSchema.safeParse(mk(1, 720)).success).toBe(true)
    expect(shareLinkSchema.safeParse(mk(10000, 1)).success).toBe(true)
    expect(messageOf(shareLinkSchema.safeParse(mk(0, 1)))).toBe('Must be at least 1')
    expect(shareLinkSchema.safeParse(mk(10001, 1)).success).toBe(false)
    expect(shareLinkSchema.safeParse(mk(1, 721)).success).toBe(false)
    expect(messageOf(shareLinkSchema.safeParse(mk(1.5, 1)))).toBe('Must be an integer')
  })
})

describe('调度 createSchema', () => {
  const base = {
    kind: 'task.cleanup',
    cron_expr: '0 3 * * *',
    timezone: 'Asia/Shanghai',
    misfire: 'skip' as const,
  }

  it('五字段 cron 通过，四字段被拒（最常见的输入错误）', () => {
    expect(scheduleSchema.safeParse(base).success).toBe(true)
    expect(messageOf(scheduleSchema.safeParse({ ...base, cron_expr: '0 3 * *' }))).toBe(
      'Expression must have five fields: minute hour day month weekday',
    )
  })

  it('kind trim 后必填、时区必填、misfire 枚举', () => {
    expect(scheduleSchema.safeParse({ ...base, kind: '  lead.check  ' }).success).toBe(true)
    expect(messageOf(scheduleSchema.safeParse({ ...base, kind: '   ' }))).toBe(
      'Enter a trigger key (kind), e.g. task.cleanup',
    )
    expect(scheduleSchema.safeParse({ ...base, timezone: '' }).success).toBe(false)
    expect(scheduleSchema.safeParse({ ...base, misfire: 'retry' }).success).toBe(false)
  })
})

describe('Webhook createSchema', () => {
  it('URL 合法且必须 https、至少一个事件', () => {
    expect(
      webhookSchema.safeParse({ url: 'https://a.example.com/h', description: '', events: ['x'] }).success,
    ).toBe(true)
    expect(
      messageOf(webhookSchema.safeParse({ url: 'http://a.example.com/h', description: '', events: ['x'] })),
    ).toBe('The callback URL must use https (plain http is rejected by the server)')
    expect(
      messageOf(webhookSchema.safeParse({ url: 'https://a.example.com/h', description: '', events: [] })),
    ).toBe('Subscribe to at least one event type')
  })
})

describe('个人资料 profileSchema', () => {
  it('昵称 trim 必填、头像链接可选但需 http(s)', () => {
    const ok = profileSchema.safeParse({ display_name: ' 小明 ', avatar_url: '' })
    expect(ok.success).toBe(true)
    expect((ok as { data: { display_name: string } }).data.display_name).toBe('小明')
    expect(profileSchema.safeParse({ display_name: '小明', avatar_url: 'https://a.example.com/x.png' }).success).toBe(true)
    expect(messageOf(profileSchema.safeParse({ display_name: '小明', avatar_url: 'ftp://a/x.png' }))).toBe(
      'Avatar URL must start with http(s)://',
    )
    expect(messageOf(profileSchema.safeParse({ display_name: '  ', avatar_url: '' }))).toBe('Enter a display name')
  })
})

describe('改密 changePwSchema（B4 跨字段拦截）', () => {
  it('new==old 命中 new_password 字段，old 为空时不叠加误导性报错', () => {
    const same = changePwSchema.safeParse({ old_password: 'Abcdef12345!', new_password: 'Abcdef12345!' })
    expect(same.success).toBe(false)
    const issue = (same as { error: { issues: Array<{ message: string; path: PropertyKey[] }> } }).error.issues[0]
    expect(issue?.path).toEqual(['new_password'])
    expect(issue?.message).toBe('New password cannot be the same as the current password')

    const noOld = changePwSchema.safeParse({ old_password: '', new_password: 'Abcdef12345!' })
    expect(noOld.success).toBe(false)
    const paths = (noOld as { error: { issues: Array<{ path: PropertyKey[] }> } }).error.issues
      .map((i) => i.path.join('.'))
      .join(',')
    expect(paths).toBe('old_password')
  })

  it('复用注册页 passwordSchema：弱密码仍按同一文案拒绝', () => {
    expect(messageOf(changePwSchema.safeParse({ old_password: 'x', new_password: 'abcdefghij' }))).toBe(
      'Must include at least three of: uppercase, lowercase, numbers, symbols',
    )
  })
})
