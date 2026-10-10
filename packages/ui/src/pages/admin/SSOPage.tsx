
import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { DataTable, type Column } from '../../components/DataTable';
import { PageEmpty, PageError, PageHeader } from '../../components/Page';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { useApi } from '@ploykit/hooks';
import { formatDateTime } from '../../lib/utils';
import { ADMIN_PAGE_SIZE, adminError } from './shared';


interface SSOProviderRow {
  workspace_id: string;
  workspace_slug: string;
  workspace_name: string;
  issuer_url: string;
  client_id: string;
  scopes: string;
  secret_sealed: boolean;
  created_at: string;
  updated_at: string;
}

export function SSOPage() {
  const api = useApi();
  const listQ = useQuery({
    queryKey: ['admin', 'sso'],
    queryFn: () => api.get<SSOProviderRow[]>('/api/admin/sso'),
  });
  
  const [page, setPage] = useState(1);
  const all = listQ.data ?? [];
  const total = all.length;
  const rows = all.slice((page - 1) * ADMIN_PAGE_SIZE, page * ADMIN_PAGE_SIZE);
  const pastEnd = !listQ.isPending && rows.length === 0 && page > 1;

  const columns: Column<SSOProviderRow>[] = [
    {
      key: 'workspace',
      header: '工作区',
      render: (s) => (
        
        
        <div className="min-w-0 max-w-[16rem]">
          <p className="truncate font-medium">
            <Link
              to={`/admin/workspaces/${s.workspace_id}`}
              className="transition-colors hover:text-primary hover:underline"
              title="前往该工作区的管理详情页"
            >
              {s.workspace_name || '—'}
            </Link>
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {s.workspace_slug}
          </p>
        </div>
      ),
    },
    {
      key: 'issuer_url',
      header: 'Issuer',
      render: (s) => (
        <div className="min-w-0 max-w-[24rem]">
          <p className="truncate font-mono text-xs" title={s.issuer_url}>
            {s.issuer_url}
          </p>
          <p
            className="truncate font-mono text-xs text-muted-foreground"
            title={s.client_id}
          >
            client_id: {s.client_id}
          </p>
        </div>
      ),
    },
    {
      key: 'secret',
      header: 'client_secret',
      className: 'w-36',
      render: (s) =>
        s.secret_sealed ? (
          <Badge variant="outline" className="text-muted-foreground">
            已加密
          </Badge>
        ) : (
          
          <div className="min-w-0">
            <Badge variant="destructive">明文</Badge>
            <p
              className="mt-1 max-w-[12rem] truncate text-xs text-destructive"
              title="存量明文（迁移 016 时代写入）：部署配置 PLOYKIT_SEAL_KEY 后，到该工作区自助面重新保存一次即可加密"
            >
              需重新保存以加密
            </p>
          </div>
        ),
    },
    {
      
      key: 'created_at',
      header: '配置 / 更新时间',
      className: 'w-44',
      render: (s) => (
        <div className="whitespace-nowrap text-muted-foreground">
          <p>{formatDateTime(s.created_at)}</p>
          {s.updated_at !== s.created_at && (
            <p className="text-xs">更新 {formatDateTime(s.updated_at)}</p>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="SSO"
        description="跨工作区联邦 SSO（OIDC）概览——只读；密钥密封状态与配置归属一览"
      />
      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
        每工作区至多一条联邦 IdP 配置（企业 SSO
        登录入口）。配置的增删改在各工作区 自助面完成（工作区设置 → 联邦
        SSO），管理台不代为操作（点工作区名可直达其管理详情页）；client_secret
        永不回传，此处只展示其密封状态（sealed:v1 加密 / 存量明文警告）。
      </p>

      {listQ.isError ? (
        <PageError
          message={adminError(listQ.error, 'SSO 概览加载失败')}
          onRetry={() => void listQ.refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(s) => s.workspace_id}
          loading={listQ.isPending}
          pagination={{
            page,
            pageSize: ADMIN_PAGE_SIZE,
            total,
            onPageChange: setPage,
          }}
          empty={
            pastEnd ? (
              <div className="flex flex-col items-center gap-2">
                <PageEmpty label="没有更多配置了" hint="当前页数据可能已被删除" />
                <Button variant="outline" size="sm" onClick={() => setPage(1)}>
                  返回第一页
                </Button>
              </div>
            ) : (
              <PageEmpty
                label="无工作区配置联邦 SSO"
                hint="工作区在自助面配置企业 IdP 后会在此出现"
              />
            )
          }
        />
      )}
    </div>
  );
}
