/**
 * Plugin directory watcher.
 *
 * Watches definePlugin-based plugin roots and regenerates src/lib/plugin-map.ts
 * during local development.
 */

/* eslint-disable no-console */
import chokidar from 'chokidar';
import { execSync } from 'child_process';
import path from 'path';
import ora, { Ora } from 'ora';

const PLUGINS_DIR = path.join(process.cwd(), 'plugins');
const DEBOUNCE_DELAY = 300;
const WATCHED_SOURCE_SEGMENTS = new Set([
  'api',
  'events',
  'jobs',
  'webhooks',
  'lifecycle',
  'pages',
]);

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

  const relativePath = path.relative(PLUGINS_DIR, filePath);
  const [pluginId, firstSegment] = relativePath.split(path.sep);
  if (!pluginId || !firstSegment) {
    return false;
  }

  return WATCHED_SOURCE_SEGMENTS.has(firstSegment);
}

function isPluginRootDirectory(dirPath: string): boolean {
  const pluginsDirDepth = PLUGINS_DIR.split(path.sep).length;
  const currentDepth = dirPath.split(path.sep).length;

  return currentDepth === pluginsDirDepth + 1;
}

function startWatching() {
  console.log('');
  console.log('Plugin watcher started');
  console.log('Watching directory:', PLUGINS_DIR);
  console.log(
    'Watching files: plugin.ts, api/**, pages/**, events/**, jobs/**, webhooks/**, lifecycle/**'
  );
  console.log('Hot reload enabled, no server restart needed');
  console.log('');

  const watcher = chokidar.watch(PLUGINS_DIR, {
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
  });

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
      if (!isPluginRootDirectory(dirPath)) {
        return;
      }

      const relativePath = path.relative(process.cwd(), dirPath);
      console.log(`Added plugin directory: ${relativePath}`);
      scheduleRegeneration();
    })
    .on('unlinkDir', (dirPath) => {
      if (!isPluginRootDirectory(dirPath)) {
        return;
      }

      const relativePath = path.relative(process.cwd(), dirPath);
      console.log(`Deleted plugin directory: ${relativePath}`);
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
