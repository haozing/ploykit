import { DataTable } from '@host/components/ui';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import { EvidenceSection } from '@host/components/admin/shared/AdminPrimitives';
import type { SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns } from '@host/lib/admin-inline-i18n';
import { getAdminBillingCopy } from '@host/lib/admin-copy';
import { joinOrNone, type BillingPageModel } from './BillingPageModel';

export function BillingOperationalLedgerEvidence({
  lang,
  model,
}: {
  lang: SupportedLanguage;
  model: BillingPageModel;
}) {
  const copy = getAdminBillingCopy(lang);
  const {
    showReservations,
    showRedeem,
    showApiKeys,
    showRisk,
    reservations,
    redeemCodes,
    redeemRedemptions,
    redeemAttempts,
    apiKeys,
    riskRows,
  } = model;

  return (
    <>
      {showReservations ? (
        <EvidenceSection
          title={`Credit reservations · ${reservations.length}`}
          description={copy.creditReservationsDescription}
        >
          <DataTable
            className="shadow-none"
            columns={adminInlineColumns(lang, ['Reservation', 'Subject', 'Amount', 'Status'])}
            rows={reservations.map((reservation) => [
              <span key={`${reservation.id}:reservation`} className="block min-w-0">
                <span className="block truncate font-semibold text-admin-text">
                  {reservation.reason ?? reservation.source ?? 'reserve'}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
                  {reservation.id}
                </span>
              </span>,
              reservation.subject.label,
              `${reservation.amountCommitted}/${reservation.amountReserved} ${reservation.unit}`,
              <StatusBadge
                key={`${reservation.id}:status`}
                lang={lang}
                value={reservation.status}
              />,
            ])}
            density="compact"
          />
        </EvidenceSection>
      ) : null}
      {showRedeem ? (
        <EvidenceSection
          title={`Redeem code lifecycle · ${redeemCodes.length + redeemRedemptions.length + redeemAttempts.length}`}
          description={copy.redeemCodeLifecycleDescription}
        >
          <DataTable
            className="shadow-none"
            columns={adminInlineColumns(lang, ['Record', 'Subject', 'Benefit', 'Status'])}
            rows={[
              ...redeemCodes.map((code) => [
                <span key={`${code.id}:code`} className="block min-w-0">
                  <span className="block truncate font-semibold text-admin-text">
                    {code.maskedCode ?? code.prefix ?? code.codeHashPrefix}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
                    {code.batchId ?? code.codeHashPrefix}
                  </span>
                </span>,
                '-',
                [
                  code.entitlement,
                  code.creditsAmount ? `${code.creditsAmount} ${code.creditsUnit}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || '-',
                <StatusBadge key={`${code.id}:status`} lang={lang} value={code.status} />,
              ]),
              ...redeemRedemptions.map((redemption) => [
                <span key={`${redemption.id}:redemption`} className="block min-w-0">
                  <span className="block truncate font-semibold text-admin-text">
                    {copy.redemptionRecord}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
                    {redemption.codeHashPrefix}
                  </span>
                </span>,
                redemption.subject.label,
                [
                  redemption.entitlement,
                  redemption.creditsAmount
                    ? `${redemption.creditsAmount} ${redemption.creditsUnit ?? 'credit'}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || '-',
                'redeemed',
              ]),
              ...redeemAttempts.map((attempt) => [
                <span key={`${attempt.id}:attempt`} className="block min-w-0">
                  <span className="block truncate font-semibold text-admin-text">
                    {copy.attemptRecord}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
                    {attempt.codeHashPrefix ?? attempt.id}
                  </span>
                </span>,
                attempt.subject?.label ?? '-',
                attempt.reason ?? '-',
                <StatusBadge
                  key={`${attempt.id}:status`}
                  lang={lang}
                  value={attempt.ok ? 'success' : 'failed'}
                />,
              ]),
            ]}
            density="compact"
          />
        </EvidenceSection>
      ) : null}
      {showApiKeys ? (
        <EvidenceSection
          title={`Machine API keys · ${apiKeys.length}`}
          description={copy.machineApiKeysDescription}
        >
          <DataTable
            className="shadow-none"
            columns={adminInlineColumns(lang, ['Key', 'Owner', 'Permissions', 'Status'])}
            rows={apiKeys.map((key) => [
              <span key={`${key.id}:key`} className="block min-w-0">
                <span className="block truncate font-semibold text-admin-text">{key.name}</span>
                <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
                  {key.prefix} · {key.moduleId ?? 'product'}
                </span>
              </span>,
              key.owner?.label ?? '-',
              joinOrNone(key.permissions.map(String)),
              <StatusBadge key={`${key.id}:status`} lang={lang} value={key.status} />,
            ])}
            density="compact"
          />
        </EvidenceSection>
      ) : null}
      {showRisk ? (
        <EvidenceSection title={`Risk facts · ${riskRows.length}`} description={copy.riskFactsDescription}>
          <DataTable
            className="shadow-none"
            columns={adminInlineColumns(lang, ['Risk', 'Subject', 'Source', 'Status'])}
            rows={riskRows.map((record) => [
              <span key={`${record.id}:risk`} className="block min-w-0">
                <span className="block truncate font-semibold text-admin-text">
                  {'type' in record ? record.type : record.reason}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
                  {record.id}
                </span>
              </span>,
              record.subject?.label ?? '-',
              'severity' in record ? (record.source ?? '-') : (record.scope ?? '-'),
              <StatusBadge
                key={`${record.id}:status`}
                lang={lang}
                value={'severity' in record ? record.severity : 'blocked'}
              />,
            ])}
            density="compact"
          />
        </EvidenceSection>
      ) : null}
    </>
  );
}
