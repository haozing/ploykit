import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useApi } from '../useApi'




const mockedGet = vi.hoisted(() => vi.fn())
const mockedPost = vi.hoisted(() => vi.fn())
const mockedPut = vi.hoisted(() => vi.fn())
const mockedPatch = vi.hoisted(() => vi.fn())
const mockedDelete = vi.hoisted(() => vi.fn())
vi.mock('@ploykit/client', () => ({
  api: { get: mockedGet, post: mockedPost, put: mockedPut, patch: mockedPatch, delete: mockedDelete },
  ApiError: class ApiError extends Error {},
  setWorkspaceIdProvider: vi.fn(),
}))

function Probe({ tick }: { tick: number }) {
  const a = useApi()
  return (
    <div>
      <div data-testid="tick">{tick}</div>
      <Child api={a} />
    </div>
  )
}

let lastApi: ReturnType<typeof useApi> | null = null
let rerenderApi: ReturnType<typeof useApi> | null = null
function Child({ api }: { api: ReturnType<typeof useApi> }) {
  
  if (lastApi === null) lastApi = api
  else rerenderApi = api
  return <div data-testid="child">ok</div>
}

beforeEach(() => {
  lastApi = null
  rerenderApi = null
  mockedGet.mockReset().mockResolvedValue({ ok: 1 })
  mockedPost.mockReset().mockResolvedValue({ ok: 1 })
  mockedPut.mockReset().mockResolvedValue({ ok: 1 })
  mockedPatch.mockReset().mockResolvedValue({ ok: 1 })
  mockedDelete.mockReset().mockResolvedValue({ ok: 1 })
})

describe('useApi 引用稳定性', () => {
  it('重渲染（含 props 变化）返回同一对象引用，五个方法引用跨渲染稳定', () => {
    const { rerender } = render(<Probe tick={1} />)
    expect(lastApi).not.toBeNull()

    rerender(<Probe tick={2} />)
    expect(screen.getByTestId('tick').textContent).toBe('2')
    expect(rerenderApi).toBe(lastApi)
    expect(rerenderApi!.get).toBe(lastApi!.get)
    expect(rerenderApi!.post).toBe(lastApi!.post)
    expect(rerenderApi!.put).toBe(lastApi!.put)
    expect(rerenderApi!.patch).toBe(lastApi!.patch)
    expect(rerenderApi!.delete).toBe(lastApi!.delete)
  })

  it('五个方法各转发到 @ploykit/client 的对应方法', async () => {
    const api = useApiSpy()
    await api.get('/a')
    await api.post('/b', { x: 1 })
    await api.put('/c', { x: 2 })
    await api.patch('/d', { x: 3 })
    await api.delete('/e')
    expect(mockedGet).toHaveBeenCalledWith('/a')
    expect(mockedPost).toHaveBeenCalledWith('/b', { x: 1 })
    expect(mockedPut).toHaveBeenCalledWith('/c', { x: 2 })
    expect(mockedPatch).toHaveBeenCalledWith('/d', { x: 3 })
    expect(mockedDelete).toHaveBeenCalledWith('/e', undefined)
  })
})


function useApiSpy(): ReturnType<typeof useApi> {
  let out: ReturnType<typeof useApi> | null = null
  function Shell() {
    out = useApi()
    return null
  }
  render(<Shell />)
  return out!
}
