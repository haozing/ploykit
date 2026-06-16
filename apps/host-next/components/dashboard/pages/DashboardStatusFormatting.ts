import { dashboardInlineText } from '@host/lib/dashboard-copy';
import type { SupportedLanguage } from '@host/lib/i18n';

export type UserTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

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
