'use client';

import type { PluginRuntimePageProps } from '@ploykit/plugin-sdk';
import { useCallback, useEffect, useState } from 'react';
import {
  pluginPagePath,
  requestJson,
  statusTone,
  type ProjectSummary,
  type TaskTypeSummary,
} from '../lib/ui-client';

export default function WorkerDxHome(props: PluginRuntimePageProps) {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [taskTypes, setTaskTypes] = useState<TaskTypeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    const projectsPayload = await requestJson<{ projects: ProjectSummary[] }>(
      props.pluginId,
      '/projects'
    );
    const nextProject = projectsPayload.projects[0] ?? null;
    const nextTaskTypes = nextProject
      ? ((
          await requestJson<{ task_types: TaskTypeSummary[] }>(
            props.pluginId,
            `/projects/${nextProject.id}/task-types`
          )
        ).task_types ?? [])
      : [];

    return {
      project: nextProject,
      taskTypes: nextTaskTypes,
    };
  }, [props.pluginId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await fetchDashboard();
      setError(null);
      setProject(payload.project);
      setTaskTypes(payload.taskTypes);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [fetchDashboard]);

  useEffect(() => {
    async function loadInitial() {
      try {
        const payload = await fetchDashboard();
        setError(null);
        setProject(payload.project);
        setTaskTypes(payload.taskTypes);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setLoading(false);
      }
    }

    void loadInitial();
  }, [fetchDashboard]);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Worker DX</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Generate worker contracts, starter code, prompts, and validator jobs.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="rounded-md border bg-background p-5">
        <h2 className="text-lg font-semibold">{project?.name ?? 'Workspace Project'}</h2>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{project?.id ?? '-'}</p>
      </section>

      <section className="grid gap-3">
        {taskTypes.map((taskType) => (
          <article key={taskType.id} className="rounded-md border bg-background p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{taskType.name}</h2>
                <p className="font-mono text-xs text-muted-foreground">{taskType.task_key}</p>
              </div>
              <span className={`rounded border px-2 py-1 text-xs ${statusTone(taskType.status)}`}>
                {taskType.status}
              </span>
            </div>
            {project ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  className="rounded-md border px-3 py-1.5 text-sm font-medium"
                  href={pluginPagePath(
                    props,
                    `/projects/${project.id}/task-types/${taskType.id}/contract`
                  )}
                >
                  Contract
                </a>
                <a
                  className="rounded-md border px-3 py-1.5 text-sm font-medium"
                  href={pluginPagePath(
                    props,
                    `/projects/${project.id}/task-types/${taskType.id}/starter`
                  )}
                >
                  Starter
                </a>
                <a
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                  href={pluginPagePath(
                    props,
                    `/projects/${project.id}/task-types/${taskType.id}/validator`
                  )}
                >
                  Validator
                </a>
              </div>
            ) : null}
          </article>
        ))}
        {!loading && !taskTypes.length ? (
          <p className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
            No task types yet. Create one in the RunLynk Core Console first.
          </p>
        ) : null}
      </section>
    </main>
  );
}
