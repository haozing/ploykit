import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TokensPage } from '../TokensPage'

const mocks = vi.hoisted(() => ({
  tokens: [] as Array<Record<string, unknown>>,
  loading: false,
  create: vi.fn(),
  revoke: vi.fn(),
  confirm: vi.fn(),
}))
vi.mock('../../../../../hooks/src/hooks/useTokens', () => ({
  useTokens: () => ({ tokens: mocks.tokens, loading: mocks.loading, error: null, refetch: vi.fn() }),
  useCreateToken: () => ({ create: mocks.create, loading: false, error: null }),
  useRevokeToken: () => ({ revoke: mocks.revoke, loading: false, error: null }),
}))
vi.mock('../../../components/ConfirmDialog', () => ({
  useConfirm: () => mocks.confirm,
}))

function pat(over: Record<string, unknown> = {}) {
  return {
    id: 'p-1', name: 'ci-deploy', prefix: 'tk_ab12cd',
    created_at: '2026-10-01T00:00:00Z', ...over,
  }
}

beforeEach(() => {
  mocks.create.mockReset().mockResolvedValue({ pat: pat(), token: 'tk_plainvalue123' })
  mocks.revoke.mockReset().mockResolvedValue(undefined)
  mocks.confirm.mockReset().mockResolvedValue(true)
  mocks.loading = false
  mocks.tokens = []
})

describe('TokensPage', () => {
  it('加载中渲染 Skeleton 行', () => {
    mocks.loading = true
    render(<TokensPage />)
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
  })

  it('空列表渲染空态', () => {
    render(<TokensPage />)
    expect(screen.getByText('还没有令牌')).toBeInTheDocument()
  })

  it('渲染令牌行：名称/前缀/未用过提示/永不过期徽标', () => {
    mocks.tokens = [pat()]
    render(<TokensPage />)
    expect(screen.getByText('ci-deploy')).toBeInTheDocument()
    expect(screen.getByText('tk_ab12cd…')).toBeInTheDocument()
    expect(screen.getByText('从未使用')).toBeInTheDocument()
    expect(screen.getByText('永不过期')).toBeInTheDocument()
  })

  it('创建令牌：对话框填 name/ttl → create 携带正确参数 → SecretModal 展示明文', async () => {
    render(<TokensPage />)
    fireEvent.click(screen.getByRole('button', { name: '新建令牌' }))

    const nameInput = await screen.findByLabelText('名称')
    fireEvent.change(nameInput, { target: { value: 'ci-deploy' } })
    fireEvent.change(screen.getByLabelText('有效期（小时，可选）'), { target: { value: '72' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith('ci-deploy', 72))
    
    expect(await screen.findByText('个人访问令牌 创建成功')).toBeInTheDocument()
    expect(screen.getByText('tk_plainvalue123')).toBeInTheDocument()
  })

  it('吊销令牌：确认后 revoke(id)', async () => {
    mocks.confirm.mockResolvedValueOnce(true)
    mocks.tokens = [pat({ id: 'p-9' })]
    render(<TokensPage />)

    fireEvent.click(screen.getByRole('button', { name: '吊销令牌 ci-deploy' }))
    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith('p-9'))
  })

  it('P2-1：TTL 为 0 → 拒绝创建并提示，不静默创建永不过期凭证', async () => {
    render(<TokensPage />)
    fireEvent.click(screen.getByRole('button', { name: '新建令牌' }))

    const nameInput = await screen.findByLabelText('名称')
    fireEvent.change(nameInput, { target: { value: 'ci-deploy' } })
    fireEvent.change(screen.getByLabelText('有效期（小时，可选）'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    expect(await screen.findByText(/有效期必须是正整数/)).toBeInTheDocument()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('P2-1：TTL 为负数 → 拒绝创建', async () => {
    render(<TokensPage />)
    fireEvent.click(screen.getByRole('button', { name: '新建令牌' }))

    const nameInput = await screen.findByLabelText('名称')
    fireEvent.change(nameInput, { target: { value: 'ci-deploy' } })
    fireEvent.change(screen.getByLabelText('有效期（小时，可选）'), { target: { value: '-5' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    expect(await screen.findByText(/有效期必须是正整数/)).toBeInTheDocument()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('P2-1：TTL 为非数字 → 拒绝创建', async () => {
    render(<TokensPage />)
    fireEvent.click(screen.getByRole('button', { name: '新建令牌' }))

    const nameInput = await screen.findByLabelText('名称')
    fireEvent.change(nameInput, { target: { value: 'ci-deploy' } })
    fireEvent.change(screen.getByLabelText('有效期（小时，可选）'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    expect(await screen.findByText(/有效期必须是正整数/)).toBeInTheDocument()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('P2-1：TTL 留空 → 不传过期时间（显式永不过期）', async () => {
    render(<TokensPage />)
    fireEvent.click(screen.getByRole('button', { name: '新建令牌' }))

    const nameInput = await screen.findByLabelText('名称')
    fireEvent.change(nameInput, { target: { value: 'ci-deploy' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith('ci-deploy', undefined))
  })

  it('B2：TTL placeholder 明示"不建议"——0 与留空的语义不再含混', async () => {
    render(<TokensPage />)
    fireEvent.click(screen.getByRole('button', { name: '新建令牌' }))
    const ttlInput = await screen.findByLabelText('有效期（小时，可选）')
    expect(ttlInput).toHaveAttribute('placeholder', '留空 = 永不过期（不建议）')
  })

  it('B3：名称 22 个汉字（66 字节）超服务端 64 字节上限 → 前端拒绝并按字节提示', async () => {
    render(<TokensPage />)
    fireEvent.click(screen.getByRole('button', { name: '新建令牌' }))

    const nameInput = await screen.findByLabelText('名称')
    fireEvent.change(nameInput, { target: { value: '汉'.repeat(22) } }) 
    fireEvent.change(screen.getByLabelText('有效期（小时，可选）'), { target: { value: '72' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    expect(await screen.findByText(/不能超过 64 字节/)).toBeInTheDocument()
    expect(screen.getByText(/当前 66 字节/)).toBeInTheDocument()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('B3：名称 21 个汉字（63 字节）恰在服务端上限内 → 正常提交（字节口径对齐）', async () => {
    const name = '汉'.repeat(21) 
    render(<TokensPage />)
    fireEvent.click(screen.getByRole('button', { name: '新建令牌' }))

    const nameInput = await screen.findByLabelText('名称')
    fireEvent.change(nameInput, { target: { value: name } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(name, undefined))
  })

  it('B3：名称输入带 maxLength=64 粗预约束（ASCII 直拦，CJK 由字节校验兜底）', async () => {
    render(<TokensPage />)
    fireEvent.click(screen.getByRole('button', { name: '新建令牌' }))
    const nameInput = await screen.findByLabelText('名称')
    expect(nameInput).toHaveAttribute('maxlength', '64')
  })

  it('B1：名称单元格 truncate + title 全文——超长名不再撑宽表格（滚动层在 DataTable）', () => {
    const longName = 'a'.repeat(60)
    mocks.tokens = [pat({ name: longName })]
    render(<TokensPage />)
    const cell = screen.getByText(longName)
    expect(cell.className).toContain('truncate')
    expect(cell).toHaveAttribute('title', longName)
  })
})
