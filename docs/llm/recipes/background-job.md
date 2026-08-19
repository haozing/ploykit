# Recipe: Background Job

Intent: move long work into declared jobs with observable runs and artifacts.

## Use

- Declare `jobs` and the action or API that enqueues work.
- Enqueue through `ctx.jobs.enqueue`.
- Write artifacts, usage, and notifications from the job when needed.
- Permissions: `Permission.JobsEnqueue`, `Permission.JobsRegister`, `Permission.ArtifactsWrite`, `Permission.NotificationsSend`, and `Permission.UsageWrite` as needed.

## Contract Shape

```ts
import { defineModule, Permission } from '@ploykit/module-sdk';

export default defineModule({
  id: 'reports',
  name: 'Reports',
  version: '0.1.0',
  permissions: [
    Permission.JobsEnqueue,
    Permission.JobsRegister,
    Permission.ArtifactsWrite,
    Permission.NotificationsSend,
    Permission.UsageWrite,
  ],
  jobs: {
    generate_report: {
      handler: './jobs/generate-report',
      timeoutMs: 15000,
      retries: 2,
    },
  },
});
```

## Job Shape

```ts
export default async function generateReport(ctx: ModuleContext, input = {}, run) {
  const artifact = await ctx.artifacts.write({
    name: 'report',
    kind: 'markdown',
    runId: run.id,
    path: `runs/${run.id}/report.md`,
    content: '# Report',
  });
  if (ctx.user) {
    await ctx.notifications.send({ userId: ctx.user.id, title: 'Report ready', runId: run.id });
  }
  return { ok: true, artifactId: artifact.id };
}
```

## Verify

Run:

```bash
npm run modules:scan
npm run module:doctor -- <id>
npm run module:test -- <id> --summary
```

## Red Lines

- Do not do slow work in loaders or page components.
- Do not create hidden local queues.
- Do not omit run or artifact evidence for long work.
