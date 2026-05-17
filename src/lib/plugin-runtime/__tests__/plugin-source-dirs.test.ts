import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EXTERNAL_PLUGIN_DIRS_ENV,
  discoverPluginRootsInSourceTarget,
  getPluginSourceTargets,
} from '../plugin-source-dirs';

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ploykit-plugin-source-'));
  tempRoots.push(root);
  return root;
}

function writePlugin(root: string, pluginId: string): string {
  const pluginRoot = path.join(root, pluginId);
  fs.mkdirSync(pluginRoot, { recursive: true });
  fs.writeFileSync(
    path.join(pluginRoot, 'plugin.ts'),
    "import { definePlugin } from '@ploykit/plugin-sdk';\nexport default definePlugin({ id: '" +
      pluginId +
      "', name: '" +
      pluginId +
      "', version: '0.1.0' });\n",
    'utf-8'
  );
  return pluginRoot;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('plugin source directories', () => {
  function envWithPluginDirs(value: string): NodeJS.ProcessEnv {
    return { ...process.env, [EXTERNAL_PLUGIN_DIRS_ENV]: value };
  }

  it('includes default plugins and configured external directories', () => {
    const cwd = makeTempRoot();
    const externalRoot = makeTempRoot();
    fs.mkdirSync(path.join(cwd, 'plugins'), { recursive: true });

    const targets = getPluginSourceTargets({
      cwd,
      env: envWithPluginDirs(externalRoot),
    });

    expect(targets.map((target) => target.kind)).toEqual(['default', 'external']);
    expect(targets.map((target) => target.path)).toEqual([path.join(cwd, 'plugins'), externalRoot]);
    expect(targets.every((target) => target.exists)).toBe(true);
  });

  it('discovers plugin roots from both collection and direct plugin targets', () => {
    const collectionRoot = makeTempRoot();
    const directRoot = path.join(makeTempRoot(), 'direct-plugin');
    const collectionPlugin = writePlugin(collectionRoot, 'external-collection-plugin');
    fs.mkdirSync(directRoot, { recursive: true });
    fs.writeFileSync(path.join(directRoot, 'plugin.ts'), 'export default {};\n', 'utf-8');

    const [collectionTarget] = getPluginSourceTargets({
      cwd: collectionRoot,
      includeDefault: false,
      env: envWithPluginDirs(collectionRoot),
    });
    const [directTarget] = getPluginSourceTargets({
      cwd: collectionRoot,
      includeDefault: false,
      env: envWithPluginDirs(directRoot),
    });

    expect(discoverPluginRootsInSourceTarget(collectionTarget!)).toEqual([collectionPlugin]);
    expect(discoverPluginRootsInSourceTarget(directTarget!)).toEqual([directRoot]);
  });
});
