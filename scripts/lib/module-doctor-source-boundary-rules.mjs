import fs from 'node:fs';

import {
  PART_EXPECTED_EXPORTS,
  extractAllContractLocalPaths,
  extractContractParts,
  extractHandlerPaths,
  normalizeLocalModulePath,
} from './module-contract-source.mjs';
import { checkModuleSourceSafety } from './module-source-safety.mjs';

export function createModuleDoctorSourceBoundaryRules({
  projectRoot,
  diagnostic,
  locateInSource,
  toProjectPath,
}) {
  function checkLocalContractPaths(moduleRoot, moduleSource, diagnostics) {
    for (const localPath of extractAllContractLocalPaths(moduleSource)) {
      if (localPath.includes('../')) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_LOCAL_PATH_ESCAPES_ROOT',
            `Module local path "${localPath}" must not escape the module root.`,
            localPath,
            undefined,
            undefined,
            locateInSource(moduleSource, localPath)
          )
        );
        continue;
      }

      if (localPath === './module-sdk' || localPath.startsWith('./.')) {
        continue;
      }

      const resolved = normalizeLocalModulePath(moduleRoot, localPath);
      if (!fs.existsSync(resolved)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_LOCAL_PATH_MISSING',
            `Module local path "${localPath}" does not resolve to a file.`,
            localPath,
            'Create the referenced file inside the module directory or update module.ts.',
            undefined,
            locateInSource(moduleSource, localPath)
          )
        );
      }
    }
  }

  function checkHandlerDefinitions(moduleRoot, moduleSource, diagnostics) {
    for (const localPath of extractHandlerPaths(moduleSource)) {
      const resolved = normalizeLocalModulePath(moduleRoot, localPath);
      if (!fs.existsSync(resolved)) {
        continue;
      }
      const source = fs.readFileSync(resolved, 'utf8');
      if (localPath.startsWith('./api/') && !source.includes('defineApi')) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_API_DEFINE_API_REQUIRED',
            `API handler "${localPath}" must export defineApi(...).`,
            toProjectPath(resolved),
            'Wrap the API methods with defineApi({ get, post, ... }).'
          )
        );
      }
      if (
        localPath.startsWith('./actions/') &&
        !source.includes('action(') &&
        !source.includes('defineAction')
      ) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_ACTION_DEFINE_ACTION_REQUIRED',
            `Action handler "${localPath}" must export action(...) or defineAction(...).`,
            toProjectPath(resolved),
            'Wrap the action handler with action(async (ctx, input) => ...).'
          )
        );
      }
    }
  }

  function checkContractPartFiles(moduleRoot, moduleSource, diagnostics) {
    for (const part of extractContractParts(moduleSource)) {
      const resolved = normalizeLocalModulePath(moduleRoot, part.localPath);
      if (!fs.existsSync(resolved)) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_PART_FILE_MISSING',
            `Contract part "${part.part}" points at missing file "${part.localPath}".`,
            part.localPath,
            'Create the part file or remove the parts entry.',
            { part: part.part },
            locateInSource(moduleSource, part.localPath)
          )
        );
        continue;
      }

      const partSource = fs.readFileSync(resolved, 'utf8');
      const expected = PART_EXPECTED_EXPORTS[part.part];
      if (expected && !expected.test(partSource)) {
        diagnostics.push(
          diagnostic(
            'warning',
            'MODULE_PART_EXPORT_UNCLEAR',
            `Contract part "${part.part}" does not expose an obvious ${part.part} export.`,
            toProjectPath(resolved),
            `Export a named "${part.part}" value or make this file's purpose clear.`,
            { part: part.part }
          )
        );
      }
    }
  }

  function checkSourceBoundaries(moduleRoot, moduleSource, diagnostics) {
    checkLocalContractPaths(moduleRoot, moduleSource, diagnostics);
    checkContractPartFiles(moduleRoot, moduleSource, diagnostics);
    checkModuleSourceSafety({ projectRoot, moduleRoot, diagnostics, diagnostic });
    checkHandlerDefinitions(moduleRoot, moduleSource, diagnostics);
  }

  return {
    checkSourceBoundaries,
  };
}
