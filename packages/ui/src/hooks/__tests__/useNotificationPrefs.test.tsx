import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { queryKeys } from '../../provider/PloykitProvider'
import {
  useNotificationPrefs, useSetNotificationPref, type NotificationPreference,
} from '../useNotificationPrefs'






const mockedGet = vi.hoisted(() => vi.fn())
const mockedPut = vi.hoisted(() => vi.fn())
vi.mock('@ploykit/client', () => ({
  api: { get: mockedGet, put: mockedPut },
  setWorkspaceIdProvider: vi.fn(),
}))

const pref = (type: string, email: boolean, inApp: boolean): NotificationPreference => ({
  notification_type: type, email_enabled: email, in_app_enabled: inApp,
  updated_at: '2026-10-01T00:00:00Z',
})

function Probe({ type, channels }: { type: string; channels: { email_enabled?: boolean; in_app_enabled?: boolean } }) {
  const { prefs } = useNotificationPrefs()
  const { setPref, loading, error } = useSetNotificationPref()
  return (
    <div>
      <div data-testid="prefs">{JSON.stringify(prefs)}</div>
      <button onClick={() => setPref(type, channels).catch(() => {})}>toggle</button>
      <div data-testid="mutating">{loading ? 'yes' : 'no'}</div>
      <div data-testid="mut-error">{error ? String((error as Error).message) : 'none'}</div>
    </div>
  )
}

function renderProbe(
  qc: QueryClient,
  props: { type: string; channels: { email_enabled?: boolean; in_app_enabled?: boolean } },
) {
  return render(
    <QueryClientProvider client={qc}>
      <Probe {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockedGet.mockReset()
  mockedPut.mockReset()
})

describe('useNotificationPrefs', () => {
  it('GET /api/notification-preferences 展开信封 items', async () => {
    mockedGet.mockResolvedValue({ items: [pref('task.created', true, true)] })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderProbe(qc, { type: 'task.created', channels: { email_enabled: false } })
    await waitFor(() =>
      expect(screen.getByTestId('prefs').textContent).toBe(JSON.stringify([pref('task.created', true, true)])))
    expect(mockedGet).toHaveBeenCalledWith('/api/notification-preferences')
  })
})

describe('useSetNotificationPref 乐观更新 + 回滚', () => {
  it('已有行：onMutate 乐观改写缓存，成功后 invalidate 重取', async () => {
    const initial = [pref('task.created', true, true)]
    mockedGet.mockResolvedValue({ items: initial })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(queryKeys.notificationPrefs, initial)
    
    let resolvePut!: (v: unknown) => void
    mockedPut.mockImplementation(() => new Promise((res) => { resolvePut = res }))
    renderProbe(qc, { type: 'task.created', channels: { email_enabled: false } })
    await waitFor(() => expect(screen.getByTestId('prefs').textContent).toBe(JSON.stringify(initial)))

    screen.getByRole('button', { name: 'toggle' }).click()

    
    await waitFor(() => {
      const prefs = JSON.parse(screen.getByTestId('prefs').textContent ?? '[]')
      expect(prefs).toHaveLength(1)
      expect(prefs[0].email_enabled).toBe(false)
      expect(prefs[0].in_app_enabled).toBe(true)
    })
    expect(mockedPut).toHaveBeenCalledWith('/api/notification-preferences/task.created', {
      email_enabled: false, in_app_enabled: undefined,
    })

    resolvePut(pref('task.created', false, true))
    await waitFor(() => expect(screen.getByTestId('mut-error').textContent).toBe('none'))
    
    await waitFor(() => expect(mockedGet).toHaveBeenCalled())
  })

  it('缺行：按"缺行 = 双开"语义乐观追加显式行', async () => {
    const initial: NotificationPreference[] = []
    mockedGet.mockResolvedValue({ items: initial })
    let resolvePut!: (v: unknown) => void
    mockedPut.mockImplementation(() => new Promise((res) => { resolvePut = res }))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(queryKeys.notificationPrefs, initial)
    renderProbe(qc, { type: 'quota.exceeded', channels: { in_app_enabled: false } })
    await waitFor(() => expect(screen.getByTestId('prefs').textContent).toBe('[]'))

    screen.getByRole('button', { name: 'toggle' }).click()

    
    await waitFor(() => {
      const prefs = JSON.parse(screen.getByTestId('prefs').textContent ?? '[]')
      expect(prefs).toHaveLength(1)
      expect(prefs[0]).toMatchObject({ notification_type: 'quota.exceeded', email_enabled: true, in_app_enabled: false })
    })
    resolvePut(pref('quota.exceeded', true, false))
    await waitFor(() => expect(mockedGet).toHaveBeenCalled())
  })

  it('PUT 失败：回滚 prev 并暴露 error（P1-5 主断言）', async () => {
    const initial = [pref('task.created', true, true)]
    mockedGet.mockResolvedValue({ items: initial })
    mockedPut.mockRejectedValue(new Error('boom'))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(queryKeys.notificationPrefs, initial)
    renderProbe(qc, { type: 'task.created', channels: { email_enabled: false } })
    await waitFor(() => expect(screen.getByTestId('prefs').textContent).toBe(JSON.stringify(initial)))

    screen.getByRole('button', { name: 'toggle' }).click()

    
    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      expect(screen.getByTestId('prefs').textContent).toBe(JSON.stringify(initial))
    }, { timeout: 2000 })
    await waitFor(() => expect(screen.getByTestId('mut-error').textContent).toBe('boom'))
  })
})
