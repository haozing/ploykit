import { WorkspaceShell } from '@host/components/ProductShell';
import { ButtonLink } from '@host/components/ui';
import {
  AdminPanel,
  FactList,
  PageSynopsis,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { dashboardInlineText, getDashboardCopy } from '@host/lib/dashboard-copy';
import type { UserSaasSnapshot } from '@host/lib/saas-operations';
import {
  ProgressBar,
  UserEmptyState,
  UserRecordCard,
  formatTaskName,
  formatTaskResult,
  formatUserDate,
  friendlyStatusLabel,
  progressDescription,
} from './DashboardPageUtils';

export function DashboardTasksOperationsPage({
  lang,
  snapshot,
}: {
  lang: SupportedLanguage;
  snapshot: UserSaasSnapshot;
}) {
  const copy = getDashboardCopy(lang).tasks;
  const runningCount = snapshot.tasks.filter(
    (run) => run.status === 'running' || run.status === 'queued'
  ).length;
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle}>
      <PageSynopsis
        lang={lang}
        title={dashboardInlineText(lang, 'task_overview_b409cf6f')}
        description={dashboardInlineText(
          lang,
          'track_task_progress_results_and_issues_that_need_dfd8d4b6'
        )}
        items={[
          {
            key: 'tasks',
            label: dashboardInlineText(lang, 'tasks_9350ae8a'),
            value: String(snapshot.tasks.length),
            tone: 'primary',
          },
          {
            key: 'running',
            label: dashboardInlineText(lang, 'running_9a4f6603'),
            value: String(runningCount),
            tone: 'warning',
          },
          {
            key: 'succeeded',
            label: dashboardInlineText(lang, 'completed_58782c56'),
            value: String(snapshot.tasks.filter((run) => run.status === 'succeeded').length),
            tone: 'success',
          },
        ]}
      />
      <AdminPanel
        title={dashboardInlineText(lang, 'tasks_7e53ff19')}
        description={dashboardInlineText(
          lang,
          'recent_tasks_include_progress_and_result_links_3e251507'
        )}
      >
        {snapshot.tasks.length > 0 ? (
          <div className="grid gap-3">
            {snapshot.tasks.map((run) => (
              <UserRecordCard
                key={run.id}
                lang={lang}
                title={formatTaskName(lang, run.name)}
                description={
                  <div className="grid gap-2">
                    <span>{progressDescription(lang, run.progress)}</span>
                    <ProgressBar value={run.progress} />
                  </div>
                }
                meta={formatUserDate(lang, run.updatedAt)}
                status={run.status}
                details={[
                  {
                    label: dashboardInlineText(lang, 'started_da6afcd5'),
                    value: formatUserDate(lang, run.startedAt ?? run.createdAt),
                  },
                  {
                    label: dashboardInlineText(lang, 'updated_8505907f'),
                    value: formatUserDate(lang, run.updatedAt),
                  },
                ]}
                actions={
                  <ButtonLink
                    href={localizedPath(lang, `/dashboard/tasks/${run.id}`)}
                    variant="secondary"
                    size="small"
                  >
                    {run.status === 'succeeded'
                      ? dashboardInlineText(lang, 'view_result_b5449146')
                      : dashboardInlineText(lang, 'view_progress_c9794340')}
                  </ButtonLink>
                }
              />
            ))}
          </div>
        ) : (
          <UserEmptyState
            title={dashboardInlineText(lang, 'no_tasks_yet_80f8a083')}
            body={dashboardInlineText(
              lang,
              'exports_uploads_and_background_work_will_appear__a4286eeb'
            )}
          />
        )}
      </AdminPanel>
    </WorkspaceShell>
  );
}

export function DashboardTaskDetailOperationsPage({
  lang,
  run,
}: {
  lang: SupportedLanguage;
  run: UserSaasSnapshot['tasks'][number] | null;
}) {
  const copy = getDashboardCopy(lang).taskDetail;
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle}>
      {run ? (
        <div className="grid gap-4">
          <PageSynopsis
            lang={lang}
            title={formatTaskName(lang, run.name)}
            description={dashboardInlineText(lang, 'task_progress_and_result_12bd2a9d')}
            status={run.status}
            statusTone={
              run.status === 'succeeded'
                ? 'success'
                : run.status === 'failed'
                  ? 'danger'
                  : 'warning'
            }
            items={[
              {
                key: 'progress',
                label: dashboardInlineText(lang, 'progress_3b8bb103'),
                value: `${run.progress}%`,
                tone: 'primary',
              },
              {
                key: 'attempts',
                label: dashboardInlineText(lang, 'attempts_aace9c74'),
                value: String(run.attempt),
                tone: 'warning',
              },
              {
                key: 'time',
                label: dashboardInlineText(lang, 'started_da6afcd5'),
                value: formatUserDate(lang, run.startedAt ?? run.createdAt),
              },
            ]}
          />
          <AdminPanel
            title={dashboardInlineText(lang, 'result_summary_da691b87')}
            description={dashboardInlineText(
              lang,
              'start_with_the_readable_result_before_deciding_w_d29badc5'
            )}
          >
            <FactList
              lang={lang}
              items={[
                {
                  key: 'status',
                  label: dashboardInlineText(lang, 'status_e92c46a3'),
                  value: friendlyStatusLabel(lang, run.status),
                },
                {
                  key: 'progress',
                  label: dashboardInlineText(lang, 'progress_f5502dfa'),
                  value: `${run.progress}%`,
                },
                {
                  key: 'startedAt',
                  label: dashboardInlineText(lang, 'started_da6afcd5'),
                  value: formatUserDate(lang, run.startedAt ?? run.createdAt),
                },
                {
                  key: 'completedAt',
                  label: dashboardInlineText(lang, 'completed_a258863b'),
                  value: formatUserDate(lang, run.completedAt),
                },
                {
                  key: 'result',
                  label: dashboardInlineText(lang, 'result_df9aef04'),
                  value: formatTaskResult(lang, run.result),
                },
              ]}
            />
          </AdminPanel>
          <AdminPanel
            title={dashboardInlineText(lang, 'next_step_aa0a86ed')}
            description={dashboardInlineText(
              lang,
              'if_this_did_not_finish_as_expected_go_back_to_th_5ee65668'
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <ButtonLink
                href={localizedPath(lang, '/dashboard/tasks')}
                variant="secondary"
                size="small"
              >
                {dashboardInlineText(lang, 'back_to_tasks_d9330c75')}
              </ButtonLink>
              {run.status === 'failed' ? (
                <span className="text-sm text-admin-text-muted">
                  {dashboardInlineText(lang, 'check_the_input_and_run_the_task_again_17e98402')}
                </span>
              ) : null}
            </div>
          </AdminPanel>
        </div>
      ) : (
        <UserEmptyState
          title={copy.missingTitle}
          body={dashboardInlineText(
            lang,
            'this_task_may_have_expired_been_cleaned_up_or_is_2e94d139'
          )}
          action={
            <ButtonLink
              href={localizedPath(lang, '/dashboard/tasks')}
              variant="secondary"
              size="small"
            >
              {dashboardInlineText(lang, 'back_to_tasks_d9330c75')}
            </ButtonLink>
          }
        />
      )}
    </WorkspaceShell>
  );
}
