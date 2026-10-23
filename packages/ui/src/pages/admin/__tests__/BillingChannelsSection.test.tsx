
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedGet = vi.hoisted(() => vi.fn());
const mockedPut = vi.hoisted(() => vi.fn());
const mockedPost = vi.hoisted(() => vi.fn());
const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock('@ploykit/client', () => ({
  api: {
    get: mockedGet,
    put: mockedPut,
    post: mockedPost,
    patch: vi.fn(),
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
vi.mock('../../../components/toast', () => ({ toast: toastMocks }));

import { ApiError } from '@ploykit/client';
import {
  BillingChannelsSection,
  webhookUrl,
  type ChannelCard,
} from '../BillingChannelsSection';

// BC-6 契约样例：schema 三分型（text/secret/select）+ "__SET__" 哨兵 + mode=test
function makeChannel(overrides: Partial<ChannelCard> = {}): ChannelCard {
  return {
    name: 'waffo',
    configured: true,
    key_masked: 'pk_***abcd',
    webhook_configured: true,
    capabilities: {
      catalog_based: true,
      supports_cancel_url: false,
      display_order: 10,
      currencies: ['CNY'],
    },
    schema: [
      {
        key: 'merchant_id',
        label: '商户 ID',
        type: 'text',
        required: true,
        help: '渠道后台的商户编号',
        options: null,
      },
      {
        key: 'private_key',
        label: '私钥',
        type: 'secret',
        required: true,
        help: '渠道后台下载的 PEM 私钥',
        options: null,
      },
      {
        key: 'mode',
        label: '模式',
        type: 'select',
        required: false,
        help: 'test 模式不产生真实扣款',
        options: [
          { value: 'test', label: '测试' },
          { value: 'prod', label: '生产' },
        ],
      },
    ],
    values: { merchant_id: 'M_123', private_key: '__SET__', mode: 'test' },
    config_source: 'db',
    ...overrides,
  };
}

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BillingChannelsSection />
    </QueryClientProvider>,
  );
}

function cardOf(name: string): HTMLElement {
  const title = screen.getByText(name, { selector: '[data-slot="card-title"]' });
  const card = title.closest('[data-slot="card"]');
  if (!card) throw new Error(`card of ${name} not found`);
  return card as HTMLElement;
}

beforeEach(() => {
  mockedGet.mockReset().mockResolvedValue({ channels: [makeChannel()] });
  mockedPut.mockReset().mockResolvedValue({});
  mockedPost.mockReset().mockResolvedValue(undefined);
  toastMocks.success.mockClear();
  toastMocks.error.mockClear();
  toastMocks.info.mockClear();
});

describe('BillingChannelsSection（BC-6 渠道配置）', () => {
  it('schema 三分型渲染：text 回填实际值、secret 空值+（已设置）标记、select 显示选项标签', async () => {
    renderSection();
    const card = within(await waitFor(() => cardOf('waffo')));

    // text：用 values 实际值水合（required 星号为 aria-hidden，走可访问名查询）
    const text = card.getByRole('textbox', { name: '商户 ID' });
    expect(text).toHaveValue('M_123');
    expect(text).toHaveAttribute('type', 'text');

    // secret：一律空串回填 + type=password；values==="__SET__" → label 标（已设置）
    const secret = card.getByLabelText(/^私钥（已设置）/);
    expect(secret).toHaveValue('');
    expect(secret).toHaveAttribute('type', 'password');

    // select：options 驱动，trigger 显示选中项（'test' → '测试'；popup 首次
    // 打开前 items 未注册，Base UI 回退显示原始值，两者都算命中）
    const select = card.getByRole('combobox', { name: '模式' });
    expect(select).toHaveTextContent(/test|测试/);

    // 徽标：已配置 / 后台配置（config_source=db）/ 回调验签已配
    expect(card.getByText('已配置')).toBeInTheDocument();
    expect(card.getByText('后台配置')).toBeInTheDocument();
    expect(card.getByText('回调验签已配')).toBeInTheDocument();

    // 留空保持不变 的 secret 帮助文案
    expect(
      card.getByText(/渠道后台下载的 PEM 私钥；留空保持不变/),
    ).toBeInTheDocument();
  });

  it('未配置渠道：灰徽标 + 回调验签未配黄标 + secret 无（已设置）标记 + 测试连接禁用', async () => {
    mockedGet.mockResolvedValue({
      channels: [
        makeChannel({
          name: 'stripe',
          configured: false,
          key_masked: '',
          webhook_configured: false,
          capabilities: {
            catalog_based: false,
            supports_cancel_url: true,
            display_order: 20,
            currencies: ['USD'],
          },
          schema: [
            {
              key: 'secret_key',
              label: 'Secret Key',
              type: 'secret',
              required: true,
              help: '',
              options: null,
            },
          ],
          values: { secret_key: '' },
          config_source: '',
        }),
      ],
    });
    renderSection();
    const card = within(await waitFor(() => cardOf('stripe')));

    expect(card.getByText('未配置')).toBeInTheDocument();
    expect(
      card.queryByText('后台配置'),
    ).not.toBeInTheDocument();
    expect(
      card.queryByText('环境变量'),
    ).not.toBeInTheDocument();
    expect(card.getByText('回调验签未配')).toBeInTheDocument();
    // 未设置（values 为空串）的 secret 不带（已设置）
    expect(card.getByLabelText(/^Secret Key/)).toBeInTheDocument();
    // 未配置 → 测试连接禁用
    expect(
      card.getByRole('button', { name: '测试连接' }),
    ).toBeDisabled();
  });

  it('webhook URL 拼接：origin + /webhooks/billing/{name} 展示 + 复制按钮', async () => {
    // 纯函数（④）
    expect(webhookUrl('https://example.com', 'waffo')).toBe(
      'https://example.com/webhooks/billing/waffo',
    );

    renderSection();
    const card = within(await waitFor(() => cardOf('waffo')));
    expect(
      card.getByText(
        `${window.location.origin}/webhooks/billing/waffo`,
      ),
    ).toBeInTheDocument();
    expect(
      card.getByRole('button', { name: '复制 waffo Webhook URL' }),
    ).toBeInTheDocument();
    expect(
      card.getByText('将此 URL 粘贴到渠道后台的 Webhook 设置。'),
    ).toBeInTheDocument();
  });

  it('保存提交体：secret 留空 → 空串提交（保持不变语义）', async () => {
    renderSection();
    const card = within(await waitFor(() => cardOf('waffo')));

    fireEvent.click(card.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(mockedPut).toHaveBeenCalledWith(
        '/api/admin/billing/channels/waffo',
        {
          fields: { merchant_id: 'M_123', private_key: '', mode: 'test' },
        },
      ),
    );
    expect(toastMocks.success).toHaveBeenCalledWith('渠道 waffo 已保存');
  });

  it('保存提交体：text 改值 + secret 填新值 → 全量 fields 提交', async () => {
    renderSection();
    const card = within(await waitFor(() => cardOf('waffo')));

    fireEvent.change(card.getByRole('textbox', { name: '商户 ID' }), {
      target: { value: 'M_999' },
    });
    fireEvent.change(card.getByLabelText(/^私钥（已设置）/), {
      target: { value: 'NEW-KEY' },
    });
    fireEvent.click(card.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(mockedPut).toHaveBeenCalledWith(
        '/api/admin/billing/channels/waffo',
        {
          fields: { merchant_id: 'M_999', private_key: 'NEW-KEY', mode: 'test' },
        },
      ),
    );
  });

  it('必填校验：清空必填 text → 就地报错不发 PUT（secret 已设置留空合法）', async () => {
    renderSection();
    const card = within(await waitFor(() => cardOf('waffo')));

    fireEvent.change(card.getByRole('textbox', { name: '商户 ID' }), {
      target: { value: '' },
    });
    fireEvent.click(card.getByRole('button', { name: '保存' }));

    expect(await card.findByRole('alert')).toHaveTextContent(
      '必填项未填写：商户 ID',
    );
    expect(mockedPut).not.toHaveBeenCalled();
  });

  it('保存失败（400）→ 就地展示后端校验消息', async () => {
    mockedPut.mockRejectedValueOnce(
      new ApiError(400, 'E_VALIDATION', 'validation failed', 'unknown field: foo'),
    );
    renderSection();
    const card = within(await waitFor(() => cardOf('waffo')));

    fireEvent.click(card.getByRole('button', { name: '保存' }));

    expect(await card.findByRole('alert')).toHaveTextContent(
      'unknown field: foo',
    );
  });

  it('测试连接：POST test-connection → 成功"连接正常"；附带"保存后测试"提示', async () => {
    renderSection();
    const card = within(await waitFor(() => cardOf('waffo')));

    // 小字说明：测试的是已保存配置（未保存的新密钥测的是旧值）
    expect(
      card.getByText(/修改后请先保存再测试/),
    ).toBeInTheDocument();

    fireEvent.click(card.getByRole('button', { name: '测试连接' }));
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith(
        '/api/admin/billing/test-connection',
        { channel: 'waffo' },
      ),
    );
    expect(await card.findByText('连接正常')).toBeInTheDocument();
  });

  it('测试连接失败（4xx 带 err）→ 展示失败原因', async () => {
    mockedPost.mockRejectedValueOnce(
      new ApiError(400, 'E_CHANNEL_TEST', 'invalid merchant credentials'),
    );
    renderSection();
    const card = within(await waitFor(() => cardOf('waffo')));

    fireEvent.click(card.getByRole('button', { name: '测试连接' }));

    expect(await card.findByText(/测试失败/)).toHaveTextContent(
      'invalid merchant credentials',
    );
  });

  it('mode=test 提示条：通用文案 + waffo 测试卡号；非 waffo 只显示通用文案', async () => {
    renderSection();
    const card = within(await waitFor(() => cardOf('waffo')));
    expect(
      card.getByText(/当前为测试模式，不会产生真实扣款/),
    ).toBeInTheDocument();
    expect(card.getByText(/4576 7500 0000 0110/)).toBeInTheDocument();
    expect(card.getByText(/4576 7500 0000 0220/)).toBeInTheDocument();

    // 非 waffo 渠道 test 模式：无测试卡号，仅通用文案
    mockedGet.mockResolvedValue({
      channels: [
        makeChannel({
          name: 'paypal',
          values: { mode: 'test' },
          schema: [
            {
              key: 'mode',
              label: '模式',
              type: 'select',
              required: false,
              help: '',
              options: [
                { value: 'test', label: '测试' },
                { value: 'prod', label: '生产' },
              ],
            },
          ],
        }),
      ],
    });
    renderSection();
    const paypal = within(await waitFor(() => cardOf('paypal')));
    expect(
      paypal.getByText(/当前为测试模式，不会产生真实扣款/),
    ).toBeInTheDocument();
    expect(
      paypal.queryByText(/4576 7500 0000 0110/),
    ).not.toBeInTheDocument();
  });

  it('按 display_order 排序展示', async () => {
    mockedGet.mockResolvedValue({
      channels: [
        makeChannel({
          name: 'zzz-late',
          capabilities: {
            catalog_based: false,
            supports_cancel_url: true,
            display_order: 99,
            currencies: ['USD'],
          },
          schema: [],
          values: {},
        }),
        makeChannel({
          name: 'aaa-early',
          capabilities: {
            catalog_based: false,
            supports_cancel_url: true,
            display_order: 1,
            currencies: ['USD'],
          },
          schema: [],
          values: {},
        }),
      ],
    });
    const { container } = renderSection();
    await waitFor(() => cardOf('zzz-late'));
    const titles = Array.from(
      container.querySelectorAll('[data-slot="card-title"]'),
    ).map((el) => el.textContent);
    expect(titles).toEqual(['aaa-early', 'zzz-late']);
  });
});
