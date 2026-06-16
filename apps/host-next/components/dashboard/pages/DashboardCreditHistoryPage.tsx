import { WorkspaceShell } from '@host/components/ProductShell';
import { AdminPanel, PageSynopsis } from '@host/components/admin/shared/AdminPrimitives';
import type { SupportedLanguage } from '@host/lib/i18n';
import { dashboardInlineText, getDashboardCopy } from '@host/lib/dashboard-copy';
import type { UserSaasSnapshot } from '@host/lib/saas-operations';
import {
  FriendlyStatusBadge,
  UserEmptyState,
  formatCreditAmount,
  formatCreditReason,
  formatCreditUnit,
  formatUserDate,
} from './DashboardPageUtils';

export function DashboardCreditHistoryOperationsPage({
  lang,
  snapshot,
}: {
  lang: SupportedLanguage;
  snapshot: UserSaasSnapshot;
}) {
  const copy = getDashboardCopy(lang).credits;

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle}>
      <div className="grid gap-4">
        <PageSynopsis
          lang={lang}
          title={dashboardInlineText(lang, 'credit_history_b29eb547')}
          description={dashboardInlineText(
            lang,
            'credit_history_works_better_as_a_transaction_lis_7860fec8'
          )}
          items={[
            {
              key: 'balance',
              label: dashboardInlineText(lang, 'balance_bf507738'),
              value: String(snapshot.creditBalance.balance),
              tone: 'primary',
            },
            {
              key: 'unit',
              label: dashboardInlineText(lang, 'unit_77c0cd5d'),
              value: formatCreditUnit(lang, snapshot.creditBalance.unit),
              tone: 'info',
            },
            {
              key: 'entries',
              label: dashboardInlineText(lang, 'entries_bd5b4b0f'),
              value: String(snapshot.credits.length),
              tone: 'neutral',
            },
          ]}
        />

        <AdminPanel
          title={dashboardInlineText(lang, 'transaction_list_8b388d42')}
          description={dashboardInlineText(
            lang,
            'each_row_explains_why_credits_increased_or_decre_168b5ef9'
          )}
        >
          {snapshot.credits.length > 0 ? (
            <div className="overflow-hidden rounded-admin-md border border-admin-border bg-admin-bg/40">
              <div className="hidden grid-cols-[minmax(0,1.3fr)_0.8fr_0.8fr_0.8fr] gap-3 border-b border-admin-border px-4 py-2 text-xs font-semibold uppercase text-admin-text-subtle md:grid">
                <span>{dashboardInlineText(lang, 'reason_0a7fcf20')}</span>
                <span>{dashboardInlineText(lang, 'date_15a1897e')}</span>
                <span>{dashboardInlineText(lang, 'change_7a8bae8a')}</span>
                <span>{dashboardInlineText(lang, 'status_8042eaf1')}</span>
              </div>
              <div className="divide-y divide-admin-border">
                {snapshot.credits.map((entry) => {
                  const positive = entry.amount > 0;
                  return (
                    <div
                      key={entry.id}
                      className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1.3fr)_0.8fr_0.8fr_0.8fr] md:items-center"
                    >
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-admin-text">
                          {formatCreditReason(lang, entry.reason)}
                        </h3>
                        <p className="mt-1 text-xs text-admin-text-subtle">
                          {positive
                            ? dashboardInlineText(lang, 'credit_added_dd550da9')
                            : dashboardInlineText(lang, 'credit_used_f50377c3')}
                        </p>
                      </div>
                      <span className="text-sm text-admin-text-muted">
                        {formatUserDate(lang, entry.createdAt)}
                      </span>
                      <span
                        className={`text-sm font-semibold ${positive ? 'text-admin-success' : 'text-admin-text'}`}
                      >
                        {formatCreditAmount(lang, entry.amount, entry.unit)}
                      </span>
                      <FriendlyStatusBadge lang={lang} value={entry.status} />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <UserEmptyState
              title={dashboardInlineText(lang, 'no_credit_history_yet_b7961cbd')}
              body={dashboardInlineText(
                lang,
                'when_you_earn_or_spend_credits_the_records_will__92ca66ab'
              )}
            />
          )}
        </AdminPanel>
      </div>
    </WorkspaceShell>
  );
}
