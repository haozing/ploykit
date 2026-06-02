import type { ModuleDependenciesDefinition } from './types';

export interface ModuleNpmDependency {
  name: string;
  range: string;
}

export interface ModuleNpmDependencyInput {
  name: unknown;
  range?: unknown;
  path: string;
  rangePath?: string;
}

export interface ModuleDependencyDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  path: string;
  fix?: string;
}

export interface ModuleNpmDependencyNormalization {
  dependencies: ModuleNpmDependency[];
  diagnostics: ModuleDependencyDiagnostic[];
}

const PACKAGE_NAME_PATTERN =
  /^(?:@[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/)?[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const FORBIDDEN_LOCAL_SOURCE_PATTERN =
  /^(?:workspace|file|link|portal|patch):|^(?:\.{1,2}[\\/]|\/|[a-zA-Z]:[\\/]|~[\\/])/i;
const FORBIDDEN_REMOTE_SOURCE_PATTERN =
  /^(?:git(?::|\+ssh:|\+https:|\+http:)|ssh:|https?:|github:|gitlab:|bitbucket:|gist:)/i;
const NPM_ALIAS_PATTERN = /^npm:/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const WILDCARD_RANGE = '*';

function diagnostic(
  code: string,
  message: string,
  path: string,
  fix?: string
): ModuleDependencyDiagnostic {
  return { severity: 'error', code, message, path, ...(fix ? { fix } : {}) };
}

function dependencyPath(basePath: string, key: string): string {
  return `${basePath}.${key}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isValidModuleNpmPackageName(name: string): boolean {
  if (name.length === 0 || name.length > 214) {
    return false;
  }

  if (!PACKAGE_NAME_PATTERN.test(name)) {
    return false;
  }

  if (!name.startsWith('@')) {
    return !name.includes('/');
  }

  const parts = name.split('/');
  return parts.length === 2 && parts.every((part) => part.length > 0);
}

function validateDependencyName(
  diagnostics: ModuleDependencyDiagnostic[],
  name: string,
  path: string
): boolean {
  if (!name) {
    diagnostics.push(
      diagnostic(
        'MODULE_DEPENDENCY_NAME_REQUIRED',
        'Dependency name must not be empty.',
        path,
        'Use an npm package name such as "zod" or "@scope/package".'
      )
    );
    return false;
  }

  if (!isValidModuleNpmPackageName(name)) {
    diagnostics.push(
      diagnostic(
        'MODULE_DEPENDENCY_NAME_INVALID',
        `Dependency name "${name}" must be a valid npm package name.`,
        path,
        'Use the package name only. Put the version range in dependencies.npm as an object value.'
      )
    );
    return false;
  }

  return true;
}

function validateDependencyRange(
  diagnostics: ModuleDependencyDiagnostic[],
  name: string,
  range: unknown,
  path: string
): string | undefined {
  if (typeof range !== 'string') {
    diagnostics.push(
      diagnostic(
        'MODULE_DEPENDENCY_VERSION_INVALID',
        `Dependency "${name}" must declare its version range as a string.`,
        path,
        'Use a semver range such as "^1.2.3" or declare the dependency as an array item for a host-managed version.'
      )
    );
    return undefined;
  }

  const normalized = range.trim();
  if (!normalized) {
    diagnostics.push(
      diagnostic(
        'MODULE_DEPENDENCY_VERSION_REQUIRED',
        `Dependency "${name}" must declare a version range.`,
        path,
        'Use a semver range such as "^1.2.3", or move the package name into the array form for a host-managed version.'
      )
    );
    return undefined;
  }

  if (CONTROL_CHARACTER_PATTERN.test(normalized)) {
    diagnostics.push(
      diagnostic(
        'MODULE_DEPENDENCY_VERSION_INVALID',
        `Dependency "${name}" range contains unsupported control characters.`,
        path,
        'Use a single-line npm semver range.'
      )
    );
    return undefined;
  }

  if (NPM_ALIAS_PATTERN.test(normalized)) {
    diagnostics.push(
      diagnostic(
        'MODULE_DEPENDENCY_ALIAS_FORBIDDEN',
        `Dependency "${name}" uses an npm alias range, which is not supported by module contracts.`,
        path,
        'Declare the real npm package name directly and use a semver range.'
      )
    );
    return undefined;
  }

  if (
    FORBIDDEN_LOCAL_SOURCE_PATTERN.test(normalized) ||
    FORBIDDEN_REMOTE_SOURCE_PATTERN.test(normalized)
  ) {
    diagnostics.push(
      diagnostic(
        'MODULE_DEPENDENCY_SOURCE_FORBIDDEN',
        `Dependency "${name}" uses a local, workspace, git, or remote source.`,
        path,
        'Module npm dependencies must use registry package names with semver ranges. workspace:, file:, link:, git, and URL sources are not allowed.'
      )
    );
    return undefined;
  }

  return normalized;
}

export function normalizeModuleNpmDependencyInputs(
  inputs: readonly ModuleNpmDependencyInput[]
): ModuleNpmDependencyNormalization {
  const diagnostics: ModuleDependencyDiagnostic[] = [];
  const dependencies = new Map<string, ModuleNpmDependency>();

  for (const input of inputs) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const nameIsValid = validateDependencyName(diagnostics, name, input.path);
    const range = validateDependencyRange(
      diagnostics,
      name || '(unnamed)',
      input.range ?? WILDCARD_RANGE,
      input.rangePath ?? input.path
    );

    if (!nameIsValid || !range) {
      continue;
    }

    const existing = dependencies.get(name);
    if (existing) {
      if (existing.range !== range) {
        diagnostics.push(
          diagnostic(
            'MODULE_DEPENDENCY_VERSION_CONFLICT',
            `Dependency "${name}" is declared with conflicting ranges "${existing.range}" and "${range}".`,
            input.rangePath ?? input.path,
            'Keep one dependency range per module contract.'
          )
        );
      }
      continue;
    }

    dependencies.set(name, { name, range });
  }

  return {
    dependencies: [...dependencies.values()].sort((left, right) => left.name.localeCompare(right.name)),
    diagnostics,
  };
}

export function normalizeModuleNpmDependencies(
  npmDependencies: ModuleDependenciesDefinition['npm'] | unknown,
  basePath = 'dependencies.npm'
): ModuleNpmDependencyNormalization {
  if (npmDependencies === undefined) {
    return { dependencies: [], diagnostics: [] };
  }

  if (Array.isArray(npmDependencies)) {
    return normalizeModuleNpmDependencyInputs(
      npmDependencies.map((name, index) => ({
        name,
        range: WILDCARD_RANGE,
        path: dependencyPath(basePath, String(index)),
      }))
    );
  }

  if (!isPlainObject(npmDependencies)) {
    return {
      dependencies: [],
      diagnostics: [
        diagnostic(
          'MODULE_DEPENDENCY_NPM_INVALID',
          'dependencies.npm must be an object of package ranges or an array of package names.',
          basePath,
          'Use dependencies: { npm: { zod: "^3.0.0" } } or dependencies: { npm: ["zod"] }.'
        ),
      ],
    };
  }

  return normalizeModuleNpmDependencyInputs(
    Object.entries(npmDependencies).map(([name, range]) => ({
      name,
      range,
      path: dependencyPath(basePath, name),
      rangePath: dependencyPath(basePath, name),
    }))
  );
}
