import type { RuntimeChecksResult } from './runtime-checks';

export interface RuntimeMatrixCheck {
  name: string;
  run():
    | Promise<{ ok: boolean; diagnostics?: RuntimeChecksResult['diagnostics'] }>
    | {
        ok: boolean;
        diagnostics?: RuntimeChecksResult['diagnostics'];
      };
}

export async function runRuntimeMatrix(checks: RuntimeMatrixCheck[]): Promise<{
  ok: boolean;
  checks: { name: string; ok: boolean; diagnostics: RuntimeChecksResult['diagnostics'] }[];
}> {
  const results = [];
  for (const check of checks) {
    try {
      const result = await check.run();
      results.push({ name: check.name, ok: result.ok, diagnostics: result.diagnostics ?? [] });
    } catch (error) {
      results.push({
        name: check.name,
        ok: false,
        diagnostics: [
          {
            severity: 'error' as const,
            code: 'RUNTIME_MATRIX_CHECK_FAILED',
            message: error instanceof Error ? error.message : String(error),
            path: check.name,
          },
        ],
      });
    }
  }
  return { ok: results.every((item) => item.ok), checks: results };
}
