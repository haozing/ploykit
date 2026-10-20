// WorkspaceSwitcher 数据注入缝（data / menuFooter prop）的纯注入用例。
//
// 刻意**不 mock** useWorkspaceSwitch、也不挂 PloykitProvider：真实钩子在无
// WorkspaceContext 时同步 throw（must be used within PloykitProvider），组件内
// 部的 Provider-safe try/catch 让钩子整体降级为空，注入数据字段级合并后接管
// 渲染——这正是"产品侧不挂 Provider 也能用切换器"的采纳路径。主测试文件
// （WorkspaceSwitcher.test.tsx）模块级 mock 了钩子，覆盖不到这条降级路径本身。
import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { RouterTestHarness } from '../../router'
import { WorkspaceSwitcher } from '../WorkspaceSwitcher'
import { SidebarProvider } from '../ui/sidebar'

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

async function renderSwitcher(node: React.ReactElement) {
  const view = render(
    <RouterTestHarness initialEntries={['/app']}>
      <SidebarProvider>{node}</SidebarProvider>
    </RouterTestHarness>,
  )
  await act(async () => {})
  return view
}

function injectedProps(overrides: Partial<Parameters<typeof WorkspaceSwitcher>[0]>['data'] = {}) {
  const switchTo = vi.fn()
  const create = vi.fn(async () => {})
  return {
    props: {
      data: {
        current: { id: 'ws-x', name: 'Injected', plan_code: 'pro' },
        list: [
          { id: 'ws-x', name: 'Injected', plan_code: 'pro' },
          { id: 'ws-y', name: 'Gamma', plan_code: 'free' },
        ],
        switchTo,
        create,
        ...overrides,
      },
    } as const,
    switchTo,
    create,
  }
}

describe('WorkspaceSwitcher 数据注入缝（无 WorkspaceContext）', () => {
  it('data 提供且无 Provider：渲染注入的 current/list，切换与创建调用注入函数，全程不抛错', async () => {
    const { props, switchTo, create } = injectedProps()
    await renderSwitcher(<WorkspaceSwitcher {...props} />)

    // 触发按钮渲染注入的 current（名称 + plan_code 副行）
    const trigger = screen.getByRole('button', { name: '切换工作区' })
    expect(trigger).toHaveTextContent('Injected')
    expect(trigger).toHaveTextContent('pro')

    // 菜单渲染注入的 list
    fireEvent.click(trigger)
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Gamma/ })).toBeVisible()

    // 点击列表项 → 注入的 switchTo('ws-y')（点击菜单项后菜单关闭）
    fireEvent.click(screen.getByRole('menuitem', { name: /Gamma/ }))
    expect(switchTo).toHaveBeenCalledTimes(1)
    expect(switchTo).toHaveBeenCalledWith('ws-y')

    // 重新打开菜单 → 新建工作区 → 注入的 create('Delta', { slug: 'delta' })（第二参携带 kit 生成的 slug，消费方可忽略）
    fireEvent.click(screen.getByRole('button', { name: '切换工作区' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /新建工作区/ }))
    fireEvent.change(await screen.findByLabelText('新工作区名称'), { target: { value: 'Delta' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith('Delta', { slug: 'delta' }))

    // resolve 后面板收起（注入流程成功即关闭）
    await waitFor(() => expect(screen.queryByLabelText('新工作区名称')).not.toBeInTheDocument())
  })

  it('data.create reject：面板保持打开（错误展示归消费方），组件不崩', async () => {
    const failingCreate = vi.fn(async () => { throw new Error('boom') })
    const { props } = injectedProps({ create: failingCreate })
    await renderSwitcher(<WorkspaceSwitcher {...props} />)

    fireEvent.click(screen.getByRole('button', { name: '切换工作区' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /新建工作区/ }))
    fireEvent.change(await screen.findByLabelText('新工作区名称'), { target: { value: 'Epsilon' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(failingCreate).toHaveBeenCalledWith('Epsilon', { slug: 'epsilon' }))
    expect(screen.getByLabelText('新工作区名称')).toBeInTheDocument()
  })

  it('注入 error（string）原样显示，不做 ApiError 翻译', async () => {
    const { props } = injectedProps({ error: '工作区数量已达套餐上限' })
    await renderSwitcher(<WorkspaceSwitcher {...props} />)

    fireEvent.click(screen.getByRole('button', { name: '切换工作区' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /新建工作区/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('工作区数量已达套餐上限')
  })

  it('注入 error（ApiError E_QUOTA_EXCEEDED）：apiErrorMessage 翻译并点亮计费指引分支（orkome 报告 #2）', async () => {
    const { ApiError } = await import('@ploykit/client')
    const { props } = injectedProps({ error: new ApiError(402, 'E_QUOTA_EXCEEDED', 'quota exceeded for workspaces') })
    await renderSwitcher(<WorkspaceSwitcher {...props} />)

    fireEvent.click(screen.getByRole('button', { name: '切换工作区' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /新建工作区/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('配额已用尽')
    // 死分支修复的核心断言：注入模式下配额引导可达
    expect(screen.getByText(/已达当前工作区数上限/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '设置→计费' })).toBeInTheDocument()
  })

  it('注入 create 二参携带 kit 生成的 slug（slugifyWorkspaceName 同源，orkome 报告 #5）', async () => {
    const { props, create } = injectedProps()
    await renderSwitcher(<WorkspaceSwitcher {...props} />)

    fireEvent.click(screen.getByRole('button', { name: '切换工作区' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /新建工作区/ }))
    fireEvent.change(await screen.findByLabelText('新工作区名称'), { target: { value: 'Delta' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith('Delta', { slug: 'delta' }))
  })

  it('menuFooter：渲染在下拉菜单内、新建工作区块之后', async () => {
    const { props } = injectedProps()
    await renderSwitcher(
      <WorkspaceSwitcher {...props} menuFooter={<div data-testid="menu-footer">自定义页脚</div>} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '切换工作区' }))
    const footer = await screen.findByTestId('menu-footer')
    const menu = screen.getByRole('menu')
    expect(menu).toContainElement(footer)

    // DOM 顺序：footer 在「新建工作区」菜单项之后
    const createItem = screen.getByRole('menuitem', { name: /新建工作区/ })
    expect(createItem.compareDocumentPosition(footer)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('无 data 且无 Provider：占位渲染（选择工作区），钩子降级不炸', async () => {
    await renderSwitcher(<WorkspaceSwitcher />)
    const trigger = screen.getByRole('button', { name: '切换工作区' })
    expect(trigger).toHaveTextContent('选择工作区')

    // 菜单可打开（空 list），但创建流程在钩子缺失时不会误触发网络调用
    fireEvent.click(trigger)
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /新建工作区/ })).toBeVisible()
  })
})
