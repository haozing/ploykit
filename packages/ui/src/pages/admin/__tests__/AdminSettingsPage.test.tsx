
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminSettingsPage } from '../AdminSettingsPage';

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
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));
vi.mock('../../../components/toast', () => ({ toast: toastMocks }));

const ENVELOPE = {
  items: { banner_text: '今晚例行维护', banner_kind: 'warn' },
  effective: {
    banner_text: '今晚例行维护',
    banner_kind: 'warn',
    maintenance_mode: '0',
    allow_signup: '1',
    allowed_domains: '',
  },
  defaults: {
    banner_text: '',
    banner_kind: 'info',
    maintenance_mode: '0',
    allow_signup: '1',
    allowed_domains: '',
  },
  descriptions: {
    banner_text: '站点公告文本（空 = 无公告）',
    banner_kind: '公告样式',
    maintenance_mode: '维护模式说明',
    allow_signup: '注册开关说明',
    allowed_domains: '域名白名单说明',
  },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdminSettingsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset().mockResolvedValue(ENVELOPE);
  mockedPut.mockReset().mockResolvedValue({ key: '', value: '' });
  mockedPost.mockReset().mockResolvedValue({ mode: 'smtp', status: 'sent' });
});

describe('AdminSettingsPage', () => {
  it('渲染四卡并按 effective 回填表单（公告预览同步）', async () => {
    renderPage();
    
    expect(await screen.findByText('顶部公告横条')).toBeInTheDocument();
    expect(screen.getByText('全站"维护中"提示条')).toBeInTheDocument();
    expect(screen.getByText('注册开关与域名白名单')).toBeInTheDocument();
    expect(screen.getByText('发送测试邮件')).toBeInTheDocument();
    
    expect(screen.getByLabelText('公告文本')).toHaveValue('今晚例行维护');
    expect(screen.getByRole('status')).toHaveTextContent('今晚例行维护');
    expect(screen.getByText('展示中')).toBeInTheDocument();
    expect(screen.getByText('开放注册')).toBeInTheDocument();
    
    expect(mockedGet).toHaveBeenCalledWith('/api/admin/settings');
  });

  it('修改公告并保存 → PUT banner_text + banner_kind 两键', async () => {
    renderPage();
    await screen.findByText('顶部公告横条');
    fireEvent.change(screen.getByLabelText('公告文本'), {
      target: { value: '新公告：本周日停机' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存公告' }));

    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(2));
    expect(mockedPut).toHaveBeenCalledWith('/api/admin/settings/banner_text', {
      value: '新公告：本周日停机',
    });
    expect(mockedPut).toHaveBeenCalledWith('/api/admin/settings/banner_kind', {
      value: 'warn',
    });
    
    expect(screen.getByRole('status')).toHaveTextContent('新公告：本周日停机');
  });

  it('保存域名白名单 → PUT allowed_domains', async () => {
    renderPage();
    await screen.findByText('注册开关与域名白名单');
    fireEvent.change(screen.getByLabelText(/域名白名单/), {
      target: { value: 'corp.com, edu.cn' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存白名单' }));

    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
    expect(mockedPut).toHaveBeenCalledWith(
      '/api/admin/settings/allowed_domains',
      {
        value: 'corp.com, edu.cn',
      },
    );
  });

  it('发送测试邮件 → POST test-email；dev 通道提示看日志', async () => {
    mockedPost.mockResolvedValueOnce({
      mode: 'dev',
      hint: '当前为开发邮件通道（emaildev）：邮件内容已打日志，请到后端日志查看，真实邮箱不会收到',
    });
    renderPage();
    await screen.findByText('发送测试邮件');
    fireEvent.change(screen.getByLabelText('测试邮件收件邮箱'), {
      target: { value: 'ops@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(mockedPost).toHaveBeenCalledWith('/api/admin/settings/test-email', {
      to: 'ops@example.com',
    });
    expect(await screen.findByText(/后端日志查看/)).toBeInTheDocument();
  });

  it('测试邮件失败 → 展示错误结果，不静默', async () => {
    mockedPost.mockRejectedValueOnce(new Error('smtp connect refused'));
    renderPage();
    await screen.findByText('发送测试邮件');
    fireEvent.change(screen.getByLabelText('测试邮件收件邮箱'), {
      target: { value: 'ops@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText(/发送失败/)).toBeInTheDocument();
  });

  
  it('限流卡：按 effective 回填三键', async () => {
    mockedGet.mockResolvedValueOnce({
      ...ENVELOPE,
      effective: {
        ...ENVELOPE.effective,
        rate_limit_per_user_per_min: '600',
        rate_limit_per_ip_per_min: '60',
        rate_limit_allowlist: '10.0.0.5, 192.168.0.0/16',
      },
    });
    renderPage();
    expect(
      await screen.findByText('每用户 / 每 IP 限流与豁免名单'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('每用户请求/分（0 = 关闭）')).toHaveValue('600');
    expect(
      screen.getByLabelText('每 IP 请求/分（认证路径；0 = 关闭）'),
    ).toHaveValue('60');
    expect(screen.getByLabelText(/豁免名单/)).toHaveValue(
      '10.0.0.5, 192.168.0.0/16',
    );
    expect(screen.getByText('启用中')).toBeInTheDocument();
  });

  it('保存限流配置 → PUT 三键（user/ip/allowlist）', async () => {
    renderPage();
    await screen.findByText('每用户 / 每 IP 限流与豁免名单');

    fireEvent.change(screen.getByLabelText('每用户请求/分（0 = 关闭）'), {
      target: { value: '600' },
    });
    fireEvent.change(
      screen.getByLabelText('每 IP 请求/分（认证路径；0 = 关闭）'),
      { target: { value: '30' } },
    );
    fireEvent.change(screen.getByLabelText(/豁免名单/), {
      target: { value: '10.0.0.5' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存限流配置' }));

    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(3));
    expect(mockedPut).toHaveBeenCalledWith(
      '/api/admin/settings/rate_limit_per_user_per_min',
      { value: '600' },
    );
    expect(mockedPut).toHaveBeenCalledWith(
      '/api/admin/settings/rate_limit_per_ip_per_min',
      { value: '30' },
    );
    expect(mockedPut).toHaveBeenCalledWith(
      '/api/admin/settings/rate_limit_allowlist',
      { value: '10.0.0.5' },
    );
  });

  it('B-settings-10：限流空值/非法值 → 拒绝保存并就地提示（不再静默按 0 落库）', async () => {
    renderPage();
    await screen.findByText('每用户 / 每 IP 限流与豁免名单');

    
    fireEvent.change(screen.getByLabelText('每用户请求/分（0 = 关闭）'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存限流配置' }));

    expect(
      await screen.findByText('每用户限流：不能留空：填写 0 表示关闭限流'),
    ).toBeInTheDocument();
    expect(mockedPut).not.toHaveBeenCalled();

    
    fireEvent.change(screen.getByLabelText('每用户请求/分（0 = 关闭）'), {
      target: { value: 'abc' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存限流配置' }));
    expect(
      await screen.findByText(/每用户限流：必须是 0\.\.100000 的整数/),
    ).toBeInTheDocument();
    expect(mockedPut).not.toHaveBeenCalled();
  });

  it('B-settings-1：限流三键部分失败 → 如实汇报部分写入（成功键已生效）', async () => {
    mockedPut.mockImplementation(async (url: string) => {
      if (url.endsWith('rate_limit_per_ip_per_min')) {
        throw new Error('必须是 0..100000 的整数');
      }
      return {};
    });
    renderPage();
    await screen.findByText('每用户 / 每 IP 限流与豁免名单');

    fireEvent.click(screen.getByRole('button', { name: '保存限流配置' }));
    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalled());
    const msg = toastMocks.error.mock.calls[0][0] as string;
    expect(msg).toContain('部分保存');
    expect(msg).toContain('成功 2/3');
    expect(msg).toContain('每 IP 限流');
  });
});
