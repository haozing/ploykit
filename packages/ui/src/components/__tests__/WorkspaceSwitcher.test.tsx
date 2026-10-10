import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { ApiError } from '@ploykit/client'
import { WorkspaceSwitcher } from '../WorkspaceSwitcher'
import { SidebarProvider } from '../ui/sidebar'



const switchTo = vi.fn()
const create = vi.fn(async (name: string, slug: string) => ({ id: 'ws-new', name, slug }))
let mockError: unknown = null
vi.mock('../../../../hooks/src/hooks/useWorkspace', () => ({
  useWorkspaceSwitch: () => ({
    current: { id: 'ws-1', name: 'Acme', plan_code: 'free', role: 'owner' },
    list: [
      { id: 'ws-1', name: 'Acme', plan_code: 'free', role: 'owner' },
      { id: 'ws-2', name: 'Beta', plan_code: 'pro', role: 'admin' },
    ],
    switchTo,
    create,
    creating: false,
    error: mockError,
  }),
}))

function renderSwitcher() {
  return render(
    <MemoryRouter>
      <SidebarProvider>
        <WorkspaceSwitcher />
      </SidebarProvider>
    </MemoryRouter>,
  )
}


beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
})

describe('WorkspaceSwitcher（Base UI Menu 重建）', () => {
  beforeEach(() => {
    switchTo.mockClear()
    create.mockClear()
    mockError = null
  })

  it('渲染当前工作区，打开菜单列出工作区与新建入口', async () => {
    renderSwitcher()
    const trigger = screen.getByRole('button', { name: '切换工作区' })
    expect(trigger).toHaveTextContent('Acme')

    
    fireEvent.click(trigger)

    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Beta/ })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: /新建工作区/ })).toBeVisible()
  })

  it('点击工作区项调用 switchTo', async () => {
    renderSwitcher()
    const trigger = screen.getByRole('button', { name: '切换工作区' })
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('menuitem', { name: /Beta/ }))
    expect(switchTo).toHaveBeenCalledWith('ws-2')
  })

  it('新建工作区：打开内联创建，提交调用 create(name, slug)', async () => {
    renderSwitcher()
    const trigger = screen.getByRole('button', { name: '切换工作区' })
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('menuitem', { name: /新建工作区/ }))

    const input = await screen.findByLabelText('新工作区名称')
    fireEvent.change(input, { target: { value: 'Gamma Workspace' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(create).toHaveBeenCalledWith('Gamma Workspace', 'gamma-workspace'))
  })

  it('RE2-1：创建失败（配额满 402/E_QUOTA_EXCEEDED）显示中文错误与"升级套餐"指引，不再静默', async () => {
    mockError = new ApiError(402, 'E_QUOTA_EXCEEDED', 'quota exceeded for workspaces')
    renderSwitcher()
    const trigger = screen.getByRole('button', { name: '切换工作区' })
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('menuitem', { name: /新建工作区/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('配额已用尽')
    
    
    expect(screen.getByText(/已达当前工作区数上限/)).toBeInTheDocument()
    const billing = screen.getByRole('link', { name: '设置→计费' })
    expect(billing).toHaveAttribute('href', '/settings/workspace/billing')
  })

  it('RE2-1：slug 冲突等其他失败显示中文文案，且不出现升级指引', async () => {
    mockError = new ApiError(409, 'E_CONFLICT', 'slug already taken')
    renderSwitcher()
    const trigger = screen.getByRole('button', { name: '切换工作区' })
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('menuitem', { name: /新建工作区/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('该标识已被占用，请换个工作区名称重试')
    expect(screen.queryByRole('link', { name: '升级套餐' })).not.toBeInTheDocument()
  })

  it('RE2-1：创建成功（无 error）时面板内无错误提示', async () => {
    renderSwitcher()
    const trigger = screen.getByRole('button', { name: '切换工作区' })
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('menuitem', { name: /新建工作区/ }))

    await screen.findByLabelText('新工作区名称')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  

  async function submitName(name: string): Promise<unknown[]> {
    const trigger = screen.getByRole('button', { name: '切换工作区' })
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('menuitem', { name: /新建工作区/ }))
    fireEvent.change(await screen.findByLabelText('新工作区名称'), { target: { value: name } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    return create.mock.calls[0]
  }

  it('G2：纯中文名生成合法 slug（ws-随机后缀兜底，不以 - 开头/结尾、≥4 字符）', async () => {
    renderSwitcher()
    const [name, slug] = (await submitName('审计账单')) as [string, string]
    expect(name).toBe('审计账单')
    
    expect(slug).toMatch(/^ws-[a-z0-9]{4}$/)
  })

  it('G2：中文-英文混合名剥离首尾横线（审计-Webhooks- → webhooks）', async () => {
    renderSwitcher()
    const [, slug] = (await submitName('审计-Webhooks-')) as [string, string]
    expect(slug).toBe('webhooks')
  })

  it('G2：过短名补随机后缀达服务端 4 字符下限（ab → ab-xxxx）', async () => {
    renderSwitcher()
    const [, slug] = (await submitName('ab')) as [string, string]
    expect(slug).toMatch(/^ab-[a-z0-9]{4}$/)
  })
})
