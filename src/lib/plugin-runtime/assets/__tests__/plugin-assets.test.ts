import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { definePlugin } from '@ploykit/plugin-sdk';
import { normalizePluginRuntimeContract } from '../../contract';
import {
  createPluginAssetUrl,
  listPluginRuntimeAssets,
  readPluginAsset,
} from '../plugin-assets.server';
import type { PluginRuntimeMapEntry } from '../../loader';

const tempRoots: string[] = [];

function createAssetFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ploykit-plugin-assets-'));
  const pluginRoot = path.join(tempRoot, 'asset-plugin');
  fs.mkdirSync(path.join(pluginRoot, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'assets', 'icon.abcdef12.png'), 'png');
  fs.writeFileSync(
    path.join(pluginRoot, 'assets', 'editor.worker.js'),
    'self.onmessage = () => {};'
  );
  tempRoots.push(tempRoot);

  const contract = normalizePluginRuntimeContract(
    definePlugin({
      id: 'asset-plugin',
      name: 'Asset Plugin',
      version: '1.0.0',
      resources: {
        assets: [
          './assets/icon.abcdef12.png',
          {
            path: './assets/editor.worker.js',
            kind: 'worker',
            contentType: 'application/javascript; charset=utf-8',
            maxBytes: 1024,
          },
        ],
      },
    })
  );
  const entry: PluginRuntimeMapEntry = {
    rootDir: path.relative(process.cwd(), pluginRoot).replace(/\\/g, '/'),
    runtimeContract: contract,
  };

  return { contract, entry };
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('plugin runtime assets', () => {
  it('creates stable host URLs and cache metadata for declared assets', () => {
    const { contract } = createAssetFixture();

    expect(createPluginAssetUrl('asset-plugin', './assets/icon.abcdef12.png')).toBe(
      '/api/plugin-assets/asset-plugin/assets/icon.abcdef12.png'
    );
    expect(listPluginRuntimeAssets(contract)).toEqual([
      expect.objectContaining({
        path: 'assets/icon.abcdef12.png',
        url: '/api/plugin-assets/asset-plugin/assets/icon.abcdef12.png',
        kind: 'asset',
        contentType: 'image/png',
        cacheControl: 'public, max-age=31536000, immutable',
      }),
      expect.objectContaining({
        path: 'assets/editor.worker.js',
        url: '/api/plugin-assets/asset-plugin/assets/editor.worker.js',
        kind: 'worker',
        contentType: 'application/javascript; charset=utf-8',
      }),
    ]);
  });

  it('serves only declared assets inside the plugin root', async () => {
    const { contract, entry } = createAssetFixture();

    await expect(
      readPluginAsset(contract, entry, 'assets/icon.abcdef12.png')
    ).resolves.toMatchObject({
      path: 'assets/icon.abcdef12.png',
      contentType: 'image/png',
      size: 3,
    });
    await expect(readPluginAsset(contract, entry, 'assets/missing.png')).rejects.toMatchObject({
      code: 'PLUGIN_ASSET_NOT_DECLARED',
    });
    await expect(readPluginAsset(contract, entry, '../package.json')).rejects.toMatchObject({
      code: 'PLUGIN_ASSET_PATH_INVALID',
    });
  });
});
