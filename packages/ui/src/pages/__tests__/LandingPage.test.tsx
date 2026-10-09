
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, it, expect } from 'vitest'
import { LandingPage } from '../LandingPage'

const FEATURES = [
  { icon: '⚡', title: '快速', desc: '秒级启动' },
  { icon: '🔒', title: '安全', desc: '企业级权限' },
  { icon: '🧩', title: '快速', desc: '重名标题回归（P3-31）' },
]
const PLANS = [
  { name: 'Free', price: '¥0', features: ['基础功能', '基础功能'], cta: '免费开始' },
  { name: 'Free', price: '¥99', recommended: true, features: ['全部功能'], cta: '升级' },
]

function renderPage() {
  return render(
    <MemoryRouter>
      <LandingPage
        brand="Ploykit"
        tagline="多租户 SaaS 脚手架"
        description="开箱即用的框架"
        features={FEATURES}
        plans={PLANS}
        registerPath="/register"
        loginPath="/login"
      />
    </MemoryRouter>,
  )
}

describe('LandingPage', () => {
  it('渲染品牌/标语/功能/定价', () => {
    renderPage()
    expect(screen.getByText('Ploykit')).toBeInTheDocument()
    expect(screen.getByText('多租户 SaaS 脚手架')).toBeInTheDocument()
    expect(screen.getAllByText('快速').length).toBe(2) 
  })

  it('登录/注册 CTA 指向可配路径', () => {
    renderPage()
    expect(screen.getByRole('link', { name: '登录' })).toHaveAttribute(
      'href',
      '/login',
    )
    const register = screen.getAllByRole('link', { name: /免费注册|免费开始/ })
    for (const link of register) {
      expect(link).toHaveAttribute('href', '/register')
    }
  })

  it('推荐档位带"推荐"标记', () => {
    renderPage()
    expect(screen.getByText('推荐')).toBeInTheDocument()
  })
})
