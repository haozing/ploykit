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

export default function ProducerDxHome(props: PluginRuntimePageProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [taskTypes, setTaskTypes] = useState<Record<string, TaskTypeSummary[]>>({});
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    const projectsPayload = await requestJson<{ projects: ProjectSummary[] }>(
      props.pluginId,
      '/projects'
    );
    const nextProjects = projectsPayload.projects ?? [];
    const entries = await Promise.all(
      nextProjects.map(async (project) => {
        const taskPayload = await requestJson<{ task_types: TaskTypeSummary[] }>(
          props.pluginId,
          `/projects/${project.id}/task-types`
        );
        return [project.id, taskPayload.task_types ?? []] as const;
      })
    );

    return {
      projects: nextProjects,
      taskTypes: Object.fromEntries(entries) as Record<string, TaskTypeSummary[]>,
    };
  }, [props.pluginId]);

  useEffect(() => {
    async function loadInitial() {
      try {
        const payload = await fetchDashboard();
        setError(null);
        setProjects(payload.projects);
        setTaskTypes(payload.taskTypes);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    }

    void loadInitial();
  }, [fetchDashboard]);

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Producer DX</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Generate Producer API snippets, API keys, prompts, and callback signing guidance.
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="space-y-4">
        {projects.map((project) => (
          <article key={project.id} className="rounded-md border bg-background p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{project.name}</h2>
                <p className="font-mono text-xs text-muted-foreground">{project.id}</p>
              </div>
              <span className={`rounded border px-2 py-1 text-xs ${statusTone(project.status)}`}>
                {project.status ?? 'active'}
              </span>
            </div>

            <div className="mt-4 grid gap-3">
              {(taskTypes[project.id] ?? []).map((taskType) => (
                <div
                  key={taskType.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div>
                    <div className="font-medium">{taskType.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {taskType.task_key}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded border px-2 py-1 text-xs ${
                        taskType.producer_enabled
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-muted bg-muted/30 text-muted-foreground'
                      }`}
                    >
                      producer {taskType.producer_enabled ? 'on' : 'off'}
                    </span>
                    <a
                      className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                      href={pluginPagePath(
                        props,
                        `/projects/${project.id}/task-types/${taskType.id}/integration`
                      )}
                    >
                      Integrate
                    </a>
                  </div>
                </div>
              ))}
              {!(taskTypes[project.id] ?? []).length ? (
                <p className="text-sm text-muted-foreground">No task types yet.</p>
              ) : null}
            </div>
          </article>
        ))}
        {!projects.length && !error ? (
          <p className="rounded-md border p-6 text-sm text-muted-foreground">
            No RunLynk project is bound to this workspace yet.
          </p>
        ) : null}
      </section>
    </main>
  );
}
