import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();
const MANIFEST_FILE = path.join(PROJECT_ROOT, 'src', 'lib', 'module-map.manifest.json');

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  const enabled = new Set();
  for (let index = 2; index < process.argv.length; index += 1) {
    if (process.argv[index] === '--module') {
      enabled.add(process.argv[index + 1]);
      index += 1;
    }
  }

  const modules = (manifest.modules ?? [])
    .filter((moduleInfo) => enabled.size === 0 || enabled.has(moduleInfo.id))
    .map((moduleInfo) => ({
      id: moduleInfo.id,
      name: moduleInfo.name,
      version: moduleInfo.version,
      rootDir: moduleInfo.rootDir,
      files: {
        pages: moduleInfo.pages ?? [],
        apis: moduleInfo.apis ?? [],
        loaders: moduleInfo.loaders ?? [],
        actions: moduleInfo.actions ?? [],
        surfaces: moduleInfo.surfaces ?? [],
        lifecycle: moduleInfo.lifecycle ?? [],
        jobs: moduleInfo.jobs ?? [],
        events: moduleInfo.events ?? [],
        webhooks: moduleInfo.webhooks ?? [],
        assets: moduleInfo.assets ?? [],
      },
    }));

  process.stdout.write(
    `${JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        modules,
      },
      null,
      2
    )}\n`
  );
}

main();
