import { checkPluginTargets } from '@/lib/plugin-runtime/checks';
import { listLegacyPluginDirectories } from '@/lib/plugin-runtime/dev-console/legacy-plugin-scan.server';
import { getPluginSourceTargets } from '@/lib/plugin-runtime/plugin-source-dirs';
import type { RuntimeCheck } from '../types';

export const pluginRuntimeCheck: RuntimeCheck = {
  name: 'plugin-runtime',
  description: 'Validate definePlugin contract roots and legacy plugin boundary',

  async run() {
    const targetPaths = getPluginSourceTargets()
      .filter((target) => target.exists)
      .map((target) => target.path);
    const checkReports = await Promise.all(
      targetPaths.map((targetPath) => checkPluginTargets(targetPath))
    );
    const legacy = targetPaths.flatMap((targetPath) => listLegacyPluginDirectories(targetPath));
    const diagnostics = checkReports.flatMap((report) => report.diagnostics);
    const checked = checkReports.reduce((total, report) => total + report.checked, 0);
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning');

    if (errors.length > 0) {
      return {
        key: 'plugin-runtime',
        status: 'failed',
        severity: 'error',
        message: `Plugin runtime contract check failed for ${checked} plugin(s)`,
        details: {
          targetPaths: checkReports.map((report) => report.targetPath),
          checked,
          errors,
          warnings,
          legacyPluginDirectories: legacy,
        },
        fix: 'Run npm run plugin:check -- <plugin-source-dir> and fix the reported plugin.ts diagnostics.',
      };
    }

    if (legacy.length > 0) {
      return {
        key: 'plugin-runtime',
        status: 'failed',
        severity: 'error',
        message: `${legacy.length} legacy plugin directorie(s) still use forbidden manifest/index/api entries`,
        details: {
          targetPaths: checkReports.map((report) => report.targetPath),
          checked,
          legacyPluginDirectories: legacy,
        },
        fix: 'Rewrite legacy plugin directories as plugin.ts definePlugin contracts and remove legacy entry files.',
      };
    }

    return {
      key: 'plugin-runtime',
      status: warnings.length > 0 ? 'warning' : 'ok',
      severity: warnings.length > 0 ? 'warning' : 'info',
      message: `Plugin runtime contracts verified: ${checked} plugin(s)`,
      details: {
        targetPaths: checkReports.map((report) => report.targetPath),
        checked,
        warnings,
        ordinaryTargetRule: 'Plugin runtime targets must use plugin.ts definePlugin contracts.',
      },
    };
  },
};
