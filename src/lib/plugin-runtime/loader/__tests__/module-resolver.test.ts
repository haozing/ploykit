import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { PLUGIN_MAP_FILE_ENV, PLUGIN_MAP_MANIFEST_FILE_ENV } from '../../plugin-map-files';

const tempDirs: string[] = [];
const EXTERNAL_PLUGIN_DIRS_ENV = 'PLOYKIT_PLUGIN_DIRS';

function runResolverSnippet(source: string) {
  return spawnSync(
    process.execPath,
    [
      '--conditions=react-server',
      '--import',
      'tsx',
      '-e',
      `const path = require('node:path');
process.chdir(${JSON.stringify(process.cwd())});
${source}`,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf-8',
    }
  );
}

function writeRuntimeMap(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ploykit-runtime-map-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'plugin-map.cjs');
  fs.writeFileSync(file, `${source}\n`, 'utf-8');
  return file;
}

describe('module resolver runtime plugin map loading', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges an explicitly configured runtime plugin map into the active map', () => {
    const file = writeRuntimeMap(`
module.exports.PLUGIN_MAP = {
  'external-runtime-plugin': {
    rootDir: '/tmp/external-runtime-plugin',
    sourceKind: 'external'
  }
};
`);

    const result = runResolverSnippet(`
process.env.${PLUGIN_MAP_FILE_ENV} = ${JSON.stringify(file)};
const { listPluginRuntimeIds } = require('./src/lib/plugin-runtime/loader/module-resolver.server.ts');
console.log(JSON.stringify(listPluginRuntimeIds()));
`);

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      expect.arrayContaining(['capability-demo', 'external-runtime-plugin'])
    );
  });

  it('fails loudly when an explicitly configured runtime plugin map is missing', () => {
    const missingFile = path.join(os.tmpdir(), 'ploykit-missing-runtime-map.cjs');
    const result = runResolverSnippet(`
process.env.${PLUGIN_MAP_FILE_ENV} = ${JSON.stringify(missingFile)};
const { listPluginRuntimeIds } = require('./src/lib/plugin-runtime/loader/module-resolver.server.ts');
listPluginRuntimeIds();
`);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      `Active runtime plugin map file does not exist: ${missingFile}`
    );
  });

  it('loads the default runtime-only scanner artifact format', () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), '.tmp-ploykit-generated-runtime-map-'));
    tempDirs.push(dir);
    const pluginDir = path.join(dir, 'generated-runtime-plugin');
    const runtimeDir = path.join(dir, '.runtime');
    const mapFile = path.join(runtimeDir, 'plugin-map.cjs');
    const manifestFile = path.join(runtimeDir, 'plugin-map.manifest.json');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, 'plugin.ts'),
      `import { definePlugin } from '@ploykit/plugin-sdk';

export default definePlugin({
  id: 'generated-runtime-plugin',
  name: 'Generated Runtime Plugin',
  version: '1.0.0'
});
`,
      'utf-8'
    );

    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        path.join(process.cwd(), 'scripts/generate-plugin-map.ts'),
        '--runtime-only',
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          [EXTERNAL_PLUGIN_DIRS_ENV]: dir,
          [PLUGIN_MAP_FILE_ENV]: mapFile,
          [PLUGIN_MAP_MANIFEST_FILE_ENV]: manifestFile,
        },
        encoding: 'utf-8',
      }
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const resolverResult = runResolverSnippet(`
process.env.${PLUGIN_MAP_FILE_ENV} = ${JSON.stringify(mapFile)};
process.env.${PLUGIN_MAP_MANIFEST_FILE_ENV} = ${JSON.stringify(manifestFile)};
const { listPluginRuntimeIds } = require('./src/lib/plugin-runtime/loader/module-resolver.server.ts');
console.log(JSON.stringify(listPluginRuntimeIds()));
`);

    expect(resolverResult.status, resolverResult.stderr || resolverResult.stdout).toBe(0);
    expect(JSON.parse(resolverResult.stdout)).toEqual(
      expect.arrayContaining(['capability-demo', 'generated-runtime-plugin'])
    );
  });
});
