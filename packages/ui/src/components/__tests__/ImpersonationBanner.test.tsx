import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ImpersonationBanner } from '../ImpersonationBanner'
import type { PKUser } from '../../provider/PloykitProvider'



const mocks = vi.hoisted(() => ({
  impersonatedBy: undefined as string | undefined,
  user: null as PKUser | null,
  noProvider: false,
}))
vi.mock('../../../../hooks/src/hooks/useAuth', () => ({
  useAuth: () => {
    // noProvider 模拟无 PloykitProvider：真实 useAuthCtx 同步抛错。
    if (mocks.noProvider) throw new Error('must be used within PloykitProvider')
    return {
      user: mocks.user,
      workspaces: [],
      loading: false,
      refresh: vi.fn(),
      logout: vi.fn(async () => {}),
    }
  },
}))

function impersonatedUser(impersonatedBy?: string): PKUser {
  return {
    email: 'bob@example.com',
    display_name: 'Bob',
    impersonated_by: impersonatedBy,
  } as PKUser
}

describe('ImpersonationBanner（ADR 0008 模拟会话横幅）', () => {
  beforeEach(() => {
    mocks.impersonatedBy = undefined
    mocks.user = null
    mocks.noProvider = false
  })

  it('模拟会话（impersonated_by 非空）：显示"您正处于管理员模拟会话"警示条', () => {
    mocks.user = impersonatedUser('11111111-2222-3333-4444-555555555555')
    render(<ImpersonationBanner />)
    expect(screen.getByText('您正处于管理员模拟会话')).toBeInTheDocument()
    expect(screen.getByText('您正处于管理员模拟会话')).toBeVisible()
  })

  it('普通会话（无 impersonated_by 字段）：不渲染横幅、不留占位', () => {
    mocks.user = impersonatedUser(undefined)
    const { container } = render(<ImpersonationBanner />)
    expect(screen.queryByText('您正处于管理员模拟会话')).not.toBeInTheDocument()
    expect(container.querySelector('[data-slot="impersonation-banner"]')).not.toBeInTheDocument()
  })

  it('未登录（user=null）：不渲染横幅', () => {
    mocks.user = null
    render(<ImpersonationBanner />)
    expect(screen.queryByText('您正处于管理员模拟会话')).not.toBeInTheDocument()
  })

  it('横幅不提供退出按钮：退出由发起管理员控制（ADR 0008 裁决）', () => {
    mocks.user = impersonatedUser('11111111-2222-3333-4444-555555555555')
    render(<ImpersonationBanner />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('无 Provider（useAuth 抛错）：渲染空，不抛错（AppShell 不强制 Provider）', () => {
    mocks.noProvider = true
    const { container } = render(<ImpersonationBanner />)
    expect(container.querySelector('[data-slot="impersonation-banner"]')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('label 覆盖：自定义文案替换默认中文', () => {
    mocks.user = impersonatedUser('11111111-2222-3333-4444-555555555555')
    render(<ImpersonationBanner label="Admin impersonation session" />)
    expect(screen.getByText('Admin impersonation session')).toBeVisible()
    expect(screen.queryByText('您正处于管理员模拟会话')).not.toBeInTheDocument()
  })
})
