import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

// renderx-walk #5: every auth page exposes i18n override props — titles at
// minimum, so overseas products are not stuck with hardcoded copy.
vi.mock('@ploykit/client', () => ({
  api: {
    get: vi.fn(),
    // never-settling promise keeps VerifyEmailPage in its 'verifying' state
    post: vi.fn(() => new Promise(() => {})),
  },
}))
vi.mock('../../../../hooks/src/hooks/usePasswordReset', () => ({
  usePasswordReset: () => ({ reset: vi.fn() }),
}))

import { ResetPasswordPage } from '../ResetPasswordPage'
import { VerifyEmailPage } from '../VerifyEmailPage'
// imports after mocks (mock hoisting applies regardless of position)

describe('auth 页 i18n 覆盖面（走查 #5）', () => {
  it('ResetPasswordPage：title/successHint 可覆盖', () => {
    render(<ResetPasswordPage title="Set a new password" successHint="Password reset; old sessions revoked." />)
    expect(screen.getByText('Set a new password')).toBeInTheDocument()
  })

  it('VerifyEmailPage：三态标题可覆盖（无参渲染即 failed 态）', () => {
    render(<MemoryRouter><VerifyEmailPage titles={{ failed: 'Verification failed' }} /></MemoryRouter>)
    expect(screen.getByText('Verification failed')).toBeInTheDocument()
  })
})
