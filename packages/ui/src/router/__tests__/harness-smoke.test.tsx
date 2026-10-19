import { describe, it, expect } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { RouterTestHarness, useLocation, useNavigate } from '../index'

function Probe() {
  const loc = useLocation()
  return <div>probe-at:{loc.pathname}</div>
}

describe('RouterTestHarness', () => {
  it('mounts children at the initial entry after an act flush', async () => {
    render(
      <RouterTestHarness initialEntries={['/app']}>
        <Probe />
      </RouterTestHarness>,
    )
    await act(async () => {})
    await screen.findByText('probe-at:/app')
  })

  it('useNavigate navigates by path and rerenders children', async () => {
    function Nav() {
      const navigate = useNavigate()
      return <button onClick={() => navigate('/login')}>go</button>
    }
    render(
      <RouterTestHarness initialEntries={['/app']}>
        <Nav />
        <Probe />
      </RouterTestHarness>,
    )
    await act(async () => {})
    await screen.findByText('probe-at:/app')
    fireEvent.click(screen.getByRole('button', { name: 'go' }))
    await waitFor(() => expect(screen.getByText('probe-at:/login')).toBeInTheDocument())
  })

  it('renders at "/" when no initialEntries given', async () => {
    render(
      <RouterTestHarness>
        <Probe />
      </RouterTestHarness>,
    )
    await act(async () => {})
    await screen.findByText('probe-at:/')
  })
})
