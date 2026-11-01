
import { useState } from 'react';
import { Link } from '../../router';
import { useQuery } from '@tanstack/react-query';
import { DataTable, type Column } from '../../components/DataTable';
import { PageEmpty, PageError, PageHeader } from '../../components/Page';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import { useApi } from '@ploykit/hooks';
import { formatDateTime } from '../../lib/utils';
import { useT } from '../../i18n';
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
  const t = useT();
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
      header: t('admin.sso.colWorkspace'),
      render: (s) => (
        
        
        <div className="min-w-0 max-w-[16rem]">
          <p className="truncate font-medium">
            {/* 原生 title → Tooltip：Trigger render 成 Link（MembersPage Button 挂法，
                render 通道合并悬停/焦点属性，导航行为不变） */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Link
                    to={`/admin/workspaces/${s.workspace_id}`}
                    className="transition-colors hover:text-primary hover:underline"
                  />
                }
              >
                {s.workspace_name || '—'}
              </TooltipTrigger>
              <TooltipContent>{t('admin.sso.goWorkspaceTip')}</TooltipContent>
            </Tooltip>
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
          {/* 截断 mono 值：原生 title → Tooltip，触发器 span+tabIndex=0 保键盘可达
              （UsagePage 先例） */}
          <p className="truncate font-mono text-xs">
            <Tooltip>
              <TooltipTrigger render={<span tabIndex={0} className="cursor-help" />}>
                {s.issuer_url}
              </TooltipTrigger>
              <TooltipContent>{s.issuer_url}</TooltipContent>
            </Tooltip>
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            client_id:{' '}
            <Tooltip>
              <TooltipTrigger render={<span tabIndex={0} className="cursor-help" />}>
                {s.client_id}
              </TooltipTrigger>
              <TooltipContent>{s.client_id}</TooltipContent>
            </Tooltip>
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
            {t('admin.sso.sealed')}
          </Badge>
        ) : (

          <div className="min-w-0">
            <Badge variant="destructive">{t('admin.sso.plaintext')}</Badge>
            {/* 长说明换 Tooltip：常显指引「需重新保存以加密」保持不动（B-sso-2） */}
            <p className="mt-1 max-w-[12rem] truncate text-xs text-destructive">
              <Tooltip>
                <TooltipTrigger render={<span tabIndex={0} className="cursor-help" />}>
                  {t('admin.sso.reencryptHint')}
                </TooltipTrigger>
                <TooltipContent>{t('admin.sso.reencryptTip')}</TooltipContent>
              </Tooltip>
            </p>
          </div>
        ),
    },
    {

      key: 'created_at',
      header: t('admin.sso.colTime'),
      className: 'w-44',
      render: (s) => (
        <div className="whitespace-nowrap text-muted-foreground">
          <p>{formatDateTime(s.created_at)}</p>
          {s.updated_at !== s.created_at && (
            <p className="text-xs">
              {t('admin.sso.updatedAt', { time: formatDateTime(s.updated_at) })}
            </p>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="SSO"
        description={t('admin.sso.description')}
      />
      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
        {t('admin.sso.intro')}
      </p>

      {listQ.isError ? (
        <PageError
          message={adminError(listQ.error, t('admin.sso.loadFailed'))}
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
                <PageEmpty
                  label={t('admin.sso.pastEndLabel')}
                  hint={t('admin.sso.pastEndHint')}
                />
                <Button variant="outline" size="sm" onClick={() => setPage(1)}>
                  {t('admin.sso.backToFirst')}
                </Button>
              </div>
            ) : (
              <PageEmpty
                label={t('admin.sso.emptyLabel')}
                hint={t('admin.sso.emptyHint')}
              />
            )
          }
        />
      )}
    </div>
  );
}
