import { dashboardInlineText } from '@host/lib/dashboard-copy';
import type { SupportedLanguage } from '@host/lib/i18n';
import type { RuntimeStoreNotificationRecord } from '@/lib/module-runtime';
import { formatBillingSku } from './DashboardCommerceFormatting';
import { formatTaskName } from './DashboardTaskFormatting';

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
