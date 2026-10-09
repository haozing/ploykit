
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedGet = vi.hoisted(() => vi.fn());
const mockedPost = vi.hoisted(() => vi.fn());
const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock('@ploykit/client', () => ({
  api: {
    get: mockedGet,
    put: vi.fn(),
    post: mockedPost,
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


vi.mock('../../../components/ConfirmDialog', () => ({
  useConfirm: () => async () => true,
}));
vi.mock('../../../components/toast', () => ({ toast: toastMocks }));

import { MemoryRouter } from 'react-router';
import { OrdersPage } from '../OrdersPage';

const ORDERS = [
  {
    
    id: 'ord-manual-1',
    workspace_id: 'ws-1',
    workspace_name: 'Acme',
    user_id: 'u-1',
    plan_code: 'pro',
    interval: 'one_time',
    amount_cents: 12800,
    currency: 'CNY',
    channel: 'manual',
    status: 'pending',
    created_at: '2026-10-07T08:00:00Z',
  },
  {
    
    id: 'ord-stripe-2',
    workspace_id: 'ws-2',
    workspace_name: 'Beta',
    user_id: 'u-2',
    plan_code: 'starter',
    interval: 'monthly',
    amount_cents: 9900,
    currency: 'CNY',
    channel: 'stripe',
    status: 'pending',
    created_at: '2026-10-07T09:00:00Z',
  },
  {
    
    id: 'ord-paid-3',
    workspace_id: 'ws-3',
    workspace_name: 'Gamma',
    user_id: 'u-3',
    plan_code: 'pro',
    interval: 'one_time',
    amount_cents: 6400,
    currency: 'CNY',
    channel: 'manual',
    status: 'paid',
    created_at: '2026-10-06T08:00:00Z',
  },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/admin/orders']}>
      <QueryClientProvider client={qc}>
        <OrdersPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedGet.mockReset().mockImplementation(async (path: string) => {
    if (path.startsWith('/api/admin/orders'))
      return { items: ORDERS, total: ORDERS.length };
    if (path.startsWith('/api/admin/payment-events'))
      return { items: [], total: 0 };
    if (path.startsWith('/api/admin/billing/config')) return { channels: [] };
    throw new Error('unexpected GET ' + path);
  });
  mockedPost.mockReset().mockResolvedValue({ status: 'ok' });
  toastMocks.success.mockClear();
  toastMocks.error.mockClear();
});

describe('OrdersPage 标记已付（批次 2.8）', () => {
  it('仅 pending+manual 行出现"标记已付"（stripe/已付行不出现）', async () => {
    renderPage();
    expect(await screen.findAllByText('Acme')).toBeTruthy();
    expect(
      await waitFor(() => screen.getAllByRole('button', { name: '标记已付' })),
    ).toHaveLength(1);
  });

  it('确认后 POST mark-paid → 成功 toast + 订单列表失效重拉', async () => {
    renderPage();
    await screen.findAllByText('Acme');

    fireEvent.click(screen.getByRole('button', { name: '标记已付' }));
    await waitFor(() =>
      
      expect(mockedPost).toHaveBeenCalledWith(
        '/api/admin/billing/orders/ord-manual-1/mark-paid',
        undefined,
      ),
    );
    await waitFor(() => expect(toastMocks.success).toHaveBeenCalled());
    
    await waitFor(() =>
      expect(
        mockedGet.mock.calls.filter(([p]: [string]) =>
          p.startsWith('/api/admin/orders'),
        ).length,
      ).toBeGreaterThanOrEqual(2),
    );
  });

  it('409（非 pending 并发窗口）→ toast 透出服务端语义', async () => {
    mockedPost.mockRejectedValueOnce(
      new (class extends Error {
        status = 409;
        code = 'E_CONFLICT';
      })('order is not pending'),
    );
    renderPage();
    await screen.findAllByText('Acme');

    fireEvent.click(screen.getByRole('button', { name: '标记已付' }));
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalled());
    expect(toastMocks.error.mock.calls[0][0]).toContain('order is not pending');
  });

  it('P2-16：触发超额出账先过确认链（确认后 POST run-overage）', async () => {
    renderPage();
    await screen.findAllByText('Acme');

    
    fireEvent.click(screen.getByRole('button', { name: '触发超额出账' }));
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith(
        '/api/admin/billing/run-overage',
        undefined,
      ),
    );
    await waitFor(() => expect(toastMocks.success).toHaveBeenCalled());
  });

  it('P2-16：触发到期降级先过确认链（确认后 POST run-expiry）', async () => {
    renderPage();
    await screen.findAllByText('Acme');

    fireEvent.click(screen.getByRole('button', { name: '触发到期降级' }));
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith(
        '/api/admin/billing/run-expiry',
        undefined,
      ),
    );
  });

  it('B-orders-3：状态筛选选项为中文标签（refunded=已退款），选中后 query 带 status', async () => {
    renderPage();
    await screen.findAllByText('Acme');

    const trigger = screen.getByRole('combobox', { name: '按订单状态过滤' });
    fireEvent.click(trigger);
    const option = await screen.findByRole('option', { name: '已退款' });
    fireEvent.pointerDown(option, { button: 0, pointerType: 'mouse' });
    fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
    fireEvent.click(option);

    await waitFor(() => {
      const ordersCalls = mockedGet.mock.calls
        .map((c) => String(c[0]))
        .filter((p) => p.startsWith('/api/admin/orders'));
      expect(
        ordersCalls.some((p) => p.includes('status=refunded')),
      ).toBe(true);
    });
  });
});
