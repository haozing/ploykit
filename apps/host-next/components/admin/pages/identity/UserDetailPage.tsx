import { ShieldCheck, UserCheck, Users } from 'lucide-react';
import {
  adminNav,
  EmptyState,
  StatCard,
  WorkspaceShell,
} from '@host/components/ProductShell';
import { ConfirmSubmitButton, DataTable, Input, Select } from '@host/components/ui';
import { CopyButton } from '@host/components/ui/CopyButton';
import {
  AdminPanel,
  EvidenceSection,
  FactList,
  StatGrid,
  TimelineList,
} from '@host/components/admin/shared/AdminPrimitives';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminUserDetailCopy } from '@host/lib/admin-copy';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import type { HostIdentityUserDetailView } from '@host/lib/identity-operations';
import {
  userAuthSummary,
  userReviewReason,
  userVerificationState,
} from './IdentityPageModel';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

function compactJson(value: unknown, maxLength = Number.POSITIVE_INFINITY): string {
  if (value === undefined) {
    return '';
  }
  const text = JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

export function AdminUserDetailOperationsPage({
  lang,
  detail,
  updateUserStatusAction,
  updateUserRoleAction,
  requestPasswordResetAction,
  revokeSessionAction,
}: {
  lang: SupportedLanguage;
  detail: HostIdentityUserDetailView;
  updateUserStatusAction: AdminFormAction;
  updateUserRoleAction: AdminFormAction;
  requestPasswordResetAction: AdminFormAction;
  revokeSessionAction: AdminFormAction;
}) {
  const copy = getAdminUserDetailCopy(lang);
  const { user, sessions, audit } = detail;
  const authSummary = user ? userAuthSummary(user) : null;
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      {user ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-5">
            <StatGrid>
              <StatCard
                label={copy.role}
                value={user.role}
                tone="blue"
                helper={user.workspaceRole}
                icon={ShieldCheck}
              />
              <StatCard
                label={copy.status}
                value={user.status}
                tone={user.status === 'active' ? 'green' : 'amber'}
                helper={copy.currentState}
                icon={UserCheck}
              />
              <StatCard
                label={copy.workspace}
                value={user.workspaceId}
                helper={user.productId}
                icon={Users}
              />
              <StatCard
                label={copy.sessions}
                value={String(sessions.length)}
                helper={copy.auditRecords(audit.length)}
                icon={UserCheck}
              />
            </StatGrid>

            <AdminPanel
              title={copy.actionsTitle}
              description={copy.actionsDescription}
              contentClassName="grid gap-4"
            >
              <section className="grid gap-4 lg:grid-cols-2">
                <form
                  action={updateUserStatusAction}
                  className="grid gap-4 rounded-admin-md border border-admin-border bg-admin-bg/45 p-4"
                >
                  <div>
                    <h3 className="text-sm font-semibold text-admin-text">{copy.accountStatus}</h3>
                    <p className="mt-1 text-sm leading-6 text-admin-text-muted">
                      {copy.accountStatusHint}
                    </p>
                  </div>
                  <input type="hidden" name="userId" value={user.id} />
                  <label className="grid gap-2 text-sm font-medium text-admin-text">
                    <span>{copy.status}</span>
                    <Select name="status" defaultValue={user.status}>
                      <option value="active">{adminInlineText(lang, 'active')}</option>
                      <option value="suspended">{adminInlineText(lang, 'suspended')}</option>
                      <option value="pending-verification">
                        {adminInlineText(lang, 'pending-verification')}
                      </option>
                      <option value="deleted">{adminInlineText(lang, 'deleted')}</option>
                    </Select>
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-admin-text">
                    <span>{copy.reason}</span>
                    <Input
                      name="reason"
                      defaultValue="Admin user detail operation"
                      maxLength={200}
                    />
                  </label>
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-9 items-center justify-center rounded-admin-md bg-admin-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-admin-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    confirmation={copy.updateStatusConfirm(user.email)}
                  >
                    {copy.updateStatus}
                  </ConfirmSubmitButton>
                </form>

                <form
                  action={updateUserRoleAction}
                  className="grid gap-4 rounded-admin-md border border-admin-border bg-admin-bg/45 p-4"
                >
                  <div>
                    <h3 className="text-sm font-semibold text-admin-text">{copy.hostRole}</h3>
                    <p className="mt-1 text-sm leading-6 text-admin-text-muted">
                      {copy.hostRoleHint}
                    </p>
                  </div>
                  <input type="hidden" name="userId" value={user.id} />
                  <label className="grid gap-2 text-sm font-medium text-admin-text">
                    <span>{copy.role}</span>
                    <Select name="role" defaultValue={user.role}>
                      <option value="user">{adminInlineText(lang, 'user')}</option>
                      <option value="admin">{adminInlineText(lang, 'admin')}</option>
                    </Select>
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-admin-text">
                    <span>{copy.reason}</span>
                    <Input
                      name="reason"
                      defaultValue="Admin user detail role operation"
                      maxLength={200}
                    />
                  </label>
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-4 py-2 text-sm font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    confirmation={copy.updateRoleConfirm(user.email)}
                  >
                    {copy.updateRole}
                  </ConfirmSubmitButton>
                </form>
              </section>

              <form
                action={requestPasswordResetAction}
                className="flex flex-col gap-4 rounded-admin-md border border-admin-warning/25 bg-admin-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="reason" value="Admin password reset operation" />
                <div>
                  <h3 className="text-sm font-semibold text-admin-text">{copy.passwordReset}</h3>
                  <p className="mt-1 text-sm leading-6 text-admin-text-muted">
                    {copy.passwordResetHint}
                  </p>
                </div>
                <ConfirmSubmitButton
                  type="submit"
                  className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-warning/25 bg-admin-surface px-4 py-2 text-sm font-semibold text-admin-warning transition hover:bg-admin-warning/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                  confirmation={copy.sendResetConfirm(user.email)}
                >
                  {copy.sendReset}
                </ConfirmSubmitButton>
              </form>
            </AdminPanel>

            <AdminPanel
              title={copy.diagnosticsTitle}
              description={copy.diagnosticsDescription}
              contentClassName="grid gap-3"
            >
              <EvidenceSection
                title={copy.activeSessions}
                description={copy.activeSessionsDescription}
              >
                <DataTable
                  className="rounded-none border-x-0 shadow-none"
                  columns={copy.sessionColumns}
                  rows={sessions.map((session) => [
                    session.id,
                    session.userAgent ?? 'unknown',
                    session.createdAt,
                    session.expiresAt,
                    <form key={session.id} action={revokeSessionAction}>
                      <input type="hidden" name="userId" value={user.id} />
                      <input type="hidden" name="sessionId" value={session.id} />
                      <input type="hidden" name="reason" value="Admin session revoke operation" />
                      <ConfirmSubmitButton
                        type="submit"
                        className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-danger/25 bg-admin-danger/10 px-3 py-1.5 text-xs font-semibold text-admin-danger transition hover:bg-admin-danger/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                        confirmation={copy.revokeConfirm(user.email, session.id)}
                      >
                        {copy.revoke}
                      </ConfirmSubmitButton>
                    </form>,
                  ])}
                  empty={copy.noSessions}
                  minWidthClass="min-w-[860px]"
                />
              </EvidenceSection>

              <EvidenceSection title={copy.auditTitle} description={copy.auditDescription}>
                <TimelineList
                  lang={lang}
                  items={audit.map((record) => ({
                    key: record.id,
                    title: record.type,
                    description: compactJson(record.metadata, 180),
                    meta: `${record.actorId ?? 'system'} · ${record.createdAt}`,
                    tone:
                      record.type.includes('revoke') || record.type.includes('suspend')
                        ? 'warning'
                        : 'primary',
                  }))}
                  empty={copy.noAudit}
                />
              </EvidenceSection>

              <EvidenceSection title={copy.metadata} description={copy.metadataDescription}>
                <pre className="max-h-[360px] overflow-auto rounded-admin-sm bg-admin-bg p-3 text-xs leading-5 text-admin-text-muted">
                  {JSON.stringify(user.metadata, null, 2)}
                </pre>
              </EvidenceSection>
            </AdminPanel>
          </div>

          <AdminPanel
            title={copy.drawerTitle}
            description={user.email ?? user.id}
            action={<CopyButton value={user.id} label={copy.copyId} />}
            className="xl:sticky xl:top-24 xl:self-start"
            contentClassName="grid gap-4"
          >
            <FactList
              lang={lang}
              items={[
                { label: 'ID', value: user.id, copyValue: user.id, mono: true },
                { label: 'Email', value: user.email, copyValue: user.email },
                { label: 'Product', value: user.productId, mono: true },
                { label: 'Workspace', value: user.workspaceId, mono: true },
                { label: 'Created', value: user.createdAt },
                { label: 'Updated', value: user.updatedAt },
                { label: 'Email verification', value: userVerificationState(lang, user) },
                { label: 'Verification mail', value: authSummary?.verificationMailAt ?? 'none' },
                { label: 'Last session', value: authSummary?.lastSessionAt ?? 'none' },
                {
                  label: 'Admin change',
                  value: authSummary?.adminEditedBy
                    ? `${authSummary.adminEditedBy} · ${userReviewReason(lang, user)}`
                    : 'none',
                },
              ]}
            />
            <div className="rounded-admin-md border border-admin-border bg-admin-bg/45 p-3">
              <h3 className="text-sm font-semibold text-admin-text">{copy.reviewRule}</h3>
              <p className="mt-1 text-sm leading-6 text-admin-text-muted">{copy.reviewRuleBody}</p>
            </div>
          </AdminPanel>
        </div>
      ) : (
        <EmptyState
          title={copy.missingTitle}
          actionHref={localizedPath(lang, '/admin/users')}
          actionLabel={copy.back}
        >
          {copy.missingBody}
        </EmptyState>
      )}
    </WorkspaceShell>
  );
}
