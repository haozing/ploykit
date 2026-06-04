import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { collectModuleNpmDependencies } from '../../scripts/lib/module-dependencies.mjs';

const isDevelopment = process.env.NODE_ENV !== 'production';
const projectRoot = path.resolve(process.cwd());
const nextConfigDir = path.dirname(fileURLToPath(import.meta.url));
const scriptSrc = ["'self'", "'unsafe-inline'", ...(isDevelopment ? ["'unsafe-eval'"] : [])].join(
  ' '
);

function readModuleNpmDependencyNames() {
  return collectModuleNpmDependencies(projectRoot).map((dependency) => dependency.name);
}

function relativeImportPath(fromDir, toPath) {
  const relative = path.relative(fromDir, toPath).replace(/\\/g, '/');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function createModuleDependencyAliases(formatPackageRoot) {
  const aliases = {};
  for (const dependencyName of readModuleNpmDependencyNames()) {
    const packageRoot = path.join(projectRoot, 'node_modules', dependencyName);
    if (fs.existsSync(packageRoot)) {
      aliases[dependencyName] = formatPackageRoot(packageRoot);
    }
  }
  return aliases;
}

function createHostSharedDependencyAliases(formatPackageRoot) {
  const aliases = {};
  const dependencyNames = [
    '@radix-ui/react-avatar',
    '@radix-ui/react-dialog',
    '@radix-ui/react-dropdown-menu',
    '@radix-ui/react-select',
    '@radix-ui/react-tabs',
    'lucide-react',
  ];
  for (const dependencyName of dependencyNames) {
    const packageRoot = path.join(projectRoot, 'node_modules', dependencyName);
    if (fs.existsSync(packageRoot)) {
      aliases[dependencyName] = formatPackageRoot(packageRoot);
    }
  }
  return aliases;
}

const turbopackModuleDependencyAliases = createModuleDependencyAliases((packageRoot) =>
  relativeImportPath(nextConfigDir, packageRoot)
);
const webpackModuleDependencyAliases = createModuleDependencyAliases((packageRoot) => packageRoot);
const turbopackHostSharedDependencyAliases = createHostSharedDependencyAliases((packageRoot) =>
  relativeImportPath(nextConfigDir, packageRoot)
);
const webpackHostSharedDependencyAliases = createHostSharedDependencyAliases((packageRoot) => packageRoot);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  output: 'standalone',
  outputFileTracingRoot: projectRoot,
  turbopack: {
    root: projectRoot,
    resolveAlias: {
      ...turbopackHostSharedDependencyAliases,
      ...turbopackModuleDependencyAliases,
    },
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
  },
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      ...webpackHostSharedDependencyAliases,
      ...webpackModuleDependencyAliases,
    };
    config.resolve.modules = [
      ...(config.resolve.modules ?? []),
      path.join(projectRoot, 'node_modules'),
    ];
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value:
              `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'self'`,
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
