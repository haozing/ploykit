import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { ConfirmProvider } from '../../../components/ConfirmDialog'
import { LegalAndPrivacySection } from '../LegalAndPrivacySection'
import { formatDate } from '../../../lib/utils'

// LC-4 可选区块：ConfirmProvider 必挂（AppProviders 默认已含）；
// 确认弹窗本体是动态 import（ConfirmDialogBody），弹窗断言一律 findBy*。
function renderSection(
  props: ComponentProps<typeof LegalAndPrivacySection> = {},
) {
  return render(
    <ConfirmProvider>
      <LegalAndPrivacySection {...props} />
    </ConfirmProvider>,
  )
}

const RENEWS_AT = '2026-11-25T00:00:00Z'

describe('LegalAndPrivacySection', () => {
  it('零 props 返回 null（可见复杂度为零）', () => {
    const { container } = renderSection()
    expect(container.firstChild).toBeNull()
  })

  it('仅 busy/error（无订阅快照、无导出入口）也返回 null', () => {
    const { container } = renderSection({ busy: true, error: '上次操作失败' })
    expect(container.firstChild).toBeNull()
  })

  it('仅订阅快照：渲染套餐信息，不渲染取消按钮与导出按钮', () => {
    renderSection({ subscription: { plan: 'Pro', renewsAt: RENEWS_AT } })
    expect(screen.getByText('订阅')).toBeInTheDocument()
    expect(
      screen.getByTestId('legal-subscription'),
    ).toHaveTextContent(`Pro · 下次续费 ${formatDate(RENEWS_AT)}`)
    expect(
      screen.queryByRole('button', { name: '取消订阅' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Export my data (JSON)' }),
    ).not.toBeInTheDocument()
  })

  it('仅导出入口：渲染导出按钮并回调，不渲染订阅区', () => {
    const onExportData = vi.fn()
    renderSection({ onExportData })
    fireEvent.click(
      screen.getByRole('button', { name: 'Export my data (JSON)' }),
    )
    expect(onExportData).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('订阅')).not.toBeInTheDocument()
  })

  it('全量 props：两区齐渲染，error 如实透出', () => {
    renderSection({
      subscription: { plan: 'Pro', cancelTiming: 'immediate' },
      onExportData: vi.fn(),
      onCancelSubscription: vi.fn(),
      error: '取消已受理，将在渠道后台人工完成',
    })
    expect(screen.getByText('我的数据')).toBeInTheDocument()
    expect(screen.getByText('订阅')).toBeInTheDocument()
    expect(screen.getByText('取消已受理，将在渠道后台人工完成')).toBeInTheDocument()
  })

  describe('取消确认弹窗按 cancelTiming 三分流', () => {
    it('immediate → "立即取消,权益马上结束"；确认后回调 onCancelSubscription', async () => {
      const onCancelSubscription = vi.fn()
      renderSection({
        subscription: { plan: 'Pro', cancelTiming: 'immediate' },
        onCancelSubscription,
      })
      fireEvent.click(screen.getByRole('button', { name: '取消订阅' }))
      expect(
        await screen.findByText('立即取消,权益马上结束'),
      ).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '确认取消' }))
      await waitFor(() =>
        expect(onCancelSubscription).toHaveBeenCalledTimes(1),
      )
    })

    it('period_end → "取消生效,权益保留至 {renewsAt}"；弹窗内取消不触发回调', async () => {
      const onCancelSubscription = vi.fn()
      renderSection({
        subscription: {
          plan: 'Pro',
          renewsAt: RENEWS_AT,
          cancelTiming: 'period_end',
        },
        onCancelSubscription,
      })
      fireEvent.click(screen.getByRole('button', { name: '取消订阅' }))
      expect(
        await screen.findByText(
          `取消生效,权益保留至 ${formatDate(RENEWS_AT)}`,
        ),
      ).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '取消' }))
      await waitFor(() =>
        expect(
          screen.queryByText(`取消生效,权益保留至 ${formatDate(RENEWS_AT)}`),
        ).not.toBeInTheDocument(),
      )
      expect(onCancelSubscription).not.toHaveBeenCalled()
    })

    it('空/未知时序 → "已受理,我们将完成取消"（绝不假称自助停扣）', async () => {
      renderSection({
        subscription: { plan: 'Pro', cancelTiming: '' },
        onCancelSubscription: vi.fn(),
      })
      fireEvent.click(screen.getByRole('button', { name: '取消订阅' }))
      expect(
        await screen.findByText('已受理,我们将完成取消'),
      ).toBeInTheDocument()
    })
  })

  it('cancelRequestedAt 已存在：按钮转"取消已受理"禁用态，点击无动作', () => {
    const onCancelSubscription = vi.fn()
    renderSection({
      subscription: {
        plan: 'Pro',
        cancelTiming: 'immediate',
        cancelRequestedAt: '2026-10-20T00:00:00Z',
      },
      onCancelSubscription,
    })
    const btn = screen.getByRole('button', { name: '取消已受理' })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onCancelSubscription).not.toHaveBeenCalled()
  })

  it('busy：导出与取消按钮均禁用', () => {
    renderSection({
      subscription: { plan: 'Pro', cancelTiming: 'immediate' },
      onExportData: vi.fn(),
      onCancelSubscription: vi.fn(),
      busy: true,
    })
    expect(
      screen.getByRole('button', { name: 'Export my data (JSON)' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: '取消订阅' }),
    ).toBeDisabled()
  })
})
