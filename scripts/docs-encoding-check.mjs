import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const targets = ['README.md', 'docs', 'package.json', 'scripts', 'src', 'modules', 'templates'];
const textExtensions = new Set([
  '.cjs',
  '.css',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);
const ignoredDirectories = new Set(['.git', '.next', '.runtime', 'coverage', 'dist', 'node_modules']);
const mojibakePatterns = [
  /\uFFFD/u,
  /\u00E2\u20AC[\u0098-\u009D]/u,
  /\u00EF\u00BF\u00BD/u,
];

function slash(value) {
  return value.replace(/\\/g, '/');
}

function collectFiles(target) {
  const absolute = path.resolve(projectRoot, target);
  if (!fs.existsSync(absolute)) {
    return [];
  }
  const stat = fs.statSync(absolute);
  if (stat.isFile()) {
    return textExtensions.has(path.extname(absolute).toLowerCase()) ? [absolute] : [];
  }
  if (!stat.isDirectory()) {
    return [];
  }
  const files = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...collectFiles(path.join(target, entry.name)));
      }
      continue;
    }
    const child = path.join(absolute, entry.name);
    if (entry.isFile() && textExtensions.has(path.extname(child).toLowerCase())) {
      files.push(child);
    }
  }
  return files;
}

function lineNumber(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

const diagnostics = [];
const files = [...new Set(targets.flatMap(collectFiles))].sort();
for (const file of files) {
  const relative = slash(path.relative(projectRoot, file));
  let source;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch (error) {
    diagnostics.push({
      file: relative,
      line: 1,
      message: error instanceof Error ? error.message : String(error),
    });
    continue;
  }
  for (const pattern of mojibakePatterns) {
    const match = pattern.exec(source);
    if (match) {
      diagnostics.push({
        file: relative,
        line: lineNumber(source, match.index),
        message: 'Possible UTF-8 mojibake or replacement character.',
      });
    }
  }
}

if (diagnostics.length > 0) {
  console.error('Docs encoding check failed.');
  for (const diagnostic of diagnostics) {
    console.error(`${diagnostic.file}:${diagnostic.line} ${diagnostic.message}`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({ ok: true, files: files.length }, null, 2)}\n`);
}
