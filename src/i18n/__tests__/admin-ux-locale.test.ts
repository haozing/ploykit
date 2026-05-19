import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function loadLocale(lang: 'en' | 'zh') {
  return JSON.parse(readFileSync(join(process.cwd(), 'locales', `${lang}.json`), 'utf8')) as {
    dashboard: Record<string, unknown>;
  };
}

describe('admin ux locale coverage', () => {
  it.each(['en', 'zh'] as const)('covers service connection admin labels in %s', (lang) => {
    const messages = loadLocale(lang);
    const serviceConnections = messages.dashboard.serviceConnections as Record<string, unknown>;

    expect(serviceConnections).toHaveProperty('filters.title');
    expect(serviceConnections).toHaveProperty('requirements.headers.actorClaims');
    expect(serviceConnections).toHaveProperty('editor.sections.actorClaims');
    expect(serviceConnections).toHaveProperty('secretSourceOptions.keepExistingPlaceholder');
    expect(serviceConnections).toHaveProperty('rotation.newSecretPlaceholder');
  });

  it.each(['en', 'zh'] as const)('covers admin dashboard status labels in %s', (lang) => {
    const messages = loadLocale(lang);
    const admin = messages.dashboard.admin as Record<string, unknown>;

    expect(admin).toHaveProperty('stats.activeAssignments');
    expect(admin).toHaveProperty('recentUsers.status.active');
    expect(admin).toHaveProperty('systemStatus.latencyAvg');
    expect(admin).toHaveProperty('systemStatus.status.operational');
  });

  it.each(['en', 'zh'] as const)('covers plan capability schema labels in %s', (lang) => {
    const messages = loadLocale(lang);
    const entitlements = messages.dashboard.entitlements as Record<string, unknown>;

    expect(entitlements).toHaveProperty('planDialogV2.capabilities.schema.title');
    expect(entitlements).toHaveProperty('planDialogV2.capabilities.errors.required');
    expect(entitlements).toHaveProperty('planDialogV2.capabilities.json.help');
  });
});
