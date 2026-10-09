
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedGet = vi.hoisted(() => vi.fn());
const mockedPatch = vi.hoisted(() => vi.fn());
vi.mock('@ploykit/client', () => ({
  api: {
    get: mockedGet,
    put: vi.fn(),
    post: vi.fn(),
    patch: mockedPatch,
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
vi.mock('react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
  useSearchParams: () => [
    new URLSearchParams(),
    (_p: URLSearchParams) => {},
  ],
}));

import { WorkspacesPage } from '../WorkspacesPage';

const WS = {
  id: 'ws-1',
  name: 'Acme',
  slug: 'acme',
  plan_code: 'free',
  member_count: 2,
  created_at: '2026-09-01T08:00:00Z',
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WorkspacesPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset().mockImplementation(async (path: string) => {
    if (path.startsWith('/api/admin/workspaces'))
      return { items: [WS], total: 1 };
    if (path.startsWith('/api/admin/plans')) {
      return {
        items: ['free', 'pro'],
        plans: [
          {
            code: 'free',
            name: 'Free',
            currency: 'CNY',
            trial_days: 0,
            sort_no: 1,
          },
          {
            code: 'pro',
            name: 'Pro',
            currency: 'CNY',
            trial_days: 14,
            sort_no: 2,
          },
        ],
      };
    }
    throw new Error('unexpected GET ' + path);
  });
  mockedPatch.mockReset().mockResolvedValue({});
});

describe('WorkspacesPage 套餐选项（批次 2.5 收尾）', () => {
  it('选项用 plan.name 并标注试用天数（B-workspaces-9）：Pro（14 天）带提示，Free 纯名', async () => {
    renderPage();
    expect(await screen.findByText('Acme')).toBeInTheDocument();

    const trigger = screen.getByRole('combobox', { name: /变更 Acme 套餐/ });
    fireEvent.click(trigger);
    expect(
      await screen.findByRole('option', { name: 'Pro（新订阅享 14 天试用）' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Free' })).toBeInTheDocument();
  });

  it('plans 视图缺失（老后端只有码表）→ 回退纯码表标签', async () => {
    mockedGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/admin/workspaces'))
        return { items: [WS], total: 1 };
      if (path.startsWith('/api/admin/plans'))
        return { items: ['free', 'pro'] };
      throw new Error('unexpected GET ' + path);
    });
    renderPage();
    await screen.findByText('Acme');

    const trigger = screen.getByRole('combobox', { name: /变更 Acme 套餐/ });
    fireEvent.click(trigger);
    expect(
      await screen.findByRole('option', { name: 'pro' }),
    ).toBeInTheDocument();
  });

  it('选中试用套餐 → PATCH plan {plan_code}', async () => {
    renderPage();
    await screen.findByText('Acme');

    const trigger = screen.getByRole('combobox', { name: /变更 Acme 套餐/ });
    fireEvent.click(trigger);
    const option = await screen.findByRole('option', {
      name: 'Pro（新订阅享 14 天试用）',
    });
    fireEvent.pointerDown(option, { button: 0, pointerType: 'mouse' });
    fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
    fireEvent.click(option);

    await waitFor(() =>
      expect(mockedPatch).toHaveBeenCalledWith(
        '/api/admin/workspaces/ws-1/plan',
        { plan_code: 'pro' },
      ),
    );
  });
});
