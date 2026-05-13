import path from 'node:path';
import { checkPluginTargets } from '@/lib/plugin-runtime/checks';
import { listLegacyPluginDirectories } from '@/lib/plugin-runtime/dev-console/legacy-plugin-scan.server';
import type { RuntimeCheck } from '../types';

export const pluginRuntimeCheck: RuntimeCheck = {
  name: 'plugin-runtime',
  description: 'Validate definePlugin contract roots and legacy plugin boundary',

  async run() {
    const targetPath = path.join(process.cwd(), 'plugins');
    const checkReport = await checkPluginTargets(targetPath);
    const legacy = listLegacyPluginDirectories(targetPath);
    const errors = checkReport.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    const warnings = checkReport.diagnostics.filter(
      (diagnostic) => diagnostic.severity === 'warning'
    );

    if (errors.length > 0) {
      return {
        key: 'plugin-runtime',
        status: 'failed',
        severity: 'error',
        message: `Plugin runtime contract check failed for ${checkReport.checked} plugin(s)`,
        details: {
          targetPath: checkReport.targetPath,
          checked: checkReport.checked,
          errors,
          warnings,
          legacyPluginDirectories: legacy,
        },
        fix: 'Run npm run plugin:check -- plugins and fix the reported plugin.ts diagnostics.',
      };
    }

    if (legacy.length > 0) {
      return {
        key: 'plugin-runtime',
        status: 'failed',
        severity: 'error',
        message: `${legacy.length} legacy plugin directorie(s) still use forbidden manifest/index/api entries`,
        details: {
          targetPath: checkReport.targetPath,
          checked: checkReport.checked,
          legacyPluginDirectories: legacy,
        },
        fix: 'Rewrite legacy plugin directories as plugin.ts definePlugin contracts and remove legacy entry files.',
      };
    }

    return {
      key: 'plugin-runtime',
      status: warnings.length > 0 ? 'warning' : 'ok',
      severity: warnings.length > 0 ? 'warning' : 'info',
      message: `Plugin runtime contracts verified: ${checkReport.checked} plugin(s)`,
      details: {
        targetPath: checkReport.targetPath,
        checked: checkReport.checked,
        warnings,
        ordinaryTargetRule: 'Plugin runtime targets must use plugin.ts definePlugin contracts.',
      },
    };
  },
};
