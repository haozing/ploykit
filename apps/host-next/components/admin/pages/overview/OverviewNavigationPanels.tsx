import Link from 'next/link';
import { AdminPanel, SegmentedWorkspace } from '@host/components/admin/shared/AdminPrimitives';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';

export function QuickActionPanel({ lang }: { lang: SupportedLanguage }) {
  const copy = {
    zh: {
      title: '快捷动作',
      description: '常用入口按操作目的分组，避免首页只剩状态和图表。',
      actions: [
        ['查看用户', '/admin/users', '账号、验证和会话'],
        ['查看角色', '/admin/rbac', '权限、成员和高风险授权'],
        ['查看账单', '/admin/billing', '订单、权益和订阅'],
        ['查看文件', '/admin/files', '存储、隔离和孤立对象'],
        ['查看服务', '/admin/service-connections', '连接、证据和密钥轮换'],
        ['查看队列', '/admin/webhooks', 'Outbox、回执和死信'],
        ['查看运行', '/admin/runs', '任务、失败和重排队'],
        ['查看模块', '/admin/modules', '安装、生命周期和发布证据'],
        ['查看设置', '/admin/settings', '运行配置和主题治理'],
      ] as const,
    },
    en: {
      title: 'Quick actions',
      description:
        'Common entry points are grouped by intent so the homepage does not devolve into charts alone.',
      actions: [
        ['Users', '/admin/users', 'Accounts, verification, and sessions'],
        ['Roles', '/admin/rbac', 'Permissions, members, and risky grants'],
        ['Billing', '/admin/billing', 'Orders, entitlements, and subscriptions'],
        ['Files', '/admin/files', 'Storage, quarantine, and orphan objects'],
        ['Services', '/admin/service-connections', 'Connections, evidence, and secret rotation'],
        ['Webhooks', '/admin/webhooks', 'Outbox, receipts, and dead letters'],
        ['Runs', '/admin/runs', 'Jobs, failures, and requeue'],
        ['Modules', '/admin/modules', 'Installs, lifecycle, and release evidence'],
        ['Settings', '/admin/settings', 'Runtime config and theme governance'],
      ] as const,
    },
  }[lang];

  return (
    <AdminPanel title={copy.title} description={copy.description}>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {copy.actions.map(([label, href, detail]) => (
          <Link
            key={href}
            href={localizedPath(lang, href)}
            className="group flex min-h-20 flex-col justify-between rounded-admin-md border border-admin-border bg-admin-bg/45 p-3 transition hover:border-admin-primary/25 hover:bg-admin-primary-soft"
          >
            <div className="min-w-0">
              <span className="block truncate text-sm font-semibold text-admin-text">
                {adminInlineText(lang, label)}
              </span>
              <span className="mt-1 block text-xs leading-5 text-admin-text-muted">
                {adminInlineText(lang, detail)}
              </span>
            </div>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-admin-primary">
              {adminInlineText(lang, adminInlineText(lang, 'open_a211eefa'))}
              <span aria-hidden>→</span>
            </span>
          </Link>
        ))}
      </div>
    </AdminPanel>
  );
}

export function AudienceWorkspace({ lang }: { lang: SupportedLanguage }) {
  const sections = [
    {
      key: 'operations',
      label: adminInlineText(lang, 'operations_7ae661f1'),
      count: '3',
      content: (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {[
            [
              adminInlineText(lang, 'user_review_38aad4ec'),
              '/admin/users?status=pending-verification',
            ],
            [adminInlineText(lang, 'failed_runs_2eed30e4'), '/admin/runs?status=failed'],
            [adminInlineText(lang, 'dead_letters_b58834c8'), '/admin/webhooks?status=dead_letter'],
          ].map(([label, href]) => (
            <Link
              key={href}
              href={localizedPath(lang, href)}
              className="rounded-admin-md border border-admin-border bg-admin-bg/45 px-3 py-2 text-sm font-medium text-admin-text transition hover:border-admin-primary/25 hover:bg-admin-primary-soft"
            >
              {label}
            </Link>
          ))}
        </div>
      ),
    },
    {
      key: 'commerce',
      label: adminInlineText(lang, 'commerce_ffe5812b'),
      count: '3',
      content: (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {[
            [
              adminInlineText(lang, 'failed_orders_453ed2d8'),
              '/admin/billing?type=orders&status=failed',
            ],
            [
              adminInlineText(lang, 'revoked_grants_792a3c9e'),
              '/admin/entitlements?status=revoked',
            ],
            [adminInlineText(lang, 'revenue_pulse_b40977f0'), '/admin/revenue'],
          ].map(([label, href]) => (
            <Link
              key={href}
              href={localizedPath(lang, href)}
              className="rounded-admin-md border border-admin-border bg-admin-bg/45 px-3 py-2 text-sm font-medium text-admin-text transition hover:border-admin-primary/25 hover:bg-admin-primary-soft"
            >
              {label}
            </Link>
          ))}
        </div>
      ),
    },
    {
      key: 'platform',
      label: adminInlineText(lang, 'platform_b218b539'),
      count: '3',
      content: (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {[
            [adminInlineText(lang, 'service_connections_d365945f'), '/admin/service-connections'],
            [adminInlineText(lang, 'module_health_406d1a74'), '/admin/modules?status=error'],
            [adminInlineText(lang, 'config_audit_aa98bcad'), '/admin/settings'],
          ].map(([label, href]) => (
            <Link
              key={href}
              href={localizedPath(lang, href)}
              className="rounded-admin-md border border-admin-border bg-admin-bg/45 px-3 py-2 text-sm font-medium text-admin-text transition hover:border-admin-primary/25 hover:bg-admin-primary-soft"
            >
              {label}
            </Link>
          ))}
        </div>
      ),
    },
  ] as const;

  return (
    <SegmentedWorkspace
      lang={lang}
      title={adminInlineText(lang, 'browse_by_audience_a0b96fae')}
      description={adminInlineText(
        lang,
        'operations_commerce_and_platform_entry_points_are_se_2784bd2c'
      )}
      sections={sections}
    />
  );
}
