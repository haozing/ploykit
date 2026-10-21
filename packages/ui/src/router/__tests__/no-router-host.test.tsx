/**
 * Non-TanStack host contract for the router adapter.
 *
 * `@ploykit/ui` is consumed by products that run react-router or no router at
 * all (risk-engine 2026-10-21 field report). `useLocation()` used to call
 * TanStack's hook unconditionally and threw
 * `Cannot read properties of null (reading 'isServer')` outside a
 * `RouterProvider`, taking down the whole LoginPage. These tests pin the
 * fallback: outside a router it must return a react-router-shaped location
 * derived from `window.*`, never throw.
 */
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useLocation } from '../index'

function Probe() {
  const loc = useLocation()
  return (
    <div>
      <span data-testid="pathname">{loc.pathname}</span>
      <span data-testid="search">{loc.search}</span>
      <span data-testid="hash">{loc.hash}</span>
      <span data-testid="state">{JSON.stringify(loc.state)}</span>
    </div>
  )
}

const originalUrl = window.location.href

afterEach(() => {
  window.history.replaceState(null, '', originalUrl)
})

describe('useLocation outside a TanStack RouterProvider', () => {
  it('renders without throwing and reports the browser path', () => {
    window.history.replaceState(null, '', '/login?next=%2Fstrategies#section')
    render(<Probe />)
    expect(screen.getByTestId('pathname')).toHaveTextContent('/login')
    expect(screen.getByTestId('search')).toHaveTextContent('?next=%2Fstrategies')
    expect(screen.getByTestId('hash')).toHaveTextContent('section')
    expect(screen.getByTestId('state')).toHaveTextContent('null')
  })

  it('unwraps react-router state (history.state.usr) so `state.from` reads the same', () => {
    window.history.replaceState({ usr: { from: '/rulesets' }, key: 'abc', idx: 1 }, '', '/login')
    render(<Probe />)
    expect(screen.getByTestId('state')).toHaveTextContent('{"from":"/rulesets"}')
  })

  it('keeps plain history state as-is when there is no react-router envelope', () => {
    window.history.replaceState({ from: '/plain' }, '', '/login')
    render(<Probe />)
    expect(screen.getByTestId('state')).toHaveTextContent('{"from":"/plain"}')
  })
})
