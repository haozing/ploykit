import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { HostAuthSessionRecord } from '@host/lib/auth';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import type { AdminTableQuery } from '@host/lib/table-query';
import type { RuntimeStoreHostUser } from '@/lib/module-runtime';

export interface UserAuthSummary {
  emailVerifiedAt?: string;
  verificationMailAt?: string;
  lastSessionAt?: string;
  sessionCount: number;
  adminEditedAt?: string;
  adminEditedBy?: string;
}

export function userAuthSummary(user: RuntimeStoreHostUser): UserAuthSummary {
  const metadata = user.metadata as Record<string, unknown>;
  const auth = metadata.auth;
  const authRecord =
    auth && typeof auth === 'object' && !Array.isArray(auth)
      ? (auth as Record<string, unknown>)
      : {};
  const sessions = Array.isArray(authRecord.sessions)
    ? authRecord.sessions.filter((item): item is HostAuthSessionRecord =>
        Boolean(
          item &&
            typeof item === 'object' &&
            typeof (item as HostAuthSessionRecord).id === 'string' &&
            typeof (item as HostAuthSessionRecord).createdAt === 'string' &&
            typeof (item as HostAuthSessionRecord).expiresAt === 'string'
        )
      )
    : [];
  const mailLog = Array.isArray(authRecord.mailLog)
    ? authRecord.mailLog.filter((item): item is { type: string; createdAt: string } => {
        const entry = item as Record<string, unknown>;
        return Boolean(
          entry && typeof entry.type === 'string' && typeof entry.createdAt === 'string'
        );
      })
    : [];
  const verificationMail = mailLog.find((entry) => entry.type === 'email-verification');
  return {
    emailVerifiedAt:
      typeof authRecord.emailVerifiedAt === 'string' ? authRecord.emailVerifiedAt : undefined,
    verificationMailAt: verificationMail?.createdAt,
    lastSessionAt: sessions
      .slice()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.createdAt,
    sessionCount: sessions.length,
    adminEditedAt: typeof metadata.roleUpdatedBy === 'string' ? user.updatedAt : undefined,
    adminEditedBy: typeof metadata.roleUpdatedBy === 'string' ? metadata.roleUpdatedBy : undefined,
  };
}

export function userVerificationState(lang: SupportedLanguage, user: RuntimeStoreHostUser) {
  const summary = userAuthSummary(user);
  if (summary.emailVerifiedAt) {
    return adminInlineText(lang, 'verified_7fc41e1e');
  }
  if (user.status === 'pending-verification') {
    return adminInlineText(lang, 'pending_verification_78fb9c4d');
  }
  return adminInlineText(lang, 'unverified_96e125d2');
}

export function userReviewReason(lang: SupportedLanguage, user: RuntimeStoreHostUser) {
  const summary = userAuthSummary(user);
  if (user.status === 'pending-verification' && !summary.verificationMailAt) {
    return adminInlineText(lang, 'verification_mail_missing_eeb3fb6e');
  }
  if (summary.adminEditedAt) {
    return adminInlineText(lang, 'admin_change_4f6e3686');
  }
  if (user.status === 'pending-verification') {
    return adminInlineText(lang, 'pending_verification_7d1aa2f3');
  }
  return adminInlineText(lang, 'clear_d6cc40bc');
}

export function cleanIdentityTableQuery(query?: AdminTableQuery): Required<AdminTableQuery> {
  return {
    q: query?.q?.trim() ?? '',
    status: query?.status?.trim() ?? '',
    role: query?.role?.trim() ?? '',
    type: query?.type?.trim() ?? '',
    moduleId: query?.moduleId?.trim() ?? '',
    service: query?.service?.trim() ?? '',
    workspace: query?.workspace?.trim() ?? '',
    environment: query?.environment?.trim() ?? '',
    range: query?.range?.trim() ?? '',
    from: query?.from?.trim() ?? '',
    to: query?.to?.trim() ?? '',
    owner: query?.owner?.trim() ?? '',
    mime: query?.mime?.trim() ?? '',
    provider: query?.provider?.trim() ?? '',
    path: query?.path?.trim() ?? '',
    minSize: query?.minSize ?? 0,
    maxSize: query?.maxSize ?? 0,
    page: query?.page ?? 1,
    pageSize: query?.pageSize ?? 20,
    operation: query?.operation?.trim() ?? '',
    outcome: query?.outcome?.trim() ?? '',
    matched: query?.matched ?? 0,
    processed: query?.processed ?? 0,
    failed: query?.failed ?? 0,
    skipped: query?.skipped ?? 0,
    deadLettered: query?.deadLettered ?? 0,
  };
}

export function adminListHref(
  lang: SupportedLanguage,
  path: string,
  query: Required<AdminTableQuery>,
  page: number
): string {
  const params = new URLSearchParams();
  if (query.q) {
    params.set('q', query.q);
  }
  if (query.status) {
    params.set('status', query.status);
  }
  if (query.role) {
    params.set('role', query.role);
  }
  if (query.type) {
    params.set('type', query.type);
  }
  if (query.moduleId) {
    params.set('moduleId', query.moduleId);
  }
  if (query.service) {
    params.set('service', query.service);
  }
  if (query.workspace) {
    params.set('workspace', query.workspace);
  }
  if (query.environment) {
    params.set('environment', query.environment);
  }
  if (query.range) {
    params.set('range', query.range);
  }
  if (query.from) {
    params.set('from', query.from);
  }
  if (query.to) {
    params.set('to', query.to);
  }
  if (query.owner) {
    params.set('owner', query.owner);
  }
  if (query.mime) {
    params.set('mime', query.mime);
  }
  if (query.provider) {
    params.set('provider', query.provider);
  }
  if (query.path) {
    params.set('path', query.path);
  }
  if (query.minSize) {
    params.set('minSize', String(query.minSize));
  }
  if (query.maxSize) {
    params.set('maxSize', String(query.maxSize));
  }
  if (page > 1) {
    params.set('page', String(page));
  }
  if (query.pageSize !== 20) {
    params.set('pageSize', String(query.pageSize));
  }
  const search = params.toString();
  return `${localizedPath(lang, path)}${search ? `?${search}` : ''}`;
}

export function matchesTextSearch(query: string, values: readonly unknown[]): boolean {
  if (query.length === 0) {
    return true;
  }
  const needle = query.toLowerCase();
  return values.some((value) =>
    String(value ?? '')
      .toLowerCase()
      .includes(needle)
  );
}

export function matchesExactFilter(filter: string, value: unknown): boolean {
  return filter.length === 0 || String(value ?? '') === filter;
}
