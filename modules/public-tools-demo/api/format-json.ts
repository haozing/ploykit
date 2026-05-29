import { defineApi } from '@ploykit/module-sdk';

export default defineApi({
  async post(ctx) {
    const input = await ctx.request.json<{ source?: string; mode?: 'pretty' | 'minify' }>();

    try {
      const parsed = JSON.parse(input.source ?? '');
      const output = JSON.stringify(parsed, null, input.mode === 'minify' ? 0 : 2);
      return ctx.json({ ok: true, output, bytes: output.length });
    } catch (error) {
      return ctx.json(
        {
          ok: false,
          code: 'PUBLIC_TOOLS_INVALID_JSON',
          message: error instanceof Error ? error.message : 'Invalid JSON.',
        },
        { status: 400 }
      );
    }
  },
});
