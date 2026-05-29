const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const SDK_PACKAGE = '@ploykit/module-sdk';
const PATCH_KEY = Symbol.for('ploykit.moduleSdkAlias');

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
    return previousResolve.call(this, request, parent, isMain, options);
  };

  globalThis[PATCH_KEY] = { root, previousResolve };
}

registerModuleSdkAlias();

module.exports = {
  registerModuleSdkAlias,
};
