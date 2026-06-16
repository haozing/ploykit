import childProcess from 'node:child_process';

export function runLocalScript(projectRoot, script, args) {
  const result = childProcess.spawnSync(process.execPath, [script, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: node ${script} ${args.join(' ')}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join('\n')
    );
  }
}

export function runSdkContractValidation(options) {
  const { projectRoot, cliFile, moduleRoot, timeoutMs, diagnostic, normalizeDiagnostic } = options;
  const result = childProcess.spawnSync(
    process.execPath,
    [cliFile, 'validate-contract-internal', moduleRoot],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: timeoutMs,
    }
  );

  if (result.error) {
    const isTimeout = result.error.code === 'ETIMEDOUT';
    return [
      diagnostic(
        'error',
        isTimeout ? 'MODULE_CONTRACT_EVALUATION_TIMEOUT' : 'MODULE_CONTRACT_EVALUATION_FAILED',
        isTimeout ? `module.ts contract evaluation exceeded ${timeoutMs}ms.` : result.error.message,
        'module.ts',
        'Keep module.ts side-effect free and export defineModule(...).'
      ),
    ];
  }

  try {
    const payload = JSON.parse(result.stdout);
    return Array.isArray(payload.diagnostics)
      ? payload.diagnostics.map((item) => normalizeDiagnostic(item))
      : [
          diagnostic(
            'error',
            'MODULE_CONTRACT_EVALUATION_FAILED',
            'Contract validator did not return diagnostics.',
            'module.ts',
            'Ensure module.ts exports defineModule(...) and compiles.'
          ),
        ];
  } catch (error) {
    return [
      diagnostic(
        'error',
        'MODULE_CONTRACT_EVALUATION_FAILED',
        [
          error instanceof Error ? error.message : String(error),
          result.stdout.trim(),
          result.stderr.trim(),
        ]
          .filter(Boolean)
          .join('\n'),
        'module.ts',
        'Ensure module.ts exports defineModule(...) and compiles.'
      ),
    ];
  }
}
