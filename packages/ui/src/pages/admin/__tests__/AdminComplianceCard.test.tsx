import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

import { ApiError } from '@ploykit/client';
import {
  AdminComplianceCard,
  type AdminComplianceEnvelope,
} from '../AdminComplianceCard';

// LC-9 lite 契约样例：一缺键（红灯）+ legal_config 现状 + checks 三色各一
const ENVELOPE: AdminComplianceEnvelope = {
  missing_keys: [
    {
      key: 'legal_entity_name',
      description: '法定名称（个人姓名或公司注册名）',
    },
  ],
  legal_config: {
    entity_name: '',
    jurisdiction: 'the laws of Singapore',
    processor_name: 'Waffo Pancake',
    billing_model: 'v1_subscription',
  },
  checks: [
    { id: 'export', label: 'DSAR 导出端点', status: 'ok' },
    { id: 'retention', label: '保留期清扫最近运行', status: 'warn' },
    {
      id: 'refund_policy',
      label: '退款政策（渠道侧配置）',
      status: 'manual',
      detail: '退款文案单一真源在渠道店铺设置，框架侧只提示不代填',
    },
  ],
};

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdminComplianceCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset().mockResolvedValue(ENVELOPE);
});

describe('AdminComplianceCard', () => {
  it('pending：就地渲染加载态，请求 GET /api/admin/legal/compliance', () => {
    mockedGet.mockReturnValue(new Promise(() => {}));
    renderCard();
    expect(screen.getByText('加载合规状态中…')).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith('/api/admin/legal/compliance');
  });

  it('加载失败：PageError 呈现友好文案并支持重试', async () => {
    mockedGet.mockRejectedValueOnce(
      new ApiError(500, 'E_INTERNAL', 'internal error'),
    );
    renderCard();
    expect(
      await screen.findByText(
        '服务暂时不可用，请稍后重试；若持续出现请联系平台管理员',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
  });

  it('缺键红灯：key+description 逐行呈现，徽标计缺，legal_config 现状对照', async () => {
    renderCard();
    expect(await screen.findByText('Compliance')).toBeInTheDocument();
    expect(screen.getByText('缺 1 项法务配置')).toBeInTheDocument();
    expect(screen.getByText('legal_entity_name')).toBeInTheDocument();
    expect(
      screen.getByText('法定名称（个人姓名或公司注册名）'),
    ).toBeInTheDocument();
    // 红灯的对照上下文：其余三项已填值如实展示
    expect(screen.getByText('the laws of Singapore')).toBeInTheDocument();
    expect(screen.getByText('Waffo Pancake')).toBeInTheDocument();
    expect(screen.getByText('v1_subscription')).toBeInTheDocument();
  });

  it('checks 三色状态行：ok/warn/manual 各自色调 + manual 附 detail', async () => {
    renderCard();
    expect(await screen.findByText('DSAR 导出端点')).toBeInTheDocument();
    expect(screen.getByText('正常')).toBeInTheDocument();
    expect(screen.getByText('保留期清扫最近运行')).toBeInTheDocument();
    expect(screen.getByText('注意')).toBeInTheDocument();
    expect(screen.getByText('退款政策（渠道侧配置）')).toBeInTheDocument();
    expect(screen.getByText('人工')).toBeInTheDocument();
    expect(
      screen.getByText('退款文案单一真源在渠道店铺设置，框架侧只提示不代填'),
    ).toBeInTheDocument();
  });

  it('无缺键：不渲染红灯块，徽标为完整', async () => {
    mockedGet.mockResolvedValueOnce({ ...ENVELOPE, missing_keys: [] });
    renderCard();
    expect(await screen.findByText('法务配置完整')).toBeInTheDocument();
    expect(
      screen.queryByText('未填写的法务配置'),
    ).not.toBeInTheDocument();
  });
});
