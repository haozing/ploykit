/* eslint-disable no-console */
import { spawnSync } from 'child_process';
import path from 'path';
import { RUNTIME_CATALOG_FILE_ENV } from '@/lib/plugin-runtime/catalog/runtime-catalog-file.server';
import { EXTERNAL_PLUGIN_DIRS_ENV } from '@/lib/plugin-runtime/plugin-source-dirs';

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function hasRuntimeInputs(): boolean {
  return Boolean(
    readArg('catalog') ||
    process.env[RUNTIME_CATALOG_FILE_ENV]?.trim() ||
    process.env[EXTERNAL_PLUGIN_DIRS_ENV]?.trim()
  );
}

function runPluginScan(): void {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', path.join(process.cwd(), 'scripts/generate-plugin-map.ts')],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
    }
  );

  if (result.status !== 0) {
    throw new Error('Plugin map scan failed. Fix diagnostics above, then rerun plugins:apply.');
  }
}

async function runOfflineDryRun(bundleId: string, productId?: string): Promise<boolean> {
  const { getRuntimeAppBundle } = await import('@/lib/plugin-runtime/loader');
  const bundle = getRuntimeAppBundle(bundleId, productId);
  if (!bundle) {
    return false;
  }

  const product = productId ?? bundle.productId;
  console.log(
    JSON.stringify(
      {
        productId: product,
        bundleId: bundle.id,
        dryRun: true,
        steps: [
          {
            type: 'catalog',
            status: 'planned',
            message: 'Synchronize runtime product/suite/bundle catalog.',
          },
          ...bundle.plugins.map((plugin) => ({
            type: 'install',
            pluginId: plugin.pluginId,
            status: 'planned',
            message: `Install plugin "${plugin.pluginId}".`,
          })),
          ...(bundle.seeds?.serviceConnections ?? [])
            .filter((seed) => typeof seed.serviceName === 'string' && seed.serviceName.trim())
            .map((seed) => ({
              type: 'seedServiceConnection',
              serviceName: seed.serviceName,
              ownerType: typeof seed.ownerType === 'string' ? seed.ownerType : 'plugin',
              ownerId: typeof seed.ownerId === 'string' ? seed.ownerId : undefined,
              status: 'planned',
              message: `Seed service connection "${seed.serviceName}".`,
            })),
          ...bundle.plugins
            .filter((plugin) => plugin.enableByDefault)
            .map((plugin) => ({
              type: 'enable',
              pluginId: plugin.pluginId,
              status: 'planned',
              message: `Enable plugin "${plugin.pluginId}".`,
            })),
        ],
      },
      null,
      2
    )
  );
  return true;
}

async function main() {
  const bundleId = readArg('bundle');
  if (!bundleId) {
    throw new Error('Missing --bundle <bundleId>.');
  }

  const catalogFile = readArg('catalog');
  if (catalogFile) {
    process.env[RUNTIME_CATALOG_FILE_ENV] = catalogFile;
  }

  if (!hasFlag('no-scan') && hasRuntimeInputs()) {
    runPluginScan();
  }

  if (hasFlag('dry-run') && (await runOfflineDryRun(bundleId, readArg('product')))) {
    return;
  }

  const { pluginBundleInstallerService } = await import('@/lib/plugin-runtime/installer');
  const result = await pluginBundleInstallerService.applyBundle({
    bundleId,
    productId: readArg('product'),
    environment: readArg('env') ?? readArg('environment'),
    enable: hasFlag('no-enable') ? false : undefined,
    seedServiceConnections: hasFlag('no-seed-service-connections') ? false : undefined,
    dryRun: hasFlag('dry-run'),
    userId: readArg('user') ?? 'system',
  });

  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
