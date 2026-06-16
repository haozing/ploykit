import {
  extractDeclaredNpmDependencyReport,
  readHostPackageManifest,
} from './module-dependencies.mjs';

export function createModuleDoctorDependencyRules({
  projectRoot,
  diagnostic,
  normalizeDiagnostic,
}) {
  function checkModuleDependencies(source, diagnostics) {
    const report = extractDeclaredNpmDependencyReport(source);
    for (const item of report.diagnostics) {
      diagnostics.push(normalizeDiagnostic(item));
    }

    const dependencies = report.dependencies.map((dependency) => dependency.name);
    if (dependencies.length === 0) {
      return;
    }

    const packageManifest = readHostPackageManifest(projectRoot);
    const hostDependencies = {
      ...(packageManifest.dependencies ?? {}),
      ...(packageManifest.devDependencies ?? {}),
    };

    for (const dependency of dependencies) {
      if (!hostDependencies[dependency]) {
        diagnostics.push(
          diagnostic(
            'error',
            'MODULE_DEPENDENCY_NOT_HOST_RUNTIME',
            `Module dependency "${dependency}" is not declared by the host runtime package.`,
            `dependencies.npm.${dependency}`,
            `Add "${dependency}" to package.json dependencies or remove it from module.ts.`
          )
        );
      }
    }
  }

  return {
    checkModuleDependencies,
  };
}
