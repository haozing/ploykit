import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarMenu,
  SidebarMenuItem, SidebarMenuButton, SidebarMenuSkeleton, SidebarProvider, useSidebar,
} from '../sidebar'




function StateProbe() {
  const { state, open } = useSidebar()
  return (
    <div>
      <div data-testid="state">{state}</div>
      <div data-testid="open">{String(open)}</div>
    </div>
  )
}

function renderSidebar(props: { defaultOpen?: boolean } = {}) {
  return render(
    <SidebarProvider {...props}>
      <Sidebar>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton>菜单项</SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <StateProbe />
      <input aria-label="输入框" />
    </SidebarProvider>,
  )
}

beforeEach(() => {
  document.cookie = 'sidebar_state=; path=/; max-age=0'
})

describe('SidebarProvider 状态持久化（P2-17）', () => {
  it('stock 语义：provider 不回读 cookie（回读在 AppShell 组合层，P2-17 见 AppShell 测试）', () => {
    document.cookie = 'sidebar_state=false; path=/'
    renderSidebar()
    expect(screen.getByTestId('state').textContent).toBe('expanded')
  })

  it('cookie 缺省 → 默认展开', () => {
    renderSidebar()
    expect(screen.getByTestId('state').textContent).toBe('expanded')
  })

  it('显式 defaultOpen 优先于 cookie', () => {
    document.cookie = 'sidebar_state=false; path=/'
    renderSidebar({ defaultOpen: true })
    expect(screen.getByTestId('state').textContent).toBe('expanded')
  })

  it('切换写回 cookie（持久化不再是死功能）', () => {
    renderSidebar()
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(document.cookie).toContain('sidebar_state=false')
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(document.cookie).toContain('sidebar_state=true')
  })
})

describe('Ctrl/Cmd+B 快捷键（P3-1）', () => {
  it('全局 Cmd/Ctrl+B 切换折叠', () => {
    renderSidebar()
    expect(screen.getByTestId('state').textContent).toBe('expanded')
    fireEvent.keyDown(window, { key: 'b', metaKey: true })
    expect(screen.getByTestId('state').textContent).toBe('collapsed')
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(screen.getByTestId('state').textContent).toBe('expanded')
  })

  it('stock 语义：input 内 Ctrl+B 同样折叠（产品级输入保护在 AppShell，P3-1 见 AppShell 测试）', () => {
    renderSidebar()
    const input = screen.getByRole('textbox', { name: '输入框' })
    fireEvent.keyDown(input, { key: 'b', ctrlKey: true })
    expect(screen.getByTestId('state').textContent).toBe('collapsed')
  })
})

describe('SidebarMenuSkeleton 确定性（P2-11）', () => {
  it('宽度来自固定序列，且同一实例跨重渲染稳定（渲染期随机数的判别性质）', () => {
    function Tree({ tag }: { tag: string }) {
      return (
        <SidebarMenu>
          {['a', 'b', 'c', 'd'].map((k) => (
            <SidebarMenuSkeleton key={`${tag}-${k}`} />
          ))}
        </SidebarMenu>
      )
    }
    const widthsOf = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('[data-sidebar="menu-skeleton-text"]')).map(
        (el) => (el as HTMLElement).style.getPropertyValue('--skeleton-width'),
      )
    const allowed = Array.from({ length: 40 }, (_, i) => `${50 + i}%`) // stock: floor(rand*40)+50

    const { rerender, container } = render(<Tree tag="t" />)
    const w1 = widthsOf(container)
    expect(w1).toHaveLength(4)
    
    for (const w of w1) expect(allowed).toContain(w)

    
    
    rerender(<Tree tag="t" />)
    expect(widthsOf(container)).toEqual(w1)
  })
})
