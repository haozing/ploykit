import { defineApi } from '@ploykit/module-sdk';

type TextOperation = 'stats' | 'slugify' | 'case';
type TextCaseMode = 'upper' | 'lower' | 'title';

function readOperation(value: unknown): TextOperation {
  return value === 'slugify' || value === 'case' ? value : 'stats';
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function titleCase(value: string): string {
  return value.replace(/\S+/g, (word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1).toLowerCase()}`);
}

function textStats(value: string) {
  const words = value.trim().length === 0 ? [] : value.trim().split(/\s+/);
  const lines = value.length === 0 ? 0 : value.split(/\r\n|\r|\n/).length;
  return {
    characters: value.length,
    words: words.length,
    lines,
  };
}

export default defineApi({
  async post(ctx) {
    const input = await ctx.request.json<{
      source?: string;
      operation?: TextOperation;
      caseMode?: TextCaseMode;
    }>();
    const source = input.source ?? '';
    const operation = readOperation(input.operation);

    if (operation === 'slugify') {
      return ctx.json({ ok: true, output: slugify(source), stats: textStats(source) });
    }
    if (operation === 'case') {
      const output =
        input.caseMode === 'upper'
          ? source.toUpperCase()
          : input.caseMode === 'lower'
            ? source.toLowerCase()
            : titleCase(source);
      return ctx.json({ ok: true, output, stats: textStats(output) });
    }

    return ctx.json({
      ok: true,
      output: JSON.stringify(textStats(source), null, 2),
      stats: textStats(source),
    });
  },
});
