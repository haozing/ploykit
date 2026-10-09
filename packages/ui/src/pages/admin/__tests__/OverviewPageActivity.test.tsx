
import '@testing-library/jest-dom/vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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


const paramsState = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock('react-router', () => ({
  useLocation: () => ({ hash: '' }),
  useSearchParams: () => [
    paramsState.params,
    (p: URLSearchParams) => {
      paramsState.params = p;
    },
  ],
}));

import { OverviewPage } from '../OverviewPage';

const STATS = {
  total_users: 10,
  active_users: 8,
  total_workspaces: 4,
  paid_workspaces: 1,
  new_users_7d: 3,
  new_users_30d: 6,
};
const SUMMARY = [
  { event_type: 'task_created', count: 42, last_at: '2026-10-08T09:00:00Z' },
  { event_type: 'checkout_started', count: 7, last_at: '2026-10-08T08:00:00Z' },
];
const RECENT = Array.from({ length: 20 }, (_, i) => ({
  id: 100 - i,
  workspace_id:
    i % 2 === 0 ? 'ws-00000000-0000-0000-0000-00000000000a' : undefined,
  user_id: 'u-1',
  event_type: i % 2 === 0 ? 'task_created' : 'checkout_started',
  entity_type: 'task',
  entity_id: `tk-${i}`,
  payload: {},
  created_at: `2026-10-08T09:${String(59 - i).padStart(2, '0')}:00Z`,
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OverviewPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  paramsState.params = new URLSearchParams();
  mockedGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/api/admin/stats') return STATS;
    if (path.startsWith('/api/admin/analytics?')) return SUMMARY;
    if (path.startsWith('/api/admin/analytics/recent')) return RECENT;
    throw new Error('unexpected GET ' + path);
  });
});

describe('OverviewPage 活动流（批次 3.3）', () => {
  it('渲染最近事件卡片：20 条倒序列表（limit=20 默认）', async () => {
    renderPage();
    expect(await screen.findByText('最近事件')).toBeInTheDocument();
    
    expect(await screen.findByText('task tk-0')).toBeInTheDocument();
    expect(screen.getByText('task tk-19')).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith(
      '/api/admin/analytics/recent?limit=20',
    );
  });

  it('type 过滤：选项来自汇总表类型并集，选中后 query 带 &type= 并重拉', async () => {
    renderPage();
    await screen.findByText('最近事件');

    const trigger = screen.getByRole('combobox', {
      name: '按事件类型过滤活动流',
    });
    fireEvent.click(trigger);
    const option = await screen.findByRole('option', {
      name: 'checkout_started',
    });
    fireEvent.pointerDown(option, { button: 0, pointerType: 'mouse' });
    fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
    fireEvent.click(option);

    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith(
        `/api/admin/analytics/recent?limit=20&type=${encodeURIComponent('checkout_started')}`,
      ),
    );
    
    expect(paramsState.params.get('type')).toBe('checkout_started');
  });

  it('B4：切换统计时间范围后，活动流类型过滤不被重置（选项跨范围累积）', async () => {
    renderPage();
    await screen.findByText('最近事件');

    
    const typeTrigger = screen.getByRole('combobox', {
      name: '按事件类型过滤活动流',
    });
    fireEvent.click(typeTrigger);
    const option = await screen.findByRole('option', {
      name: 'checkout_started',
    });
    fireEvent.pointerDown(option, { button: 0, pointerType: 'mouse' });
    fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
    fireEvent.click(option);
    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith(
        `/api/admin/analytics/recent?limit=20&type=${encodeURIComponent('checkout_started')}`,
      ),
    );

    
    
    const rangeTrigger = screen.getByRole('combobox', { name: '统计时间范围' });
    fireEvent.click(rangeTrigger);
    const range30 = await screen.findByRole('option', { name: '近 30 天' });
    fireEvent.pointerDown(range30, { button: 0, pointerType: 'mouse' });
    fireEvent.pointerUp(range30, { button: 0, pointerType: 'mouse' });
    fireEvent.click(range30);

    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith('/api/admin/analytics?days=30',),
    );
    
    
    await new Promise((r) => setTimeout(r, 50));
    const recentCalls = mockedGet.mock.calls
      .map((c) => String(c[0]))
      .filter((p) => p.startsWith('/api/admin/analytics/recent'));
    expect(recentCalls.length).toBe(2); 
    expect(recentCalls[1]).toContain('type=checkout_started');
    expect(
      screen.getByRole('combobox', { name: '按事件类型过滤活动流' }),
    ).toHaveTextContent('checkout_started');
  });

  it('B8：带 days/type 参数渲染时按 URL 初始化过滤', async () => {
    paramsState.params = new URLSearchParams('days=30&type=task_created');
    renderPage();
    await screen.findByText('最近事件');
    expect(mockedGet).toHaveBeenCalledWith('/api/admin/analytics?days=30');
    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith(
        `/api/admin/analytics/recent?limit=20&type=${encodeURIComponent('task_created')}`,
      ),
    );
  });

  it('空态：该类型无事件时给出换类型提示', async () => {
    mockedGet.mockImplementation(async (path: string) => {
      if (path === '/api/admin/stats') return STATS;
      if (path.startsWith('/api/admin/analytics?')) return SUMMARY;
      if (path.startsWith('/api/admin/analytics/recent')) return [];
      throw new Error('unexpected GET ' + path);
    });
    const { container } = renderPage();
    await waitFor(() =>
      expect(
        container.querySelector('table') ?? container.textContent,
      ).toBeTruthy(),
    );
    
    expect(await screen.findByText('暂无埋点事件')).toBeInTheDocument();
  });

  it('加载失败 → 错误行内展示 + 重试入口', async () => {
    mockedGet.mockImplementation(async (path: string) => {
      if (path === '/api/admin/stats') return STATS;
      if (path.startsWith('/api/admin/analytics?')) return SUMMARY;
      if (path.startsWith('/api/admin/analytics/recent')) {
        throw new Error('db down');
      }
      throw new Error('unexpected GET ' + path);
    });
    renderPage();
    expect(await screen.findByText(/活动流加载失败/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });
});
