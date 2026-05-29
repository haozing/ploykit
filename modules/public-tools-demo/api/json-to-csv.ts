import { defineApi } from '@ploykit/module-sdk';
import { objectsToDelimited } from '../lib/csv';

export default defineApi({
  async post(ctx) {
    const input = await ctx.request.json<{ source?: string; delimiter?: ',' | '\t' | 'tab' }>();

    try {
      const parsed = JSON.parse(input.source ?? '[]');
      const output = objectsToDelimited(parsed, input.delimiter);
      return ctx.json({ ok: true, output, rows: output ? output.split('\n').length - 1 : 0 });
    } catch (error) {
      return ctx.json(
        {
          ok: false,
          code: 'PUBLIC_TOOLS_JSON_TO_CSV_FAILED',
          message: error instanceof Error ? error.message : 'JSON to CSV conversion failed.',
        },
        { status: 400 }
      );
    }
  },
});
