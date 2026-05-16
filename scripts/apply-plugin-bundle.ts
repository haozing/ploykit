/* eslint-disable no-console */
import { pluginBundleInstallerService } from '@/lib/plugin-runtime/installer';

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

async function main() {
  const bundleId = readArg('bundle');
  if (!bundleId) {
    throw new Error('Missing --bundle <bundleId>.');
  }

  const result = await pluginBundleInstallerService.applyBundle({
    bundleId,
    productId: readArg('product'),
    environment: readArg('env') ?? readArg('environment'),
    enable: hasFlag('no-enable') ? false : undefined,
    seedInternalServices: hasFlag('no-seed-internal-services') ? false : undefined,
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
