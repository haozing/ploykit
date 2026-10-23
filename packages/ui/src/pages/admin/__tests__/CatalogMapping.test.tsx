
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
vi.mock('../../../components/toast', () => ({ toast: toastMocks }));

import { CatalogMapping } from '../CatalogMapping';

// BC-7 契约样例：waffo 目录型 + stripe 临时定价型；pro 年度改价后未同步，
// free 两档未注册（渠道 × 套餐 × [monthly,yearly] 的空位补"未注册"行）
const CHANNELS = {
  channels: [
    {
      name: 'stripe',
      configured: true,
      key_masked: 'sk_***',
      webhook_configured: true,
      capabilities: {
        catalog_based: false,
        supports_cancel_url: true,
        display_order: 20,
        currencies: ['USD'],
      },
      schema: [],
      values: {},
      config_source: 'db',
    },
    {
      name: 'waffo',
      configured: true,
      key_masked: 'pk_***',
      webhook_configured: true,
      capabilities: {
        catalog_based: true,
        supports_cancel_url: false,
        display_order: 10,
        currencies: ['CNY'],
      },
      schema: [],
      values: {},
      config_source: 'db',
    },
  ],
};

const CATALOG = {
  rows: [
    {
      channel: 'waffo',
      plan_code: 'pro',
      interval: 'monthly',
      channel_product_id: 'PROD_M',
      synced_price_cents: 990,
      plan_price_cents: 990,
      synced_at: '2026-10-01T00:00:00Z',
    },
    {
      channel: 'waffo',
      plan_code: 'pro',
      interval: 'yearly',
      channel_product_id: 'PROD_Y',
      synced_price_cents: 9900,
      plan_price_cents: 9900,
      synced_at: '2026-10-01T00:00:00Z',
    },
  ],
  plans: [
    {
      code: 'free',
      name: 'Free',
      currency: 'CNY',
      monthly_cents: 0,
      yearly_cents: 0,
    },
    {
      code: 'pro',
      name: 'Pro',
      currency: 'CNY',
      monthly_cents: 990,
      yearly_cents: 6990,
    },
  ],
};

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CatalogMapping />
    </QueryClientProvider>,
  );
}

// 行内容多片段联合定位（同名套餐在 monthly/yearly 两行都出现）
function rowWith(texts: string[]): HTMLElement {
  const rows = Array.from(document.querySelectorAll('tbody tr'));
  const hit = rows.find((tr) => texts.every((t) => tr.textContent?.includes(t)));
  if (!hit) throw new Error(`row with ${texts.join('+')} not found`);
  return hit as HTMLElement;
}

beforeEach(() => {
  mockedGet.mockReset().mockImplementation(async (path: string) => {
    if (path.startsWith('/api/admin/billing/channels')) return CHANNELS;
    if (path.startsWith('/api/admin/billing/catalog')) return CATALOG;
    throw new Error('unexpected GET ' + path);
  });
  mockedPost.mockReset().mockResolvedValue({ channel_product_id: 'PROD_NEW' });
  toastMocks.success.mockClear();
  toastMocks.error.mockClear();
});

describe('CatalogMapping（BC-7 渠道商品映射）', () => {
  it('目录型渠道 × 套餐 × 周期全组合：已同步/价格待同步/未注册三种状态', async () => {
    renderSection();

    expect(await screen.findByText('渠道商品映射')).toBeInTheDocument();

    // pro/月：渠道价 990 = 套餐价 990 → 已同步
    expect(screen.getByText('已同步')).toBeInTheDocument();
    // pro/年：渠道价 9900 ≠ 套餐价 6990（join plans 算）→ 价格待同步 + 目标价展示
    expect(screen.getByText('价格待同步')).toBeInTheDocument();
    expect(screen.getByText(/→ 目标 ¥69\.90/)).toBeInTheDocument();
    expect(screen.getByText('¥99.00')).toBeInTheDocument();
    // free/月、free/年：无 row → 未注册行
    expect(screen.getAllByText('未注册')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: '注册' })).toHaveLength(2);
    // 已注册行给"同步价格"按钮（2 行）
    expect(
      screen.getAllByRole('button', { name: '同步价格' }),
    ).toHaveLength(2);
    // stripe（非目录型）不参与映射；waffo 4 行（2 套餐 × 2 周期）
    expect(screen.queryByText('stripe')).not.toBeInTheDocument();
    expect(screen.getAllByText('waffo')).toHaveLength(4);
  });

  it('未注册行点注册 → POST register-product（plan_code + interval）', async () => {
    renderSection();
    await screen.findByText('渠道商品映射');

    const freeMonthly = rowWith(['Free', '每月']);
    fireEvent.click(within(freeMonthly).getByRole('button', { name: '注册' }));

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith(
        '/api/admin/billing/channels/waffo/register-product',
        { plan_code: 'free', interval: 'monthly' },
      ),
    );
    expect(toastMocks.success).toHaveBeenCalledWith(
      '已注册 waffo · free（每月）商品',
    );
  });

  it('待同步行点同步价格 → POST sync-price', async () => {
    renderSection();
    await screen.findByText('渠道商品映射');

    const yearly = rowWith(['PROD_Y']);
    fireEvent.click(
      within(yearly).getByRole('button', { name: '同步价格' }),
    );

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith(
        '/api/admin/billing/channels/waffo/sync-price',
        { plan_code: 'pro', interval: 'yearly' },
      ),
    );
    expect(toastMocks.success).toHaveBeenCalledWith(
      '已同步 waffo · pro（每年）价格',
    );
  });

  it('无 catalog_based 渠道 → 整卡隐藏', async () => {
    mockedGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/admin/billing/channels'))
        return { channels: CHANNELS.channels.filter((c) => !c.capabilities.catalog_based) };
      if (path.startsWith('/api/admin/billing/catalog'))
        return { rows: [], plans: CATALOG.plans };
      throw new Error('unexpected GET ' + path);
    });
    const { container } = renderSection();
    // 等渠道请求落地后确认无 section 渲染（避免与"加载中"竞态误判）
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith('/api/admin/billing/catalog'),
    );
    expect(screen.queryByText('渠道商品映射')).not.toBeInTheDocument();
    expect(container.querySelector('section')).toBeNull();
  });

  it('加载失败 → 展示错误与重试', async () => {
    mockedGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/admin/billing/channels')) return CHANNELS;
      if (path.startsWith('/api/admin/billing/catalog'))
        throw new Error('boom');
      throw new Error('unexpected GET ' + path);
    });
    renderSection();
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });
});
