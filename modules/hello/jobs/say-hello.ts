import type { ModuleContext } from '@ploykit/module-sdk';

export default async function sayHello(
  ctx: ModuleContext,
  input: { name?: string } = {},
  run: { id: string }
) {
  const name = input.name ?? 'PloyKit';
  const artifact = await ctx.artifacts.write({
    name: 'hello-job-result',
    kind: 'json',
    path: `runs/${run.id}/hello-job-result.json`,
    runId: run.id,
    content: {
      greeting: `Hello, ${name}`,
    },
  });

  if (ctx.user) {
    await ctx.notifications.send({
      userId: ctx.user.id,
      title: 'Hello job finished',
      body: `Generated ${artifact.name}.`,
      runId: run.id,
    });
  }

  return {
    ok: true,
    greeting: `Hello, ${name}`,
    artifactId: artifact.id,
  };
}
