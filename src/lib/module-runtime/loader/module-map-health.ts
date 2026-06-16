import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ModuleRuntimeContract } from '../contract';
import type { ModuleMapArtifact, ModuleMapCapabilitySummary } from './module-map-types';

export type ModuleMapHealthIssueKind =
  | 'missing-map-entry'
  | 'missing-release-metadata'
  | 'contract-digest-drift'
  | 'source-hash-drift'
  | 'capability-summary-drift'
  | 'module-id-mismatch';

export interface ModuleMapHealthIssue {
  moduleId: string;
  kind: ModuleMapHealthIssueKind;
  message: string;
  expected?: string;
  actual?: string;
}

export interface ModuleMapHealthReport {
  ok: boolean;
  buildId?: string;
  generatedAt?: string;
  modules: number;
  issues: readonly ModuleMapHealthIssue[];
}

function slash(value: string): string {
  return value.replace(/\\/g, '/');
}

function hashFile(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function listSourceFiles(root: string): string[] {
  const files: string[] = [];
  const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.sql', '.md']);
  const ignored = new Set(['node_modules', '.next', '.runtime', 'dist']);

  function visit(current: string): void {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.name !== '.ploykit') {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) {
          visit(fullPath);
        }
        continue;
      }
      if (!entry.isFile() || entry.name.includes('.test.')) {
        continue;
      }
      if (extensions.has(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }

  visit(root);
  return files.sort((left, right) =>
    slash(path.relative(root, left)).localeCompare(slash(path.relative(root, right)))
  );
}

function hashSourceFiles(root: string): string {
  const hash = createHash('sha256');
  for (const file of listSourceFiles(root)) {
    hash.update(slash(path.relative(root, file)));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function projectPath(...segments: string[]): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), ...segments);
}

export function checkModuleMapHealth(input: {
  artifact: ModuleMapArtifact;
  contracts: readonly ModuleRuntimeContract[];
}): ModuleMapHealthReport {
  const issues: ModuleMapHealthIssue[] = [];

  for (const contract of input.contracts) {
    const entry = input.artifact.modules[contract.id];
    if (!entry) {
      issues.push({
        moduleId: contract.id,
        kind: 'missing-map-entry',
        message: `Contract "${contract.id}" is loaded but missing from module map.`,
      });
      continue;
    }

    if (!entry.release) {
      issues.push({
        moduleId: contract.id,
        kind: 'missing-release-metadata',
        message: `Module "${contract.id}" has no release metadata in module map.`,
      });
      continue;
    }

    if (entry.rootDir) {
      const moduleFile = projectPath(entry.rootDir, 'module.ts');
      if (fs.existsSync(moduleFile)) {
        const digest = hashFile(moduleFile);
        if (entry.release.contractDigest !== digest) {
          issues.push({
            moduleId: contract.id,
            kind: 'contract-digest-drift',
            message: `Module "${contract.id}" module.ts digest differs from generated module map.`,
            expected: entry.release.contractDigest,
            actual: digest,
          });
        }
      }

      const moduleRoot = projectPath(entry.rootDir);
      if (fs.existsSync(moduleRoot)) {
        const sourceHash = hashSourceFiles(moduleRoot);
        if (entry.release.sourceHash !== sourceHash) {
          issues.push({
            moduleId: contract.id,
            kind: 'source-hash-drift',
            message: `Module "${contract.id}" source hash differs from generated module map.`,
            expected: entry.release.sourceHash,
            actual: sourceHash,
          });
        }
      }
    }

    const mapSummary = entry.release.capabilitySummary;
    const runtimeSummary = contract.capabilitySummary;
    const expectedSummary = {
      routes:
        runtimeSummary.routes.site +
        runtimeSummary.routes.dashboard +
        runtimeSummary.routes.admin +
        runtimeSummary.routes.api,
      dataModels:
        runtimeSummary.data.tables.length +
        runtimeSummary.data.documents.length +
        runtimeSummary.data.views.length,
      permissions: runtimeSummary.permissions.length,
      backgroundHandlers:
        runtimeSummary.backgroundHandlers.jobs.length +
        runtimeSummary.backgroundHandlers.eventSubscribes.length +
        runtimeSummary.backgroundHandlers.webhooks.length,
      providerRequirements:
        runtimeSummary.providerRequirements.services.length +
        runtimeSummary.providerRequirements.resourceBindings.length +
        runtimeSummary.providerRequirements.egressOrigins.length,
      commercialRequirements:
        runtimeSummary.commercialRequirements.meters.length +
        runtimeSummary.commercialRequirements.routeEntitlements.length +
        runtimeSummary.commercialRequirements.actionEntitlements.length +
        (runtimeSummary.commercialRequirements.creditsRequired ? 1 : 0),
      presentationContributions:
        runtimeSummary.presentationContribution.navigation +
        runtimeSummary.presentationContribution.surfaces.length +
        runtimeSummary.presentationContribution.replaces.length +
        runtimeSummary.presentationContribution.themeTokens.length,
    } satisfies ModuleMapCapabilitySummary;

    for (const [field, expected] of Object.entries(expectedSummary)) {
      const actual = mapSummary[field as keyof typeof mapSummary];
      if (typeof actual === 'number' && actual !== expected) {
        issues.push({
          moduleId: contract.id,
          kind: 'capability-summary-drift',
          message: `Module "${contract.id}" map capability summary "${field}" differs from runtime contract.`,
          expected: String(expected),
          actual: String(actual),
        });
      }
    }
  }

  for (const moduleId of Object.keys(input.artifact.modules)) {
    if (!input.contracts.some((contract) => contract.id === moduleId)) {
      issues.push({
        moduleId,
        kind: 'module-id-mismatch',
        message: `Module map entry "${moduleId}" did not load a matching runtime contract.`,
      });
    }
  }

  return {
    ok: issues.length === 0,
    buildId: input.artifact.buildId,
    generatedAt: input.artifact.generatedAt,
    modules: Object.keys(input.artifact.modules).length,
    issues,
  };
}
