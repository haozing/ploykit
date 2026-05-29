import { Badge } from '@host/components/ui';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { SupportedLanguage } from '@host/lib/i18n';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const okValues = new Set([
  'enabled',
  'active',
  'available',
  'paid',
  'passed',
  'published',
  'operational',
  'queued',
  'processed',
  'read',
  'ready',
  'received',
  'delivered',
  'succeeded',
  'clear',
  'healthy',
]);

const infoValues = new Set([
  'queued',
  'running',
  'processing',
  'syncing',
  'uploading',
  'received',
  'pending',
  'pending-verification',
  'cancel_requested',
]);

const badValues = new Set([
  'canceled',
  'blocked',
  'error',
  'dead_letter',
  'deleted',
  'disabled',
  'expired',
  'failed',
  'missing',
  'quarantined',
  'revoked',
  'suspended',
  'void',
]);

export function statusTone(value: string): StatusTone {
  const normalizedValue = value.toLowerCase();
  if (infoValues.has(normalizedValue)) {
    return 'info';
  }
  if (okValues.has(normalizedValue)) {
    return 'success';
  }
  if (badValues.has(normalizedValue)) {
    return 'danger';
  }
  if (normalizedValue === 'unknown' || normalizedValue === 'draft' || normalizedValue === 'idle') {
    return 'neutral';
  }
  return 'warning';
}

export function statusLabel(value: string): string {
  const normalizedValue = value.toLowerCase();
  const labels: Record<string, string> = {
    clear: 'Healthy',
    ready: 'Ready',
    passed: 'Passed',
    operational: 'Operational',
    warning: 'Needs review',
    blocked: 'Blocked',
    failed: 'Failed',
    error: 'Error',
    missing: 'Missing',
    'pending-verification': 'Pending verification',
    cancel_requested: 'Cancel requested',
    dead_letter: 'Dead letter',
  };
  return labels[normalizedValue] ?? value;
}

export function StatusBadge({
  value,
  label,
  tone: explicitTone,
  lang,
}: {
  value: string;
  label?: string;
  tone?: StatusTone;
  lang?: SupportedLanguage;
}) {
  const tone = explicitTone ?? statusTone(value);
  const visibleLabel = label ?? statusLabel(value);
  return (
    <Badge
      tone={
        tone === 'success'
          ? 'success'
          : tone === 'danger'
            ? 'danger'
            : tone === 'warning'
              ? 'warning'
              : 'neutral'
      }
      title={value}
      className={tone === 'info' ? 'border-admin-info/25 bg-admin-info/10 text-admin-info' : undefined}
    >
      <span className="truncate">{lang ? adminInlineText(lang, visibleLabel) : visibleLabel}</span>
    </Badge>
  );
}
