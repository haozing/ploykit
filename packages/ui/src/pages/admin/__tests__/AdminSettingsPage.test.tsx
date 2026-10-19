
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
  mail_mode: 'smtp',
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
    banner_text: '空 = 不展示公告',
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
  it('渲染各卡并按 effective 回填表单（公告预览同步）', async () => {
    renderPage();
    
    expect(await screen.findByText('顶部公告横条')).toBeInTheDocument();
    expect(screen.getByText('全站"维护中"提示条')).toBeInTheDocument();
    expect(screen.getByText('注册开关与域名白名单')).toBeInTheDocument();
    expect(
      screen.getByText('每用户 / 每 IP 限流与豁免名单'),
    ).toBeInTheDocument();
    expect(screen.getByText('SMTP 发信配置')).toBeInTheDocument();
    expect(screen.getByText('搜索引擎站点验证')).toBeInTheDocument();
    expect(screen.getByText('发送测试邮件')).toBeInTheDocument();
    // 基座信封无 oauth 字段 → 登录方式卡不渲染
    expect(screen.queryByText('OAuth 第三方登录')).not.toBeInTheDocument();
    
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

  describe('SMTP 卡（UP-1）', () => {
    const SMTP_EFFECTIVE = {
      smtp_host: 'smtp.example.com',
      smtp_port: '465',
      smtp_user: 'api',
      smtp_pass: '******',
      smtp_from: 'no-reply@example.com',
    };
    function renderWithSmtp() {
      mockedGet.mockResolvedValueOnce({
        ...ENVELOPE,
        effective: { ...ENVELOPE.effective, ...SMTP_EFFECTIVE },
      });
      return renderPage();
    }

    it('掩码回显不回填：smtp_pass 回显 "******"，密码框保持空且 placeholder 为掩码', async () => {
      renderWithSmtp();
      expect(await screen.findByText('SMTP 发信配置')).toBeInTheDocument();
      expect(screen.getByLabelText('SMTP 服务器')).toHaveValue(
        'smtp.example.com',
      );
      expect(screen.getByLabelText('端口（留空 = 缺省 587）')).toHaveValue(
        '465',
      );
      expect(screen.getByLabelText('SMTP 用户名')).toHaveValue('api');
      expect(screen.getByLabelText('发件人地址')).toHaveValue(
        'no-reply@example.com',
      );
      const pass = screen.getByLabelText('SMTP 密码（留空 = 不修改）');
      expect(pass).toHaveValue('');
      expect(pass).toHaveAttribute('placeholder', '******');
      expect(pass).toHaveAttribute('type', 'password');
      // 卡头 Badge 显示 mail_mode
      expect(screen.getByText('SMTP 直发')).toBeInTheDocument();
    });

    it('保存 → PUT 5 键（密码原文只在用户主动输入时提交）', async () => {
      renderWithSmtp();
      await screen.findByText('SMTP 发信配置');

      fireEvent.change(screen.getByLabelText('SMTP 服务器'), {
        target: { value: 'smtp2.example.com' },
      });
      fireEvent.change(screen.getByLabelText('端口（留空 = 缺省 587）'), {
        target: { value: '587' },
      });
      fireEvent.change(screen.getByLabelText('SMTP 用户名'), {
        target: { value: 'api2' },
      });
      fireEvent.change(screen.getByLabelText('SMTP 密码（留空 = 不修改）'), {
        target: { value: 's3cret' },
      });
      fireEvent.change(screen.getByLabelText('发件人地址'), {
        target: { value: 'noreply@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: '保存 SMTP 配置' }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(5));
      expect(mockedPut).toHaveBeenCalledWith('/api/admin/settings/smtp_host', {
        value: 'smtp2.example.com',
      });
      expect(mockedPut).toHaveBeenCalledWith('/api/admin/settings/smtp_port', {
        value: '587',
      });
      expect(mockedPut).toHaveBeenCalledWith('/api/admin/settings/smtp_user', {
        value: 'api2',
      });
      expect(mockedPut).toHaveBeenCalledWith('/api/admin/settings/smtp_pass', {
        value: 's3cret',
      });
      expect(mockedPut).toHaveBeenCalledWith('/api/admin/settings/smtp_from', {
        value: 'noreply@example.com',
      });
    });

    it('空 pass 跳过提交：密码留空保存 → 只 PUT 其余 4 键，绝不提交空/掩码密码', async () => {
      renderWithSmtp();
      await screen.findByText('SMTP 发信配置');

      // 不动密码框（state 恒空），直接保存其余四键
      fireEvent.click(screen.getByRole('button', { name: '保存 SMTP 配置' }));

      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(4));
      expect(mockedPut).toHaveBeenCalledWith('/api/admin/settings/smtp_host', {
        value: 'smtp.example.com',
      });
      expect(mockedPut).toHaveBeenCalledWith('/api/admin/settings/smtp_from', {
        value: 'no-reply@example.com',
      });
      expect(mockedPut).not.toHaveBeenCalledWith(
        '/api/admin/settings/smtp_pass',
        expect.anything(),
      );
    });
  });

  describe('站长验证卡（UP-2）', () => {
    it('空值显示未配置徽章；粘贴完整 meta 标签保存 → PUT site_verification_meta 原文', async () => {
      mockedGet.mockResolvedValueOnce({
        ...ENVELOPE,
        effective: {
          ...ENVELOPE.effective,
          site_verification_meta: '',
        },
      });
      renderPage();
      expect(
        await screen.findByText('搜索引擎站点验证'),
      ).toBeInTheDocument();
      expect(screen.getByText('未配置')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/验证标记/), {
        target: {
          value:
            '<meta name="google-site-verification" content="abc123XYZ" />',
        },
      });
      // 有非空值即点亮"已注入"（同公告卡"展示中"的即时徽章逻辑）
      expect(screen.getByText('已注入')).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole('button', { name: '保存验证配置' }),
      );
      await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
      expect(mockedPut).toHaveBeenCalledWith(
        '/api/admin/settings/site_verification_meta',
        {
          value: '<meta name="google-site-verification" content="abc123XYZ" />',
        },
      );
    });
  });

  describe('OAuth 只读卡（UP-6）', () => {
    const OAUTH = [
      {
        name: 'google',
        callback_url: 'https://example.com/auth/oauth/google/callback',
      },
      {
        name: 'github',
        callback_url: 'https://example.com/auth/oauth/github/callback',
      },
    ];

    it('有 providers → 渲染名称徽章 + mono 回调地址 + 复制按钮 + 反代转发提示', async () => {
      mockedGet.mockResolvedValueOnce({ ...ENVELOPE, oauth: OAUTH });
      renderPage();
      expect(
        await screen.findByText('OAuth 第三方登录'),
      ).toBeInTheDocument();
      expect(screen.getByText('google')).toBeInTheDocument();
      expect(screen.getByText('github')).toBeInTheDocument();
      expect(
        screen.getByText('https://example.com/auth/oauth/google/callback'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: '复制 google 回调地址' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/回调地址按请求 Host 实时生成/),
      ).toBeInTheDocument();
      expect(screen.getByText(/X-Forwarded-Proto/)).toBeInTheDocument();
    });

    it('复制按钮 → clipboard.writeText + toast 反馈', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      mockedGet.mockResolvedValueOnce({
        ...ENVELOPE,
        oauth: [OAUTH[0]],
      });
      renderPage();
      await screen.findByText('OAuth 第三方登录');
      fireEvent.click(
        screen.getByRole('button', { name: '复制 google 回调地址' }),
      );
      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith(
          'https://example.com/auth/oauth/google/callback',
        ),
      );
      await waitFor(() =>
        expect(toastMocks.success).toHaveBeenCalledWith(
          'google 回调地址已复制',
        ),
      );
      vi.unstubAllGlobals();
    });

    it('空数组 → 渲染空态提示（用 GOOGLE/GITHUB_CLIENT_ID/SECRET 环境变量启用）', async () => {
      mockedGet.mockResolvedValueOnce({ ...ENVELOPE, oauth: [] });
      renderPage();
      await screen.findByText('OAuth 第三方登录');
      expect(screen.getByText('未启用')).toBeInTheDocument();
      expect(screen.getByText(/GOOGLE_CLIENT_ID/)).toBeInTheDocument();
      expect(screen.getByText(/GITHUB_CLIENT_ID/)).toBeInTheDocument();
    });

    it('信封无 oauth 字段 → 整卡不渲染（后端未接线时静默降级）', async () => {
      renderPage();
      await screen.findByText('顶部公告横条');
      expect(screen.queryByText('OAuth 第三方登录')).not.toBeInTheDocument();
      expect(screen.queryByText('登录方式')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /复制.*回调地址/ }),
      ).not.toBeInTheDocument();
    });
  });
});
