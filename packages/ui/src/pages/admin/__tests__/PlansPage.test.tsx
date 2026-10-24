
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
    details?: unknown;
    constructor(
      status: number,
      code: string,
      message: string,
      details?: unknown,
    ) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  },
}));

import { ApiError } from '@ploykit/client';
import { PlansPage } from '../PlansPage';
import { BILLING_CATALOG_QUERY_KEY } from '../CatalogMapping';

const PLANS = {
  items: ['free', 'pro'],
  plans: [
    {
      code: 'free',
      name: 'Free',
      currency: 'CNY',
      trial_days: 0,
      sort_no: 1,
      limits: { workspaces: 1, tasks_monthly: 100 },
    },
    {
      code: 'pro',
      name: 'Pro',
      currency: 'USD',
      trial_days: 14,
      sort_no: 2,
      limits: { workspaces: -1, price_monthly_cents: 990 },
    },
  ],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PlansPage />
    </QueryClientProvider>,
  );
}

function expandPro() {
  fireEvent.click(screen.getByRole('button', { name: '编辑套餐 pro' }));
}

beforeEach(() => {
  mockedGet.mockReset().mockImplementation(async (path: string) => {
    if (path.startsWith('/api/admin/plans')) return PLANS;
    // BC-6：PlansPage 下方新增的渠道区块（空数据=不渲染渠道卡/映射表，
    // 不与本文件聚焦的套餐编辑断言互相干扰）
    if (path.startsWith('/api/admin/billing/channels'))
      return { channels: [] };
    if (path.startsWith('/api/admin/billing/catalog'))
      return { rows: [], plans: [] };
    throw new Error('unexpected GET ' + path);
  });
  mockedPatch.mockReset().mockResolvedValue(PLANS.plans[1]);
});

describe('PlansPage（UP-5 套餐编辑）', () => {
  it('渲染套餐列表：free/pro 两卡折叠态（名称/代码/币种/排序可见，表单未挂载）', async () => {
    renderPage();
    expect(await screen.findByText('Free')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('free')).toBeInTheDocument();
    expect(screen.getByText('pro')).toBeInTheDocument();
    expect(screen.getByText('CNY')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
    // 折叠态：编辑表单不存在
    expect(screen.queryByLabelText('名称')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '保存' }),
    ).not.toBeInTheDocument();
  });

  it('展开 pro 编辑保存 → PATCH /api/admin/plans/pro 全量 body；-1 显示 Unlimited 提示', async () => {
    renderPage();
    await screen.findByText('Pro');
    expandPro();

    // workspaces: -1 → Unlimited（无限）提示；price_monthly_cents → 价格（单位：分）
    expect(await screen.findByText('Unlimited（无限）')).toBeInTheDocument();
    expect(screen.getByText('价格（单位：分）')).toBeInTheDocument();
    // workspaces 是 billing 未登记键 → 高级键弱提示
    expect(screen.getAllByText('高级键')).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('名称'), {
      target: { value: '专业版' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(mockedPatch).toHaveBeenCalledWith('/api/admin/plans/pro', {
        name: '专业版',
        currency: 'USD',
        sort_no: 2,
        limits: { workspaces: -1, price_monthly_cents: 990 },
      }),
    );
  });

  it('保存 404（plan 不存在）→ 就地展示后端消息', async () => {
    mockedPatch.mockRejectedValueOnce(
      new ApiError(404, 'not_found', 'plan not found'),
    );
    renderPage();
    await screen.findByText('Pro');
    expandPro();
    fireEvent.click(await screen.findByRole('button', { name: '保存' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '不存在或无权访问',
    );
  });

  it('保存 400（校验失败）→ 就地展示后端校验消息', async () => {
    mockedPatch.mockRejectedValueOnce(
      new ApiError(
        400,
        'E_VALIDATION',
        'validation failed',
        'currency: must be 3 uppercase letters',
      ),
    );
    renderPage();
    await screen.findByText('Pro');
    expandPro();
    fireEvent.click(await screen.findByRole('button', { name: '保存' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'currency: must be 3 uppercase letters',
    );
  });

  it('limits 加行：添加 credits=100 并保存 → body 含新键；未知键给高级键提示', async () => {
    renderPage();
    await screen.findByText('Pro');
    expandPro();

    const keys = () => screen.getAllByLabelText('限制键名');
    expect(await screen.findAllByLabelText('限制键名')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '添加限制键' }));
    expect(keys()).toHaveLength(3);

    fireEvent.change(keys()[2], { target: { value: 'credits' } });
    fireEvent.change(screen.getAllByLabelText('限制值')[2], {
      target: { value: '100' },
    });
    // workspaces + credits 两个未登记键 → 两个高级键提示
    expect(screen.getAllByText('高级键')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(mockedPatch).toHaveBeenCalledWith('/api/admin/plans/pro', {
        name: 'Pro',
        currency: 'USD',
        sort_no: 2,
        limits: { workspaces: -1, price_monthly_cents: 990, credits: 100 },
      }),
    );
  });

  it('limits 减行：删除空行与 workspaces 行后保存 → body 不再含该键', async () => {
    renderPage();
    await screen.findByText('Pro');
    expandPro();

    const keys = () => screen.getAllByLabelText('限制键名');
    expect(await screen.findAllByLabelText('限制键名')).toHaveLength(2);

    // 误触加行再删行：整行留空不阻塞保存，也不进 body
    fireEvent.click(screen.getByRole('button', { name: '添加限制键' }));
    expect(keys()).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '删除限制 3' }));
    expect(keys()).toHaveLength(2);

    fireEvent.click(
      screen.getByRole('button', { name: '删除限制 workspaces' }),
    );
    expect(keys()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(mockedPatch).toHaveBeenCalledWith('/api/admin/plans/pro', {
        name: 'Pro',
        currency: 'USD',
        sort_no: 2,
        limits: { price_monthly_cents: 990 },
      }),
    );
  });

  // 同页改价后"渠道商品映射"的已同步/目标价比对全部 join catalog 的套餐价，
  // 保存套餐必须把 billing-catalog 键一并失效（否则映射表仍按旧价比对）
  it('保存成功 → 同时失效 plans 与 billing-catalog 两个查询键', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    render(
      <QueryClientProvider client={qc}>
        <PlansPage />
      </QueryClientProvider>,
    );
    await screen.findByText('Pro');
    expandPro();
    fireEvent.click(await screen.findByRole('button', { name: '保存' }));

    await waitFor(() => expect(mockedPatch).toHaveBeenCalled());
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['admin', 'plans'],
      }),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: BILLING_CATALOG_QUERY_KEY,
      }),
    );
  });
});
