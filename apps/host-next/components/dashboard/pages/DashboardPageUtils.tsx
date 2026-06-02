import type { ReactNode } from 'react';
import { HOST_BILLING_SKUS, HOST_PLAN_CATALOG } from '@host/lib/commercial-provider';
import { DEFAULT_HOST_PRODUCT_ID, DEFAULT_HOST_WORKSPACE_ID } from '@host/lib/default-scope';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { dashboardInlineText } from '@host/lib/dashboard-copy';
import { formatCurrencyMinor } from '@host/lib/i18n-format';
import type { SupportedLanguage } from '@host/lib/i18n';
import type { HostFileStorageStatus } from '@host/lib/files';
import type { RuntimeStoreNotificationRecord } from '@/lib/module-runtime';

export const billingSkuNames: ReadonlyMap<string, string> = new Map(
  HOST_BILLING_SKUS.map((sku) => [sku.id, sku.name])
);
export const billingPlanNames: ReadonlyMap<string, string> = new Map(
  HOST_PLAN_CATALOG.map((plan) => [plan.id, plan.name])
);

export function formatBillingSku(sku: string): string {
  return billingSkuNames.get(sku) ?? sku;
}

export function formatBillingPlan(lang: SupportedLanguage, planId: string | undefined): string {
  if (!planId) {
    return dashboardInlineText(lang, 'free_42f97715');
  }
  return billingPlanNames.get(planId) ?? dashboardInlineText(lang, 'current_plan_45e3ad53');
}

export function formatProductLabel(
  lang: SupportedLanguage,
  productId: string | null | undefined
): string {
  if (!productId) {
    return adminInlineText(lang, 'Default product');
  }
  return productId === DEFAULT_HOST_PRODUCT_ID
    ? adminInlineText(lang, 'Default product')
    : productId;
}

export function formatWorkspaceLabel(
  lang: SupportedLanguage,
  workspaceId: string | null | undefined
): string {
  if (!workspaceId) {
    return adminInlineText(lang, 'Default workspace');
  }
  return workspaceId === DEFAULT_HOST_WORKSPACE_ID
    ? adminInlineText(lang, 'Default workspace')
    : workspaceId;
}

export function formatWorkspaceDisplayName(
  lang: SupportedLanguage,
  name: string | null | undefined
): string {
  const normalized = String(name ?? '').trim();
  if (!normalized) {
    return adminInlineText(lang, 'Default workspace');
  }
  const localizedNames: Record<string, string> = {
    'Default Workspace': 'workspace_name_default_1f9f0d11',
    'Team Main': 'workspace_name_team_main_93a67cf4',
    'Team Lab': 'workspace_name_team_lab_7d9f2c0a',
  };
  const localizedName = localizedNames[normalized];
  return localizedName ? dashboardInlineText(lang, localizedName) : normalized;
}

export function formatDashboardModuleLabel(lang: SupportedLanguage, moduleId: string): string {
  return moduleId === 'web-shell' ? adminInlineText(lang, 'Workspace') : moduleId;
}

export const dashboardPrimaryButtonClass =
  'inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-admin-md bg-admin-primary px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-950/10 transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50';
export const dashboardGhostButtonClass =
  'inline-flex min-h-8 items-center justify-center whitespace-nowrap rounded-admin-md px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50';

export type UserTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

export const userToneClass: Record<UserTone, string> = {
  neutral: 'border-admin-border bg-admin-surface-muted text-admin-text-muted',
  primary: 'border-admin-primary/20 bg-admin-primary/10 text-admin-primary',
  success: 'border-admin-success/25 bg-admin-success/10 text-admin-success',
  warning: 'border-admin-warning/25 bg-admin-warning/10 text-admin-warning',
  danger: 'border-admin-danger/25 bg-admin-danger/10 text-admin-danger',
};

export function friendlyStatusLabel(
  lang: SupportedLanguage,
  value: string | null | undefined
): string {
  const normalized = String(value ?? '').toLowerCase();
  const labels: Record<string, string> = {
    active: 'active_e8a4041b',
    accepted: 'accepted_d6eaf321',
    available: 'available_e21a3cf6',
    archived: 'archived_797d98cb',
    canceled: 'canceled_63d8fe18',
    cancel_requested: 'canceling_fccaf875',
    created: 'created_d8278ec8',
    deleted: 'deleted_152a0ec4',
    disabled: 'disabled_475ec81f',
    draft: 'draft_061b35fb',
    expired: 'expired_b75ba2e1',
    failed: 'failed_1dad4921',
    inactive: 'inactive_84e2b542',
    missing: 'needs_attention_7cc748e2',
    open: 'open_c7300fb7',
    paid: 'completed_58782c56',
    pending: 'pending_a85c6ad6',
    'pending-verification': 'pending_verification_0436cf10',
    published: 'published_416cccb7',
    quarantined: 'needs_review_edd7a2ee',
    queued: 'queued_61a7726c',
    read: 'read_19b1eb84',
    ready: 'ready_0db0c52c',
    refunded: 'refunded_bfcf17a1',
    revoked: 'revoked_5c4ad67e',
    running: 'running_9a4f6603',
    succeeded: 'completed_58782c56',
    suspended: 'suspended_9b234ede',
    trialing: 'trialing_f2df1495',
    unread: 'unread_7a7f2db0',
    uploading: 'uploading_06ae9013',
    void: 'voided_3352f2b4',
    viewer: 'viewer_869788c4',
    editor: 'editor_53d607ba',
    admin: 'admin_f22d5ee6',
    owner: 'owner_11c4ab29',
    user: 'user_b9e95558',
  };
  const label = labels[normalized];
  if (label) {
    return dashboardInlineText(lang, label);
  }
  return dashboardInlineText(lang, 'recorded_0a4c2f96');
}

export function friendlyStatusTone(value: string | null | undefined): UserTone {
  const normalized = String(value ?? '').toLowerCase();
  if (
    ['active', 'available', 'paid', 'published', 'ready', 'read', 'succeeded', 'trialing'].includes(
      normalized
    )
  ) {
    return 'success';
  }
  if (
    ['pending', 'pending-verification', 'queued', 'running', 'unread', 'uploading'].includes(
      normalized
    )
  ) {
    return 'warning';
  }
  if (
    [
      'canceled',
      'deleted',
      'disabled',
      'expired',
      'failed',
      'quarantined',
      'revoked',
      'suspended',
      'void',
    ].includes(normalized)
  ) {
    return 'danger';
  }
  return 'neutral';
}

export function FriendlyStatusBadge({
  lang,
  value,
  tone,
}: {
  lang: SupportedLanguage;
  value: string | null | undefined;
  tone?: UserTone;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${userToneClass[tone ?? friendlyStatusTone(value)]}`}
    >
      {friendlyStatusLabel(lang, value)}
    </span>
  );
}

export function formatUserDate(lang: SupportedLanguage, value?: string | null): string {
  if (!value) {
    return dashboardInlineText(lang, 'not_scheduled_3c7cc321');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatUserLanguage(lang: SupportedLanguage, value?: string | null): string {
  if (value === 'en') {
    return 'English';
  }
  if (value === 'zh') {
    return dashboardInlineText(lang, 'chinese_5fd94fbf');
  }
  return dashboardInlineText(lang, 'use_current_language_7df097e0');
}

export function formatUserRole(lang: SupportedLanguage, value?: string | null): string {
  return friendlyStatusLabel(lang, value);
}

export function formatEntitlementLabel(lang: SupportedLanguage, value: string | undefined): string {
  if (!value) {
    return dashboardInlineText(lang, 'base_access_d18b0eb4');
  }
  if (value === 'public-tools.pro') {
    return dashboardInlineText(lang, 'pro_tools_access_d232c1dd');
  }
  return dashboardInlineText(lang, 'enabled_access_74eac6f9');
}

export function formatCreditUnit(lang: SupportedLanguage, value: string | undefined): string {
  return value === 'credit'
    ? dashboardInlineText(lang, 'credits_8c75616f')
    : dashboardInlineText(lang, 'credits_8c75616f');
}

export function formatCreditReason(lang: SupportedLanguage, reason: string): string {
  if (reason === 'host.welcome_grant' || reason === 'welcome_bonus') {
    return dashboardInlineText(lang, 'welcome_bonus_0439221e');
  }
  if (reason === 'host.public_tool_usage' || reason === 'public_tool_usage') {
    return dashboardInlineText(lang, 'public_tool_usage_485b0697');
  }
  return dashboardInlineText(lang, 'credit_adjustment_5ca70ea2');
}

export function formatCreditAmount(lang: SupportedLanguage, amount: number, unit: string): string {
  const prefix = amount > 0 ? '+' : '';
  return `${prefix}${amount} ${formatCreditUnit(lang, unit)}`;
}

export function formatTaskName(lang: SupportedLanguage, name: string): string {
  if (name === 'public-tools-export' || name === 'public tools export') {
    return dashboardInlineText(lang, 'export_public_tools_data_201afecb');
  }
  return name.includes('-') || name.includes('_')
    ? dashboardInlineText(lang, 'user_task_f874d779')
    : name;
}

export function formatTaskResult(lang: SupportedLanguage, result: unknown): string {
  if (result && typeof result === 'object' && 'exportedRows' in result) {
    const rows = Number((result as { exportedRows?: unknown }).exportedRows ?? 0);
    return dashboardInlineText(lang, 'exported_value_row_value_210f20bf', {
      value1: rows,
      value2: rows === 1 ? '' : 's',
    });
  }
  return dashboardInlineText(lang, 'the_task_is_complete_bed21f2c');
}

export function formatOrderAmount(
  lang: SupportedLanguage,
  amount: number,
  currency: string
): string {
  if (amount === 0) {
    return dashboardInlineText(lang, 'free_demo_order_5fc6871d');
  }
  return formatCurrencyMinor(amount, currency, lang);
}

export function formatMoneyAmount(
  lang: SupportedLanguage,
  amount: number,
  currency: string
): string {
  if (amount === 0) {
    return dashboardInlineText(lang, 'free_b34fd7a2');
  }
  return formatCurrencyMinor(amount, currency, lang);
}

export function formatPaymentMethodLabel(
  lang: SupportedLanguage,
  label: string,
  provider?: string
): string {
  if (label === 'Local ledger checkout' || provider === 'local') {
    return dashboardInlineText(lang, 'demo_payment_ee7b8c01');
  }
  return label;
}

export function formatStorageLabel(
  lang: SupportedLanguage,
  storage: HostFileStorageStatus
): string {
  if (storage.durable) {
    return dashboardInlineText(lang, 'cloud_storage_fb0bba0d');
  }
  return dashboardInlineText(lang, 'local_storage_3974f971');
}

export function formatFilePurpose(lang: SupportedLanguage, value: string): string {
  const labels: Record<string, string> = {
    source: 'source_file_73f2562b',
    output: 'generated_result_4bba5c2e',
    attachment: 'attachment_60724b1b',
    avatar: 'avatar_8f6f49e2',
    document: 'document_b79f4255',
  };
  const label = labels[value];
  return label ? dashboardInlineText(lang, label) : dashboardInlineText(lang, 'file_873b4b0f');
}

export function formatFileType(lang: SupportedLanguage, value?: string | null): string {
  if (!value) {
    return dashboardInlineText(lang, 'file_873b4b0f');
  }
  if (value.startsWith('image/')) {
    return dashboardInlineText(lang, 'image_af0beeca');
  }
  if (value.startsWith('video/')) {
    return dashboardInlineText(lang, 'video_ed08debe');
  }
  if (value.startsWith('audio/')) {
    return dashboardInlineText(lang, 'audio_c00f635b');
  }
  if (value.includes('pdf')) {
    return dashboardInlineText(lang, 'document_b79f4255');
  }
  if (value.startsWith('text/')) {
    return dashboardInlineText(lang, 'text_a07b8bd6');
  }
  return dashboardInlineText(lang, 'file_873b4b0f');
}

export function formatNotificationCategory(lang: SupportedLanguage, value: string): string {
  const labels: Record<string, string> = {
    admin: 'team_dbaabef7',
    billing: 'billing_32ee28d7',
    files: 'files_de86c79a',
    system: 'system_5b103db0',
    tasks: 'tasks_9350ae8a',
    workspace: 'workspace_7f1bc761',
  };
  const label = labels[value];
  return label
    ? dashboardInlineText(lang, label)
    : dashboardInlineText(lang, 'notification_d41b6f05');
}

export function formatNotificationTitle(
  lang: SupportedLanguage,
  notification: RuntimeStoreNotificationRecord
): string {
  const title = (notification.title ?? '').trim();
  const category = notification.category;

  if (category === 'tasks' || /^Task\s+/i.test(title)) {
    const taskMatch = title.match(/^Task\s+([a-z_]+):\s*(.+)$/i);
    const naturalMatch = title.match(/^(.+?)\s+(failed|completed)$/i);
    const status = taskMatch?.[1] ?? naturalMatch?.[2] ?? notification.status;
    const taskName = taskMatch?.[2] ?? naturalMatch?.[1] ?? title;
    const friendlyName = formatTaskName(lang, taskName);
    return status === 'failed'
      ? dashboardInlineText(lang, 'task_notification_failed_b5c4f1f1', { value1: friendlyName })
      : dashboardInlineText(lang, 'task_notification_completed_2cb56f8c', { value1: friendlyName });
  }

  if (category === 'billing' || /^Billing\s+/i.test(title)) {
    if (title === 'Payment completed') {
      return dashboardInlineText(lang, 'payment_completed_5ab2736a');
    }
    if (title === 'Payment failed') {
      return dashboardInlineText(lang, 'payment_failed_b67c0bb5');
    }
    const match = title.match(/^Billing\s+([a-z_]+):\s*(.+)$/i);
    const status = match?.[1] ?? notification.status;
    const sku = match?.[2] ?? title;
    const friendlySku = formatBillingSku(sku);
    return status === 'failed'
      ? dashboardInlineText(lang, 'billing_notification_failed_1cf0efad', { value1: friendlySku })
      : dashboardInlineText(lang, 'billing_notification_completed_75f33eb0', {
          value1: friendlySku,
        });
  }

  if (category === 'files' || /^File\s+/i.test(title)) {
    const match = title.match(/^File\s+([a-z_]+):\s*(.+)$/i);
    const status = match?.[1] ?? notification.status;
    const fileName = match?.[2] ?? title;
    return status === 'quarantined'
      ? dashboardInlineText(lang, 'file_notification_needs_review_a46e97cc', { value1: fileName })
      : dashboardInlineText(lang, 'file_notification_ready_0a3f5d22', { value1: fileName });
  }

  if (category === 'workspace' || /^Workspace\s+/i.test(title)) {
    return dashboardInlineText(lang, 'workspace_update_edfee6a6');
  }

  return title || dashboardInlineText(lang, 'new_notification_32c0d12f');
}

export function formatNotificationBody(
  lang: SupportedLanguage,
  notification: RuntimeStoreNotificationRecord
): string {
  const body = (notification.body ?? '').trim();
  const category = notification.category;

  if (category === 'tasks' || /run/i.test(body)) {
    return dashboardInlineText(lang, 'the_task_is_ready_open_the_task_center_to_view_t_ac7cfbbc');
  }

  if (category === 'billing' || /^USD\s*/i.test(body)) {
    if (/^USD\s*0$/i.test(body)) {
      return dashboardInlineText(lang, 'free_demo_order_be134cb6');
    }
    if (/free\s+(test|demo)\s+order/i.test(body)) {
      return dashboardInlineText(lang, 'free_demo_order_be134cb6');
    }
    return body;
  }

  if (category === 'files' || /^image\/|^video\/|^audio\/|pdf|^text\//i.test(body)) {
    return dashboardInlineText(lang, 'the_file_status_has_been_updated_3e59fe25');
  }

  if (category === 'workspace') {
    return dashboardInlineText(lang, 'workspace_information_has_been_updated_b03017e9');
  }

  return body || dashboardInlineText(lang, 'no_details_available_36541c46');
}

export function progressDescription(lang: SupportedLanguage, progress: number): string {
  return dashboardInlineText(lang, 'value_complete_c3f68502', { value1: progress });
}

export function ProgressBar({ value }: { value: number }) {
  const safeValue = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-admin-surface-muted">
      <span
        className="block h-full rounded-full bg-admin-primary"
        style={{ width: `${safeValue}%` }}
      />
    </div>
  );
}

export function UserEmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-admin-md border border-dashed border-admin-border bg-admin-surface p-6 text-center shadow-admin-card">
      <h2 className="text-base font-semibold text-admin-text">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-admin-text-muted">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function UserRecordCard({
  lang,
  title,
  description,
  meta,
  status,
  statusTone,
  details = [],
  actions,
}: {
  lang: SupportedLanguage;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  status?: string;
  statusTone?: UserTone;
  details?: Array<{ label: string; value: ReactNode }>;
  actions?: ReactNode;
}) {
  return (
    <article className="rounded-admin-md border border-admin-border bg-admin-surface p-4 shadow-admin-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="min-w-0 text-base font-semibold text-admin-text">{title}</h3>
            {status ? <FriendlyStatusBadge lang={lang} value={status} tone={statusTone} /> : null}
          </div>
          {description ? (
            <div className="mt-1 text-sm leading-6 text-admin-text-muted">{description}</div>
          ) : null}
          {meta ? (
            <div className="mt-2 text-xs font-medium text-admin-text-subtle">{meta}</div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {details.length > 0 ? (
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {details.map((item) => (
            <div key={item.label} className="rounded-admin-sm bg-admin-surface-muted p-3">
              <dt className="text-xs font-semibold text-admin-text-subtle">{item.label}</dt>
              <dd className="mt-1 text-sm font-semibold text-admin-text">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  );
}

export function UserHashPanel({
  lang,
  id,
  triggerLabel,
  title,
  description,
  children,
  variant = 'primary',
}: {
  lang: SupportedLanguage;
  id: string;
  triggerLabel: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <>
      <a
        href={`#${id}`}
        className={`${variant === 'primary' ? dashboardPrimaryButtonClass : dashboardGhostButtonClass} cursor-pointer`}
      >
        {triggerLabel}
      </a>
      <div
        id={id}
        role="dialog"
        aria-modal="true"
        className="pointer-events-none fixed inset-0 z-50 opacity-0 transition target:pointer-events-auto target:opacity-100"
      >
        <a
          href="#"
          aria-label={dashboardInlineText(lang, 'close_panel_89b65434')}
          className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm"
        />
        <aside className="absolute right-0 top-0 flex h-dvh w-full max-w-xl flex-col overflow-hidden border-l border-admin-border bg-admin-surface text-admin-text shadow-admin-popover">
          <header className="flex items-start justify-between gap-3 border-b border-admin-border px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold leading-6">{title}</h2>
              {description ? (
                <div className="mt-1 text-sm leading-6 text-admin-text-muted">{description}</div>
              ) : null}
            </div>
            <a href="#" className={dashboardGhostButtonClass}>
              {dashboardInlineText(lang, 'close_fbd8cee0')}
            </a>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        </aside>
      </div>
    </>
  );
}

export function UserSectionNav({ items }: { items: Array<{ href: string; label: ReactNode }> }) {
  return (
    <nav className="flex flex-wrap gap-2 rounded-admin-md border border-admin-border bg-admin-surface p-2 shadow-admin-card">
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          className="inline-flex min-h-9 items-center rounded-admin-md px-3 py-2 text-sm font-semibold text-admin-text-muted transition hover:bg-admin-surface-muted hover:text-admin-text"
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
