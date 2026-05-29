import { randomUUID } from 'node:crypto';
import { getHostEmailProviderStatus, sendHostEmail } from '../apps/host-next/lib/email-provider';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readBooleanArg(name: string): boolean {
  return process.argv.includes(name);
}

const required = readBooleanArg('--required');
const to = readArg('--to') ?? process.env.PLOYKIT_EMAIL_SMOKE_TO ?? 'operator@example.com';
const status = getHostEmailProviderStatus();
const checks: {
  id: string;
  ok: boolean;
  skipped?: boolean;
  detail?: unknown;
  error?: string;
}[] = [];

checks.push({
  id: 'email-provider-config',
  ok: !required || (status.mode === 'webhook' && status.webhookConfigured),
  detail: status,
});

checks.push({
  id: 'email-webhook-signature',
  ok: !required || status.webhookSecretConfigured,
  skipped: !status.webhookSecretConfigured,
  detail: status.webhookSecretConfigured
    ? 'PLOYKIT_EMAIL_WEBHOOK_SECRET configured'
    : 'PLOYKIT_EMAIL_WEBHOOK_SECRET is not configured',
});

checks.push({
  id: 'email-retry-policy',
  ok: status.retry.attempts >= 1 && status.retry.backoffMs >= 0 && status.retry.timeoutMs >= 250,
  detail: status.retry,
});

if (required && (status.mode !== 'webhook' || !status.webhookConfigured)) {
  checks.push({
    id: 'email-send',
    ok: false,
    skipped: true,
    detail: {
      reason:
        'Required email matrix must use PLOYKIT_EMAIL_PROVIDER=webhook and PLOYKIT_EMAIL_WEBHOOK_URL.',
    },
  });
} else {
  const result = await sendHostEmail({
    to,
    subject: `PloyKit email smoke ${randomUUID()}`,
    text: 'PloyKit host email provider smoke test.',
    metadata: { smoke: 'host-email' },
  });
  checks.push({
    id: 'email-send',
    ok: result.status === 'delivered' && (!required || result.provider === 'email-webhook'),
    detail: result,
  });
}

const report = {
  ok: checks.every((item) => item.ok),
  required,
  checkedAt: new Date().toISOString(),
  to,
  checks,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ok ? 0 : 1;
