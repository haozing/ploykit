import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const codeExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const runtimeCapabilityDirs = [
  'ai',
  'artifacts',
  'commercial',
  'events',
  'files',
  'http',
  'jobs',
  'notifications',
  'rag',
  'services',
  'webhooks',
];
const checks = [
  {
    root: path.join('src', 'lib', 'module-kernel'),
    forbidden: [
      /src\/lib\/module-capabilities\//,
      /module-capabilities\//,
      /apps\/host-next\//,
      /from ['"][^'"]*module-runtime\/(ai|rag|files|commercial|services|webhooks|jobs|notifications|ui|admin)/,
    ],
  },
  {
    root: path.join('src', 'lib', 'module-capabilities'),
    forbidden: [/apps\/host-next\//],
  },
  {
    root: path.join('src', 'lib', 'module-runtime'),
    forbidden: [/module-capabilities\//, /src\/lib\/module-capabilities\//],
  },
];

for (const dir of runtimeCapabilityDirs) {
  const legacyPath = path.join(projectRoot, 'src', 'lib', 'module-runtime', dir);
  if (fs.existsSync(legacyPath)) {
    console.error(`Runtime boundary check failed: capability adapter lives in module-runtime: ${slash(path.relative(projectRoot, legacyPath))}`);
    process.exit(1);
  }
}

function slash(value) {
  return value.replace(/\\/g, '/');
}

function collectFiles(dir) {
  const absolute = path.resolve(projectRoot, dir);
  if (!fs.existsSync(absolute)) {
    return [];
  }
  const files = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = path.join(absolute, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(path.join(dir, entry.name)));
    } else if (entry.isFile() && codeExtensions.has(path.extname(entry.name))) {
      files.push(child);
    }
  }
  return files;
}

function lineNumber(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

const diagnostics = [];
for (const check of checks) {
  for (const file of collectFiles(check.root)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of check.forbidden) {
      const match = pattern.exec(slash(source));
      if (match) {
        diagnostics.push({
          file: slash(path.relative(projectRoot, file)),
          line: lineNumber(source, match.index),
          pattern: String(pattern),
        });
      }
    }
  }
}

if (diagnostics.length > 0) {
  console.error('Runtime boundary check failed.');
  for (const diagnostic of diagnostics) {
    console.error(`${diagnostic.file}:${diagnostic.line} ${diagnostic.pattern}`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({ ok: true }, null, 2)}\n`);
}
