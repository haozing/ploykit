const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const SDK_PACKAGE = '@ploykit/module-sdk';
const PATCH_KEY = Symbol.for('ploykit.moduleSdkAlias');
const BUILTIN_MODULES = new Set(Module.builtinModules.map((specifier) => specifier.replace(/^node:/, '').split('/')[0]));

function resolveCandidate(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
    path.join(basePath, 'index.js'),
    path.join(basePath, 'index.jsx'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function resolveSdkRequest(projectRoot, request) {
  if (request === SDK_PACKAGE) {
    return path.join(projectRoot, 'scripts', 'lib', 'module-sdk-entry.ts');
  }
  if (!request.startsWith(`${SDK_PACKAGE}/`)) {
    return undefined;
  }

  const subpath = request.slice(SDK_PACKAGE.length + 1);
  return resolveCandidate(path.join(projectRoot, 'src', 'module-sdk', subpath));
}

function packageNameFromRequest(request) {
  if (
    !request ||
    request.startsWith('.') ||
    request.startsWith('/') ||
    /^[a-zA-Z]:[\\/]/.test(request) ||
    request.startsWith('node:') ||
    BUILTIN_MODULES.has(request.split('/')[0])
  ) {
    return undefined;
  }
  if (request.startsWith('@')) {
    const [scope, name] = request.split('/');
    return scope && name ? `${scope}/${name}` : undefined;
  }
  return request.split('/')[0];
}

function resolveHostRuntimePackage(projectRoot, request) {
  const packageName = packageNameFromRequest(request);
  if (!packageName || packageName === SDK_PACKAGE) {
    return undefined;
  }

  const packageRoot = path.join(projectRoot, 'node_modules', packageName);
  if (!fs.existsSync(packageRoot)) {
    return undefined;
  }

  return request === packageName
    ? packageRoot
    : path.join(packageRoot, request.slice(packageName.length + 1));
}

function registerModuleSdkAlias(projectRoot = process.env.PLOYKIT_PROJECT_ROOT || process.cwd()) {
  const root = path.resolve(projectRoot);
  const existing = globalThis[PATCH_KEY];
  if (existing?.root === root) {
    return;
  }

  const previousResolve = existing?.previousResolve ?? Module._resolveFilename;
  Module._resolveFilename = function resolvePloyKitModuleSdk(request, parent, isMain, options) {
    const mapped = resolveSdkRequest(root, request);
    if (mapped) {
      return previousResolve.call(this, mapped, parent, isMain, options);
    }
    try {
      return previousResolve.call(this, request, parent, isMain, options);
    } catch (error) {
      if (error && error.code !== 'MODULE_NOT_FOUND') {
        throw error;
      }
      const hostRuntimePackage = resolveHostRuntimePackage(root, request);
      if (!hostRuntimePackage) {
        throw error;
      }
      return previousResolve.call(this, hostRuntimePackage, parent, isMain, options);
    }
  };

  globalThis[PATCH_KEY] = { root, previousResolve };
}

registerModuleSdkAlias();

module.exports = {
  registerModuleSdkAlias,
};
