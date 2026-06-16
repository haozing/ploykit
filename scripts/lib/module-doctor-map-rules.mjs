import fs from 'node:fs';
import path from 'node:path';

import { contractSourceDigest, sourceHash as moduleSourceHash } from './module-digests.mjs';

export function createModuleDoctorMapRules({ projectRoot, diagnostic, slash, toProjectPath }) {
  const moduleMapManifestFile = path.join(projectRoot, 'src', 'lib', 'module-map.manifest.json');

  function sourceHash(moduleRoot) {
    return moduleSourceHash(moduleRoot, { slash });
  }

  function checkModuleMapManifest(moduleRoot, moduleId, diagnostics) {
    if (!fs.existsSync(moduleMapManifestFile)) {
      diagnostics.push(
        diagnostic(
          'warning',
          'MODULE_MAP_MANIFEST_MISSING',
          'Module map manifest is missing.',
          toProjectPath(moduleMapManifestFile),
          'Run npm run modules:scan.'
        )
      );
      return;
    }

    try {
      const manifest = JSON.parse(fs.readFileSync(moduleMapManifestFile, 'utf8'));
      const rootDir = toProjectPath(moduleRoot);
      const found = (manifest.modules ?? []).find(
        (moduleInfo) => moduleInfo.id === moduleId && moduleInfo.rootDir === rootDir
      );
      if (!found) {
        diagnostics.push(
          diagnostic(
            'warning',
            'MODULE_MAP_MANIFEST_STALE',
            `Module "${moduleId}" is not present in the generated module map manifest.`,
            toProjectPath(moduleMapManifestFile),
            'Run npm run modules:scan.'
          )
        );
        return;
      }

      if (!found.release) {
        diagnostics.push(
          diagnostic(
            'warning',
            'MODULE_MAP_RELEASE_METADATA_MISSING',
            `Module "${moduleId}" is present in module map, but release metadata is missing.`,
            toProjectPath(moduleMapManifestFile),
            'Run npm run modules:scan.'
          )
        );
        return;
      }

      const actualSourceHash = sourceHash(moduleRoot);
      if (found.release.sourceHash !== actualSourceHash) {
        diagnostics.push(
          diagnostic(
            'warning',
            'MODULE_MAP_SOURCE_HASH_DRIFT',
            `Module "${moduleId}" source hash differs from generated module map.`,
            toProjectPath(moduleMapManifestFile),
            'Run npm run modules:scan.',
            {
              expected: found.release.sourceHash,
              actual: actualSourceHash,
            }
          )
        );
      }

      const actualContractDigest = contractSourceDigest(moduleRoot);
      if (found.release.contractDigest !== actualContractDigest) {
        diagnostics.push(
          diagnostic(
            'warning',
            'MODULE_MAP_CONTRACT_DIGEST_DRIFT',
            `Module "${moduleId}" contract digest differs from generated module map.`,
            toProjectPath(moduleMapManifestFile),
            'Run npm run modules:scan.',
            {
              expected: found.release.contractDigest,
              actual: actualContractDigest,
            }
          )
        );
      }
    } catch (error) {
      diagnostics.push(
        diagnostic(
          'warning',
          'MODULE_MAP_MANIFEST_INVALID',
          error instanceof Error ? error.message : String(error),
          toProjectPath(moduleMapManifestFile),
          'Run npm run modules:scan.'
        )
      );
    }
  }

  return {
    checkModuleMapManifest,
    sourceHash,
  };
}
