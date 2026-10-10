import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SiteBannerLayer } from '../SiteBannerLayer'


const mocked = vi.hoisted(() => ({ data: undefined as Record<string, string> | undefined }))
vi.mock('../../../../hooks/src/hooks/useSiteConfig', () => ({
  useSiteConfig: () => ({ data: mocked.data }),
}))

describe('SiteBannerLayer', () => {
  it('无数据（/config 拉取失败/未返回）整层不渲染', () => {
    mocked.data = undefined
    const { container } = render(<SiteBannerLayer />)
    expect(container.firstChild).toBeNull()
  })

  it('维护模式开 → warn 条 + 公告条（kind 跟随 banner_kind）', () => {
    mocked.data = {
      maintenance_mode: '1',
      banner_text: '今晚 22:00 例行维护',
      banner_kind: 'info',
    }
    render(<SiteBannerLayer />)
    expect(screen.getByText(/维护中：系统维护中/)).toBeInTheDocument()
    expect(screen.getByText('今晚 22:00 例行维护')).toBeInTheDocument()
  })

  it('公告为空 → 只渲染维护条；maintenanceText 可换文案', () => {
    mocked.data = { maintenance_mode: '1', banner_text: '', banner_kind: 'info' }
    render(<SiteBannerLayer maintenanceText="MyProduct 维护窗口中" />)
    expect(screen.getByText('MyProduct 维护窗口中')).toBeInTheDocument()
    
    expect(screen.queryAllByRole('status')).toHaveLength(1)
  })

  it('维护关 + 公告 warn → 单公告条，无维护条', () => {
    mocked.data = { maintenance_mode: '0', banner_text: '紧急公告', banner_kind: 'warn' }
    render(<SiteBannerLayer />)
    expect(screen.getByText('紧急公告')).toBeInTheDocument()
    expect(screen.queryByText(/维护中/)).not.toBeInTheDocument()
  })
})
