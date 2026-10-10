import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ImpersonationBanner } from '../ImpersonationBanner'
import type { PKUser } from '../../provider/PloykitProvider'



const mocks = vi.hoisted(() => ({ impersonatedBy: undefined as string | undefined, user: null as PKUser | null }))
vi.mock('../../../../hooks/src/hooks/useAuth', () => ({
  useAuth: () => ({
    user: mocks.user,
    workspaces: [],
    loading: false,
    refresh: vi.fn(),
    logout: vi.fn(async () => {}),
  }),
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
})
