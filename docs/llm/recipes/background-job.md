# Recipe: Background Job

Use a declared job for work that should outlive the request. Jobs produce observable runs and can use files, notifications, events, and audit as needed.

```ts
export default defineModule({
  id: 'reports',
  name: 'Reports',
  version: '0.1.0',
  profile: 'app',
  capabilities: ['async', 'files', 'notifications'],
  permissions: [
    Permission.JobsEnqueue,
    Permission.FilesWrite,
    Permission.NotificationsSend,
    Permission.AuditWrite,
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

Start the job with `ctx.jobs.run(name, input)`. Use `ctx.files` for generated files and `ctx.runs` for explicit progress or run metadata. Do not create a private queue or write artifact records outside the file boundary.

Run `npm run modules:scan`, `npm run module:doctor -- <id>`, and `npm run module:test -- <id> --summary` after adapting the pattern.
