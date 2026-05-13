import { defineApi, z } from '@ploykit/plugin-sdk';

const csvConvertSchema = z.object({
  fileName: z.string().min(1).default('input.csv'),
  csv: z.string().min(1).default('name,count\nAlpha,1\nBeta,2'),
});

function parseCsv(csv: string): Array<Record<string, string>> {
  const [headerLine, ...lines] = csv.trim().split(/\r?\n/);
  const headers = headerLine.split(',').map((header) => header.trim());
  return lines
    .filter((line) => line.trim())
    .map((line) => {
      const values = line.split(',').map((value) => value.trim());
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    });
}

export default defineApi({
  async post(ctx) {
    const input = await ctx.request.json(csvConvertSchema);
    const scope = { type: 'user' as const, id: ctx.user?.id };
    await ctx.rateLimit.check({
      bucket: 'capability-demo.csv.convert',
      limit: 60,
      window: '1m',
    });

    const sourceBytes = Buffer.from(input.csv, 'utf8');
    const source = await ctx.files.createUpload({
      scope,
      fileName: input.fileName,
      contentType: 'text/csv',
      size: sourceBytes.byteLength,
      purpose: 'source',
      body: sourceBytes,
      metadata: { api: 'csv-convert' },
    });

    const rows = parseCsv(input.csv);
    const json = JSON.stringify(rows, null, 2);
    const resultBytes = Buffer.from(json, 'utf8');
    const result = await ctx.files.createUpload({
      scope,
      fileName: input.fileName.replace(/\.csv$/i, '') + '.json',
      contentType: 'application/json',
      size: resultBytes.byteLength,
      purpose: 'result',
      body: resultBytes,
      metadata: { sourceFileId: source.id, rows: rows.length },
    });
    const metering = await ctx.metering.commit({
      meter: 'capability-demo.csv.request',
      amount: 1,
      idempotencyKey: `capability-demo:csv:${source.id}`,
      metadata: { rows: rows.length },
    });
    await ctx.audit.record('capability-demo.csv.convert', {
      sourceFileId: source.id,
      resultFileId: result.id,
      rows: rows.length,
    });

    return ctx.json({
      rows,
      sourceFileId: source.id,
      resultFileId: result.id,
      metering,
    });
  },
});
