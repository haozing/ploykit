import {
  installMissingModuleNpmDependencies,
  findMissingModuleNpmDependencyReport,
} from './lib/module-dependencies.mjs';

const PROJECT_ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
const install = args.has('--install');
const check = args.has('--check');

try {
  if (install) {
    const result = installMissingModuleNpmDependencies(PROJECT_ROOT);
    console.log(
      JSON.stringify(
        {
          success: result.diagnostics.every((item) => item.severity !== 'error'),
          installed: result.installed,
          missing: result.missing,
          diagnostics: result.diagnostics,
          policy: result.policy,
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  const report = findMissingModuleNpmDependencyReport(PROJECT_ROOT);
  console.log(
    JSON.stringify(
      {
        success: report.success,
        missing: report.missing,
        dependencies: report.dependencies,
        diagnostics: report.diagnostics,
        policy: report.policy,
      },
      null,
      2
    )
  );
  process.exit(check && !report.success ? 1 : 0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
