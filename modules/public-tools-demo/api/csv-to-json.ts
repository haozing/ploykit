import { defineApi } from '@ploykit/module-sdk';
import { delimitedToObjects } from '../lib/csv';

export default defineApi({
  async post(ctx) {
    const input = await ctx.request.json<{ source?: string; delimiter?: ',' | '\t' | 'tab' }>();

    try {
      const records = delimitedToObjects(input.source ?? '', input.delimiter);
      const output = JSON.stringify(records, null, 2);
      return ctx.json({ ok: true, output, rows: records.length });
    } catch (error) {
      return ctx.json(
        {
          ok: false,
          code: 'PUBLIC_TOOLS_CSV_CONVERSION_FAILED',
          message: error instanceof Error ? error.message : 'CSV conversion failed.',
        },
        { status: 400 }
      );
    }
  },
});
