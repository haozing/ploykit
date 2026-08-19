import { action } from '@ploykit/module-sdk';

function formatJson(source: string): string {
  return JSON.stringify(JSON.parse(source), null, 2);
}

export default action(async function formatSample(_ctx, input: { source?: string } = {}) {
  try {
    return {
      ok: true,
      output: formatJson(input.source ?? '{}'),
    };
  } catch {
    return {
      ok: false,
      output: 'Invalid JSON',
    };
  }
});
