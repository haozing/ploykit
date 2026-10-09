
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SSOPage } from '../SSOPage';

const mockedGet = vi.hoisted(() => vi.fn());
vi.mock('@ploykit/client', () => ({
  api: {
    get: mockedGet,
    put: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/admin/sso']}>
      <QueryClientProvider client={qc}>
        <SSOPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const ROWS = [
  {
    workspace_id: 'ws-1',
    workspace_slug: 'acme',
    workspace_name: 'Acme',
    issuer_url: 'https://idp.acme.corp',
    client_id: 'acme-client',
    scopes: 'openid email profile',
    secret_sealed: true,
    created_at: '2026-10-01T08:00:00Z',
    updated_at: '2026-10-02T08:00:00Z',
  },
  {
    workspace_id: 'ws-2',
    workspace_slug: 'globex',
    workspace_name: 'Globex',
    issuer_url: 'https://sso.globex.io',
    client_id: 'globex-client',
    scopes: 'openid email',
    secret_sealed: false, // 迁移 016 时代存量明文 → 警告徽标
    created_at: '2026-09-01T08:00:00Z',
    updated_at: '2026-09-01T08:00:00Z',
  },
];

beforeEach(() => {
  mockedGet.mockReset();
});

describe('SSOPage', () => {
  it('渲染 provider 列表：工作区、Issuer/client_id、密封徽标两态', async () => {
    mockedGet.mockResolvedValue(ROWS);
    renderPage();

    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('https://idp.acme.corp')).toBeInTheDocument();
    expect(screen.getByText('client_id: acme-client')).toBeInTheDocument();
    
    expect(screen.getByText('已加密')).toBeInTheDocument();
    expect(screen.getByText('明文')).toBeInTheDocument();
    
    expect(
      screen.getByText(/配置的增删改在各工作区\s+自助面完成/),
    ).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith('/api/admin/sso');
  });

  it('B-sso-3：工作区名链接到管理台工作区详情页', async () => {
    mockedGet.mockResolvedValue(ROWS);
    renderPage();

    const link = await screen.findByRole('link', { name: /Acme/ });
    expect(link).toHaveAttribute('href', '/admin/workspaces/ws-1');
  });

  it('B-sso-2：明文行常显"需重新保存以加密"指引（不只在 title 悬停）', async () => {
    mockedGet.mockResolvedValue(ROWS);
    renderPage();

    expect(await screen.findByText('需重新保存以加密')).toBeInTheDocument();
  });

  it('B-sso-7：配置/更新时间双值常显（updated != created 时显示更新行）', async () => {
    mockedGet.mockResolvedValue(ROWS);
    renderPage();

    await screen.findByText('Acme');
    
    expect(screen.getByText(/更新 /)).toBeInTheDocument();
    expect(screen.getByText('配置 / 更新时间')).toBeInTheDocument();
  });

  it('空列表 → 空态"无工作区配置联邦 SSO"', async () => {
    mockedGet.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('无工作区配置联邦 SSO')).toBeInTheDocument();
  });

  it('加载失败 → 错误态可重试（不渲染表格行）', async () => {
    mockedGet.mockRejectedValue(new Error('db down'));
    renderPage();

    expect(
      await screen.findByRole('button', { name: '重试' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Acme')).not.toBeInTheDocument();
  });
});
