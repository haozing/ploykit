export function createMigrationDryRunPayload(entries, diagnostics) {
  return {
    success: !hasErrors(diagnostics),
    mode: 'dry-run',
    migrations: entries.map((entry) => ({
      moduleId: entry.moduleId,
      schemaHash: entry.schemaHash,
      path: entry.projectPath,
      bytes: entry.bytes,
    })),
    diagnostics,
  };
}

export function createResetDryRunPayload(resetPlans, diagnostics) {
  return {
    success: !hasErrors(diagnostics),
    mode: 'dry-run',
    resetPlans,
    diagnostics,
    next: 'Pass --force with DATABASE_URL to apply the reset.',
  };
}

function hasErrors(diagnostics) {
  return diagnostics.some((item) => item.severity === 'error');
}
