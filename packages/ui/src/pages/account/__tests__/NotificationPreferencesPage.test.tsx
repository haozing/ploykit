import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotificationPreferencesPage } from '../NotificationPreferencesPage'

const mocks = vi.hoisted(() => ({
  prefs: [] as Array<Record<string, unknown>>,
  loading: false,
  error: null as Error | null,
  setPref: vi.fn(),
}))
vi.mock('../../../hooks/useNotificationPrefs', () => ({
  useNotificationPrefs: () => ({ prefs: mocks.prefs, loading: mocks.loading, error: mocks.error, refetch: vi.fn() }),
  useSetNotificationPref: () => ({ setPref: mocks.setPref, loading: false, error: null }),
}))

function pref(over: Record<string, unknown> = {}) {
  return {
    notification_type: 'workspace.invited', email_enabled: true, in_app_enabled: true,
    updated_at: '2026-10-01T00:00:00Z', ...over,
  }
}

beforeEach(() => {
  mocks.setPref.mockReset().mockResolvedValue(pref())
  mocks.loading = false
  mocks.error = null
  mocks.prefs = []
  
  document.title = ''
})

describe('NotificationPreferencesPage', () => {
  it('loading 时渲染加载态', () => {
    mocks.loading = true
    render(<NotificationPreferencesPage />)
    expect(screen.getByText('加载中…')).toBeInTheDocument()
  })

  it('error 时渲染错误重试', () => {
    mocks.error = new Error('boom')
    render(<NotificationPreferencesPage />)
    expect(screen.getByText('boom')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('无 types prop 时以 API 行生成清单（值取行内字段）', () => {
    mocks.prefs = [pref({ notification_type: 'workspace.invited', email_enabled: false })]
    render(<NotificationPreferencesPage />)
    expect(screen.getByText('workspace.invited')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '邮件（workspace.invited）' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('switch', { name: '站内（workspace.invited）' })).toHaveAttribute('aria-checked', 'true')
  })

  it('types prop 清单 × 缺行 = 双渠道默认开启', () => {
    mocks.prefs = [pref({ notification_type: 'other.type' })]
    render(
      <NotificationPreferencesPage
        types={[
          { type: 'workspace.invited', label: '工作区邀请', description: '被邀请加入工作区时' },
        ]}
      />,
    )
    expect(screen.getByText('工作区邀请')).toBeInTheDocument()
    expect(screen.getByText('被邀请加入工作区时')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '站内（工作区邀请）' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: '邮件（工作区邀请）' })).toHaveAttribute('aria-checked', 'true')
  })

  it('切换站内开关 → setPref(type, {in_app_enabled:false})', async () => {
    mocks.prefs = [pref()]
    render(<NotificationPreferencesPage />)
    fireEvent.click(screen.getByRole('switch', { name: '站内（workspace.invited）' }))
    await waitFor(() =>
      expect(mocks.setPref).toHaveBeenCalledWith('workspace.invited', { in_app_enabled: false }),
    )
  })

  it('空清单渲染空态', () => {
    render(<NotificationPreferencesPage types={[]} />)
    expect(screen.getByText('暂无可配置的通知类型')).toBeInTheDocument()
  })

  
  it('emailChannelNote 传入时渲染邮件渠道说明行', () => {
    mocks.prefs = [pref()]
    render(
      <NotificationPreferencesPage emailChannelNote="当前环境未接邮件发送（偏好仍会保存）" />,
    )
    expect(
      screen.getByText('邮件渠道：当前环境未接邮件发送（偏好仍会保存）'),
    ).toBeInTheDocument()
  })

  it('emailChannelNote 缺省不渲染说明行（默认假定渠道可用）', () => {
    mocks.prefs = [pref()]
    render(<NotificationPreferencesPage />)
    expect(screen.queryByText(/^邮件渠道：/)).not.toBeInTheDocument()
  })

  
  
  
  
  it('渠道文字是 label：htmlFor 落到内部 checkbox，开关名经 aria-labelledby 关联', () => {
    mocks.prefs = [pref()]
    render(<NotificationPreferencesPage />)
    const inAppSwitch = screen.getByRole('switch', { name: '站内（workspace.invited）' })
    const emailSwitch = screen.getByRole('switch', { name: '邮件（workspace.invited）' })
    const inAppLabel = screen.getByText(/^站内/, { selector: 'label' })
    const emailLabel = screen.getByText(/^邮件/, { selector: 'label' })

    expect(inAppLabel).toHaveAttribute('for')
    expect(emailLabel).toHaveAttribute('for')
    
    const inAppTarget = document.getElementById(inAppLabel.getAttribute('for')!)
    const emailTarget = document.getElementById(emailLabel.getAttribute('for')!)
    expect(inAppTarget).toBeTruthy()
    expect(emailTarget).toBeTruthy()
    expect(inAppTarget).toHaveAttribute('type', 'checkbox')
    expect(emailTarget).toHaveAttribute('type', 'checkbox')
    
    expect(inAppSwitch).toHaveAttribute('aria-labelledby', inAppLabel.id)
    expect(emailSwitch).toHaveAttribute('aria-labelledby', emailLabel.id)
  })

  it('点击"邮件"文字 → 触发对应开关切换（label 关联可达）', async () => {
    mocks.prefs = [pref()]
    render(<NotificationPreferencesPage />)
    fireEvent.click(screen.getByText(/^邮件/, { selector: 'label' }))
    await waitFor(() =>
      expect(mocks.setPref).toHaveBeenCalledWith('workspace.invited', { email_enabled: false }),
    )
  })

  
  it('siteName 传入时挂"通知偏好 · <产品名>"式页题', () => {
    mocks.prefs = [pref()]
    render(<NotificationPreferencesPage siteName="MyProduct" />)
    expect(document.title).toBe('通知偏好 · MyProduct')
  })

  it('siteName 缺省只挂页题；自定义 title prop 同样生效', () => {
    mocks.prefs = [pref()]
    const { rerender } = render(<NotificationPreferencesPage />)
    expect(document.title).toBe('通知偏好')
    rerender(<NotificationPreferencesPage title="通知设置" siteName="MyProduct" />)
    expect(document.title).toBe('通知设置 · MyProduct')
  })
})
