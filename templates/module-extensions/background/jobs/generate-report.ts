import type { ModuleContext } from '@ploykit/module-sdk';

export default async function generateReport(
  ctx: ModuleContext,
  input: { requestedAt?: string } = {},
  run: { id: string }
) {
  const artifact = await ctx.artifacts.write({
    name: '__MODULE_ID__ report',
    kind: 'markdown',
    runId: run.id,
    path: `runs/${run.id}/report.md`,
    content: `# __MODULE_NAME__ report\n\nRequested at: ${input.requestedAt ?? 'unknown'}`,
  });

  if (ctx.user) {
    await ctx.notifications.send({
      userId: ctx.user.id,
      title: '__MODULE_NAME__ report ready',
      runId: run.id,
    });
  }

  return { artifact };
}
