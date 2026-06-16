import fs from 'node:fs';
import path from 'node:path';
import { after } from 'node:test';

const dataFixtureRoots = new Set<string>();

after(() => {
  for (const fixtureRoot of dataFixtureRoots) {
    fs.rmSync(path.join(process.cwd(), fixtureRoot), { recursive: true, force: true });
  }
});

export function writeDataDiffFixture(files: Record<string, string>): string {
  const fixtureRoot = path.join(
    'modules',
    `data-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  dataFixtureRoots.add(fixtureRoot);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(fixtureRoot, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  }
  return fixtureRoot;
}
