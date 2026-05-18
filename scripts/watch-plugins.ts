/**
 * Plugin directory watcher.
 *
 * Watches definePlugin-based plugin roots and regenerates generated plugin map files
 * during local development.
 */

/* eslint-disable no-console */
import chokidar from 'chokidar';
import { execSync } from 'child_process';
import path from 'path';
import ora, { Ora } from 'ora';
import { getPluginSourceTargets } from '@/lib/plugin-runtime/plugin-source-dirs';

const DEBOUNCE_DELAY = 300;
const WATCHED_SOURCE_SEGMENTS = new Set([
  'api',
  'components',
  'events',
  'jobs',
  'webhooks',
  'lifecycle',
  'pages',
  'slots',
]);
const SOURCE_TARGETS = getPluginSourceTargets().filter((target) => target.exists);

let debounceTimer: NodeJS.Timeout | null = null;
let isGenerating = false;
let spinner: Ora | null = null;

function regeneratePluginMap() {
  if (isGenerating) {
    console.log('Generation task already running, skipping...');
    return;
  }

  isGenerating = true;
  spinner = ora('Plugin changes detected, regenerating map...').start();

  try {
    execSync('npx tsx scripts/generate-plugin-map.ts', {
      stdio: 'pipe',
      cwd: process.cwd(),
    });

    spinner.succeed('Plugin map updated successfully');
  } catch (error) {
    spinner.fail('Generation failed');
    console.error('Error details:', error);
  } finally {
    isGenerating = false;
    spinner = null;
  }
}

function scheduleRegeneration() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    regeneratePluginMap();
    debounceTimer = null;
  }, DEBOUNCE_DELAY);
}

function shouldRegenerateForChange(filePath: string): boolean {
  const fileName = path.basename(filePath);
  if (fileName === 'plugin.ts' || fileName === 'plugin.dependencies.json') {
    return true;
  }

  const sourceTarget = SOURCE_TARGETS.find((target) => {
    const relative = path.relative(target.path, filePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
  if (!sourceTarget) {
    return false;
  }

  const relativePath = path.relative(sourceTarget.path, filePath);
  const segments = relativePath.split(path.sep).filter(Boolean);
  const firstSourceSegment = sourceTarget.directPluginRoot ? segments[0] : segments[1];
  return Boolean(firstSourceSegment && WATCHED_SOURCE_SEGMENTS.has(firstSourceSegment));
}

function shouldRegenerateForDirectoryChange(dirPath: string): boolean {
  const sourceTarget = SOURCE_TARGETS.find((target) => {
    const relative = path.relative(target.path, dirPath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
  if (!sourceTarget) {
    return false;
  }

  const relativePath = path.relative(sourceTarget.path, dirPath);
  const segments = relativePath.split(path.sep).filter(Boolean);
  if (sourceTarget.directPluginRoot) {
    return segments.length === 0 || WATCHED_SOURCE_SEGMENTS.has(segments[0] ?? '');
  }

  return segments.length === 1 || Boolean(segments[1] && WATCHED_SOURCE_SEGMENTS.has(segments[1]));
}

function startWatching() {
  console.log('');
  console.log('Plugin watcher started');
  console.log('Watching directories:');
  for (const target of SOURCE_TARGETS) {
    console.log(`   - ${target.displayPath}${target.kind === 'external' ? ' (external)' : ''}`);
  }
  console.log('Watching files: plugin.ts, api/**, pages/**, components/**, slots/**, events/**');
  console.log('Hot reload enabled, no server restart needed');
  console.log('');

  const watcher = chokidar.watch(
    SOURCE_TARGETS.map((target) => target.path),
    {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/*.test.*',
        '**/*.spec.*',
        '**/*.md',
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    }
  );

  watcher
    .on('add', (filePath) => {
      if (!shouldRegenerateForChange(filePath)) {
        return;
      }

      const relativePath = path.relative(process.cwd(), filePath);
      console.log(`Added: ${relativePath}`);
      scheduleRegeneration();
    })
    .on('change', (filePath) => {
      if (!shouldRegenerateForChange(filePath)) {
        return;
      }

      const relativePath = path.relative(process.cwd(), filePath);
      console.log(`Modified: ${relativePath}`);
      scheduleRegeneration();
    })
    .on('unlink', (filePath) => {
      if (!shouldRegenerateForChange(filePath)) {
        return;
      }

      const relativePath = path.relative(process.cwd(), filePath);
      console.log(`Deleted: ${relativePath}`);
      scheduleRegeneration();
    })
    .on('addDir', (dirPath) => {
      if (!shouldRegenerateForDirectoryChange(dirPath)) {
        return;
      }

      const relativePath = path.relative(process.cwd(), dirPath);
      console.log(`Added directory: ${relativePath}`);
      scheduleRegeneration();
    })
    .on('unlinkDir', (dirPath) => {
      if (!shouldRegenerateForDirectoryChange(dirPath)) {
        return;
      }

      const relativePath = path.relative(process.cwd(), dirPath);
      console.log(`Deleted directory: ${relativePath}`);
      scheduleRegeneration();
    })
    .on('error', (error) => {
      console.error('Watch error:', error);
    })
    .on('ready', () => {
      console.log('Watcher ready');
      console.log('');
      regeneratePluginMap();
    });

  process.on('SIGINT', () => {
    console.log('\nStopping plugin directory watcher...');
    void watcher.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    void watcher.close();
    process.exit(0);
  });
}

startWatching();
