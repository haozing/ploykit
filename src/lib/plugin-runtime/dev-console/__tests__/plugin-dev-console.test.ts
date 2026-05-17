import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Permission } from '@/plugin-sdk';
import {
  buildPluginDevConsoleReport,
  getPluginDiagnosticDisplay,
  listLegacyPluginDirectories,
} from '@/lib/plugin-runtime/dev-console';

const tempRoots: string[] = [];

function createTempDir(name: string): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ploykit-dev-console-${name}-`));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function writeFile(root: string, relativePath: string, content: string): void {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('plugin dev console report', () => {
  it('builds a report for a definePlugin target', async () => {
    const pluginRoot = path.resolve(process.cwd(), 'templates/plugins/tool');

    const report = await buildPluginDevConsoleReport({
      targetPaths: [pluginRoot],
      includeActivity: false,
    });

    expect(report.summary).toMatchObject({
      totalPlugins: 1,
      passingPlugins: 1,
      failingPlugins: 0,
      diagnostics: 0,
    });
    expect(report.plugins[0]).toMatchObject({
      pluginId: 'tool',
      success: true,
      contract: expect.objectContaining({
        id: 'tool',
        routes: expect.objectContaining({
          apis: expect.arrayContaining([expect.objectContaining({ path: '/run' })]),
        }),
      }),
      test: expect.objectContaining({
        status: 'ready',
      }),
    });
    expect(report.runtime).toBeNull();
  });

  it('marks manifest-only directories as legacy plugin targets', () => {
    const root = createTempDir('legacy');
    const legacyRoot = path.join(root, 'legacy-tool');
    writeFile(legacyRoot, 'manifest.ts', `export default { id: 'legacy-tool' };`);
    writeFile(legacyRoot, 'index.tsx', `export default function LegacyTool() { return null; }`);

    expect(listLegacyPluginDirectories(root)).toEqual([
      expect.objectContaining({
        id: 'legacy-tool',
        hasManifest: true,
        hasIndexView: true,
      }),
    ]);
  });

  it('marks other old root entry files as legacy plugin targets', () => {
    const root = createTempDir('legacy-api');
    const legacyRoot = path.join(root, 'legacy-api');
    writeFile(legacyRoot, 'api.ts', `export async function handleRequest() {}`);

    expect(listLegacyPluginDirectories(root)).toEqual([
      expect.objectContaining({
        id: 'legacy-api',
        hasManifest: false,
        hasLegacyApi: true,
      }),
    ]);
  });
});

describe('plugin diagnostic presenter', () => {
  it('explains dynamic egress URL warnings with declared origins', () => {
    const display = getPluginDiagnosticDisplay({
      code: 'PLUGIN_EGRESS_DYNAMIC_URL_UNVERIFIED',
      severity: 'warning',
      message:
        'ctx.http.fetch uses a dynamic URL in api/sync.ts:4:9; plugin check cannot prove it matches plugin.ts egress.',
      details: {
        usedIn: 'api/sync.ts',
        line: 4,
        column: 9,
        declaredOrigins: ['https://api.example.com'],
        reason: 'argument is not a static URL',
      },
    });

    expect(display.title).toBe('Dynamic egress URL');
    expect(display.explanation).toContain('runtime egress gate');
    expect(display.fields).toEqual(
      expect.arrayContaining([
        { label: 'Used in', value: 'api/sync.ts' },
        { label: 'Declared origins', value: ['https://api.example.com'] },
      ])
    );
  });

  it('explains dynamic capability warnings with assumed permissions', () => {
    const display = getPluginDiagnosticDisplay({
      code: 'PLUGIN_CAPABILITY_DYNAMIC_ACCESS_UNVERIFIED',
      severity: 'warning',
      message:
        'Dynamic PluginContext capability access "ctx.storage.collection.*" cannot be fully verified by plugin check.',
      details: {
        accessPath: 'ctx.storage.collection.*',
        capability: 'storage',
        assumedPermissions: [Permission.StorageRead, Permission.StorageWrite],
        line: 5,
        column: 13,
      },
    });

    expect(display.title).toBe('Dynamic capability access');
    expect(display.explanation).toContain('counted conservatively');
    expect(display.fields).toEqual(
      expect.arrayContaining([
        { label: 'Access path', value: 'ctx.storage.collection.*' },
        { label: 'Assumed permissions', value: [Permission.StorageRead, Permission.StorageWrite] },
      ])
    );
  });

  it('explains runtime route conflicts with sample paths', () => {
    const display = getPluginDiagnosticDisplay({
      code: 'PLUGIN_RUNTIME_API_ROUTE_CONFLICT',
      severity: 'error',
      message: 'API route "GET /items/:id" overlaps with "GET /items/new".',
      details: {
        method: 'GET',
        path: '/items/:id',
        firstPath: '/items/new',
        firstDeclaration: 'routes.apis.0',
        samplePath: '/items/new',
        reason: 'dynamic segment can match static segment',
      },
    });

    expect(display.title).toBe('API route conflict');
    expect(display.explanation).toContain('same request');
    expect(display.fields).toEqual(
      expect.arrayContaining([
        { label: 'Method', value: 'GET' },
        { label: 'Sample path', value: '/items/new' },
      ])
    );
  });
});
