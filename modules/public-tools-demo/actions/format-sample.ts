import { action, type ModuleContext } from '@ploykit/module-sdk';

export default action(async function formatSample(
  ctx: ModuleContext,
  input: { source?: string; mode?: 'pretty' | 'minify' } = {}
) {
  const parsed = JSON.parse(input.source ?? '{"ploykit":true,"module":"public-tools-demo"}');
  const output = JSON.stringify(parsed, null, input.mode === 'minify' ? 0 : 2);
  await ctx.usage.record({
    meter: 'public_tools.format_sample',
    quantity: output.length,
    unit: 'byte',
  });
  return {
    ok: true,
    output,
    guard: 'commercial credits guard is declared on the action route',
  };
});
