import { defineApi } from '@ploykit/module-sdk';

function formatJson(source: string): string {
  return JSON.stringify(JSON.parse(source), null, 2);
}

export default defineApi({
  async post(ctx) {
    const body = await ctx.request.json<{ source?: string }>();
    try {
      const output = formatJson(body.source ?? '');
      return ctx.json({ ok: true, output });
    } catch {
      return ctx.json({ ok: false, output: 'Invalid JSON' }, { status: 400 });
    }
  },
});
