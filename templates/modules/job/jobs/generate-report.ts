import type { ModuleContext } from '@ploykit/module-sdk';

export default async function generateReport(
  ctx: ModuleContext,
  input: { title?: string } = {},
  run: { id: string }
) {
  const artifact = await ctx.artifacts.write({
    name: input.title ?? 'report',
    kind: 'markdown',
    runId: run.id,
    path: `runs/${run.id}/report.md`,
    content: `# ${input.title ?? 'Report'}`,
  });

  if (ctx.user) {
    await ctx.notifications.send({
      userId: ctx.user.id,
      title: 'Report ready',
      runId: run.id,
    });
  }

  return { artifactId: artifact.id };
}
