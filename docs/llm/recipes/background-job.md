# Recipe: Background Job

Intent: move long work into declared jobs with observable runs and artifacts.

## Use

- `module.ts`: `jobs` and any action/API route that requests work.
- Runtime: enqueue through host job APIs and write artifacts/notifications from the job.
- Permissions: `Permission.JobsEnqueue`, `Permission.JobsRegister`, `Permission.ArtifactsWrite`, `Permission.NotificationsSend`, `Permission.UsageWrite`.
- Reference: `modules/capability-demo/module.ts` and `modules/capability-demo/jobs/generate-report.ts`.

## Contract Shape

```ts
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
- Do not omit run/artifact evidence for long work.
