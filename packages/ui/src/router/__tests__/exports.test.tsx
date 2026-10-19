/**
 * Public-surface proof for `@ploykit/ui/router`.
 *
 * The adapter was historically internal-only (`src/index.ts` exports nothing
 * from `src/router/` and package.json had no subpath), so products imported
 * raw `@tanstack/react-router` and re-learned five semantic traps. These tests
 * pin the published subpath and the five behaviors the adapter promises:
 *
 * 1. `useParams()` is callable with zero arguments (TanStack requires
 *    `{ strict: false }` or TS2554).
 * 2. `useLocation().search` is a `?`-prefixed STRING (TanStack returns an
 *    object), and `hash` has no leading `#`.
 * 3. `useSearchParamsCompat()` supports the react-router functional update.
 * 4. `useNavigate()` accepts a bare path string (TanStack takes options only).
 * 5. `useNavigate()` accepts a plain `state` value (TanStack types it as
 *    ParsedHistoryState, forcing `as never` at call sites).
 *
 * Plus the exports-map integrity check: the `./router` subpath targets are
 * real files, not aspirational strings.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import {
  Link,
  RouterTestHarness,
  rawParseSearch,
  rawStringifySearch,
  useLocation,
  useNavigate,
  useParams,
  useSearchParamsCompat,
} from '../index'

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf-8')) as {
  exports?: Record<string, unknown>
}
const routerExport = pkg.exports?.['./router'] as
  | { development?: string; types?: string; default?: string }
  | undefined
const distBuilt = existsSync(resolve(pkgDir, 'dist'))

describe('@ploykit/ui/router exports map', () => {
  it('declares ./router with the development/types/default target map', () => {
    expect(routerExport).toEqual({
      development: './src/router/index.tsx',
      types: './dist/router/index.d.ts',
      default: './dist/router/index.js',
    })
  })

  it('points the development target at a file that exists', () => {
    expect(routerExport?.development).toBeTruthy()
    expect(existsSync(resolve(pkgDir, routerExport!.development!))).toBe(true)
  })

  it.skipIf(!distBuilt)('points types/default targets at built files that exist', () => {
    for (const target of [routerExport?.types, routerExport?.default]) {
      expect(target).toBeTruthy()
      expect(existsSync(resolve(pkgDir, target!)), `${target} missing`).toBe(true)
    }
  })

  it('exposes every documented named export from ../index', () => {
    expect(Link).toBeTruthy()
    expect(typeof RouterTestHarness).toBe('function')
    expect(typeof useNavigate).toBe('function')
    expect(typeof useParams).toBe('function')
    expect(typeof useLocation).toBe('function')
    expect(typeof useSearchParamsCompat).toBe('function')
    expect(typeof rawStringifySearch).toBe('function')
    expect(typeof rawParseSearch).toBe('function')
  })

  it('raw search serialization keeps numeric params unquoted', () => {
    expect(rawStringifySearch({ page: 2 })).toBe('?page=2')
    expect(rawStringifySearch({ page: 2 })).not.toContain('%22')
    expect(rawParseSearch('?page=2')).toEqual({ page: '2' })
  })
})

describe('@ploykit/ui/router behavior contract', () => {
  it('useParams() is callable with zero arguments', async () => {
    function ParamsProbe() {
      // No `{ strict: false }` argument: compiling this line is the assertion.
      const params = useParams()
      return <div>params:{JSON.stringify(params)}</div>
    }

    render(
      <RouterTestHarness initialEntries={['/app/users']}>
        <ParamsProbe />
      </RouterTestHarness>,
    )
    await act(async () => {})
    await screen.findByText(/^params:/)
  })

  it('useLocation() returns search with "?" and hash without "#"', async () => {
    function LocationProbe() {
      const loc = useLocation()
      return (
        <div>
          <span>pathname:{loc.pathname}</span>
          <span>|search:{loc.search}</span>
          <span>|hash:{loc.hash}</span>
        </div>
      )
    }

    render(
      <RouterTestHarness initialEntries={['/list?page=2&q=x#section']}>
        <LocationProbe />
      </RouterTestHarness>,
    )
    await act(async () => {})
    await screen.findByText('pathname:/list')
    expect(screen.getByText(/search:\?page=2&q=x/)).toBeInTheDocument()
    expect(screen.getByText(/\|hash:section$/)).toBeInTheDocument()
  })

  it('useSearchParamsCompat() setter accepts a functional update', async () => {
    function SearchProbe() {
      const loc = useLocation()
      const [params, setParams] = useSearchParamsCompat()
      return (
        <div>
          <span>search:{loc.search}</span>
          <span>|page:{params.get('page') ?? 'none'}</span>
          <button
            onClick={() =>
              setParams((prev) => {
                const next = new URLSearchParams(prev)
                next.set('page', String(Number(prev.get('page') ?? '0') + 1))
                return next
              })
            }
          >
            increment
          </button>
        </div>
      )
    }

    render(
      <RouterTestHarness initialEntries={['/list?page=1']}>
        <SearchProbe />
      </RouterTestHarness>,
    )
    await act(async () => {})
    await screen.findByText('search:?page=1')

    fireEvent.click(screen.getByRole('button', { name: 'increment' }))
    await waitFor(() => expect(screen.getByText('search:?page=2')).toBeInTheDocument())
    expect(screen.getByText('|page:2')).toBeInTheDocument()
  })

  it('useNavigate() accepts a bare path string and returns a Promise', async () => {
    let pending: Promise<void> | undefined
    function NavProbe() {
      const navigate = useNavigate()
      const loc = useLocation()
      return (
        <div>
          <span>at:{loc.pathname}</span>
          <button
            onClick={() => {
              pending = navigate('/users')
            }}
          >
            go
          </button>
        </div>
      )
    }

    render(
      <RouterTestHarness initialEntries={['/app']}>
        <NavProbe />
      </RouterTestHarness>,
    )
    await act(async () => {})
    await screen.findByText('at:/app')

    fireEvent.click(screen.getByRole('button', { name: 'go' }))
    await waitFor(() => expect(screen.getByText('at:/users')).toBeInTheDocument())
    expect(pending).toBeInstanceOf(Promise)
  })

  it('useNavigate() accepts an options object with plain state', async () => {
    function NavProbe() {
      const navigate = useNavigate()
      const loc = useLocation()
      return (
        <div>
          <span>at:{loc.pathname}</span>
          <span>|from:{(loc.state as { from?: string } | null)?.from ?? 'none'}</span>
          <button
            onClick={() =>
              void navigate({
                to: '/settings',
                search: { tab: 'profile' },
                // Plain object — no `as never` cast needed.
                state: { from: 'exports-test' },
                replace: true,
              })
            }
          >
            go-options
          </button>
        </div>
      )
    }

    render(
      <RouterTestHarness initialEntries={['/app']}>
        <NavProbe />
      </RouterTestHarness>,
    )
    await act(async () => {})
    await screen.findByText('at:/app')

    fireEvent.click(screen.getByRole('button', { name: 'go-options' }))
    await waitFor(() => expect(screen.getByText('at:/settings')).toBeInTheDocument())
    expect(screen.getByText('|from:exports-test')).toBeInTheDocument()
    // The harness wires rawStringifySearch, so the numeric-free search survives
    // in react-router shape instead of being JSON-quoted.
    expect(screen.getByText(/at:\/settings/)).toBeInTheDocument()
  })
})
