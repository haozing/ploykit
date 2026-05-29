#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const runtimeDir = path.join(root, '.runtime');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function latestTimestampDir(parent) {
  if (!fs.existsSync(parent)) return null;
  return fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .at(-1) ?? null;
}

function assertFile(file, label) {
  if (!fs.existsSync(file)) {
    throw new Error(`${label} is missing: ${path.relative(root, file)}`);
  }
  return file;
}

const browserLatestPath = assertFile(path.join(runtimeDir, 'browser-matrix', 'latest.json'), 'browser matrix latest report');
const adminUiGateLatestPath = assertFile(
  path.join(runtimeDir, 'admin-ui-gate', 'latest.json'),
  'Admin UI gate latest report'
);
const accessibilityLatestPath = assertFile(
  path.join(runtimeDir, 'accessibility-smoke', 'latest.json'),
  'accessibility smoke latest report'
);
const mobileHandfeelLatestPath = path.join(runtimeDir, 'admin-mobile-handfeel', 'latest.json');

const themeDirName = latestTimestampDir(path.join(runtimeDir, 'theme-matrix'));
if (!themeDirName) {
  throw new Error('theme matrix latest directory is missing: .runtime/theme-matrix');
}

const browser = readJson(browserLatestPath);
const adminUiGate = readJson(adminUiGateLatestPath);
const accessibility = readJson(accessibilityLatestPath);
const mobileHandfeel = fs.existsSync(mobileHandfeelLatestPath) ? readJson(mobileHandfeelLatestPath) : null;
const themeOutputDir = path.join(runtimeDir, 'theme-matrix', themeDirName);
const themeScreenshots = fs
  .readdirSync(themeOutputDir)
  .filter((name) => name.endsWith('.png'))
  .sort();

const adminBrowserChecks = (browser.checks ?? []).filter((check) => {
  const id = String(check.id ?? '');
  const finalPath = String(check.finalPath ?? '');
  return id.includes('/admin') || finalPath.includes('/admin');
});

const adminThemeScreenshots = themeScreenshots.filter((name) => name.includes('-admin'));

const baseline = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  reports: {
    adminUiGate: {
      ok: adminUiGate.ok === true,
      checkedAt: adminUiGate.checkedAt ?? null,
      report: path.relative(root, adminUiGateLatestPath),
      outputDir: adminUiGate.outputDir ?? null,
      errors: adminUiGate.summary?.errors ?? null,
      warnings: adminUiGate.summary?.warnings ?? null,
      filesScanned: adminUiGate.summary?.filesScanned ?? null,
    },
    browserMatrix: {
      ok: browser.ok === true,
      checkedAt: browser.checkedAt ?? null,
      report: path.relative(root, browserLatestPath),
      outputDir: browser.outputDir ? path.relative(root, browser.outputDir) : null,
      adminCheckCount: adminBrowserChecks.length,
      adminScreenshots: adminBrowserChecks
        .filter((check) => check.screenshot)
        .map((check) => path.relative(root, check.screenshot)),
    },
    themeMatrix: {
      report: path.relative(root, themeOutputDir),
      screenshotCount: themeScreenshots.length,
      adminScreenshotCount: adminThemeScreenshots.length,
      adminScreenshots: adminThemeScreenshots.map((name) => path.join(path.relative(root, themeOutputDir), name)),
    },
    accessibilitySmoke: {
      ok: accessibility.ok === true,
      checkedAt: accessibility.checkedAt ?? null,
      report: path.relative(root, accessibilityLatestPath),
      outputDir: accessibility.outputDir ? path.relative(root, accessibility.outputDir) : null,
    },
    adminMobileHandfeel: mobileHandfeel
      ? {
          ok: mobileHandfeel.ok === true,
          checkedAt: mobileHandfeel.checkedAt ?? null,
          report: path.relative(root, mobileHandfeelLatestPath),
          outputDir: mobileHandfeel.outputDir ? path.relative(root, mobileHandfeel.outputDir) : null,
          checks: mobileHandfeel.summary?.checks ?? null,
          failed: mobileHandfeel.summary?.failed ?? null,
        }
      : null,
  },
  review: {
    source: 'docs/admin-operations.zh-CN.md',
    rule: 'Treat this file as a pinned evidence pointer. Regenerate it after each intentional Admin UI visual pass.',
  },
};

const outputFile = path.join(runtimeDir, 'admin-visual-baseline.json');
fs.mkdirSync(runtimeDir, { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(baseline, null, 2)}\n`);

console.log(JSON.stringify({ ok: true, outputFile: path.relative(root, outputFile), baseline }, null, 2));
