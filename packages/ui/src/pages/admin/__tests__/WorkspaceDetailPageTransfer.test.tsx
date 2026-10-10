
import '@testing-library/jest-dom/vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedGet = vi.hoisted(() => vi.fn());
const mockedPost = vi.hoisted(() => vi.fn());
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


vi.mock('../../../../../hooks/src/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'op-admin', email: 'op@test.local' },
    loading: false,
  }),
}));

vi.mock('react-router', () => ({
  useParams: () => ({ id: 'ws-1' }),
  useNavigate: () => () => {},
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import { WorkspaceDetailPage } from '../WorkspaceDetailPage';
// fail-fast 后 useConfirm 无 Provider 即抛错：此测试直接渲染页面，须包 ConfirmProvider
import { ConfirmProvider } from '../../../components/ConfirmDialog';

const DETAIL = {
  id: 'ws-1',
  slug: 'acme',
  name: 'Acme',
  plan_code: 'free',
  member_count: 3,
  created_at: '2026-09-01T08:00:00Z',
  members: [
    {
      user_id: 'alice',
      email: 'alice@t.co',
      display_name: 'Alice',
      role: 'owner',
      created_at: '2026-09-01T08:00:00Z',
    },
    {
      user_id: 'bob',
      email: 'bob@t.co',
      display_name: 'Bob',
      role: 'member',
      created_at: '2026-09-02T08:00:00Z',
    },
    
    {
      user_id: 'op-admin',
      email: 'op@test.local',
      display_name: 'Op',
      role: 'admin',
      created_at: '2026-09-03T08:00:00Z',
    },
  ],
};

function rowOf(email: string): HTMLElement {
  const row = screen.getByText(email).closest('tr');
  if (!row) throw new Error(`row of ${email} not found`);
  return row;
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <WorkspaceDetailPage />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset().mockResolvedValue(DETAIL);
  mockedPost.mockReset().mockResolvedValue({ status: 'ok' });
});

describe('WorkspaceDetailPage · 转让所有权', () => {
  it('member/admin 行有"转让所有权"，owner 行与自己没有', async () => {
    renderPage();

    await screen.findByText('alice@t.co');
    
    expect(
      within(rowOf('bob@t.co')).getByRole('button', { name: '转让所有权' }),
    ).toBeInTheDocument();
    
    expect(
      within(rowOf('op@test.local')).queryByRole('button', {
        name: '转让所有权',
      }),
    ).not.toBeInTheDocument();
    
    expect(
      within(rowOf('alice@t.co')).queryByRole('button', { name: '转让所有权' }),
    ).not.toBeInTheDocument();
  });

  it('ImpactConfirmation 列明降级影响 → 勾选后 POST transfer-ownership', async () => {
    renderPage();
    await screen.findByText('bob@t.co');

    fireEvent.click(
      within(rowOf('bob@t.co')).getByRole('button', { name: '转让所有权' }),
    );

    
    expect(
      await screen.findByText('转让 Acme 的所有权给 bob@t.co'),
    ).toBeInTheDocument();
    expect(screen.getByText(/alice@t\.co 将降为 member/)).toBeInTheDocument();
    expect(screen.getByText(/始终保有 owner/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/我理解并接受以上影响/));
    fireEvent.click(screen.getByRole('button', { name: '确认转让' }));

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith(
        '/api/admin/workspaces/ws-1/transfer-ownership',
        {
          user_id: 'bob',
        },
      ),
    );
  });

  it('不勾选接受影响 → 确认按钮禁用，不发 POST', async () => {
    renderPage();
    await screen.findByText('bob@t.co');

    fireEvent.click(
      within(rowOf('bob@t.co')).getByRole('button', { name: '转让所有权' }),
    );
    expect(
      await screen.findByRole('button', { name: '确认转让' }),
    ).toBeDisabled();
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
