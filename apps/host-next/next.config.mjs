import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { collectModuleNpmDependencies } from '../../scripts/lib/module-dependencies.mjs';

const isDevelopment = process.env.NODE_ENV !== 'production';
const projectRoot = path.resolve(process.cwd());
const nextConfigDir = path.dirname(fileURLToPath(import.meta.url));
const devDistDir = process.env.NEXT_PRIVATE_DEV_DIST_DIR
  ? path.relative(nextConfigDir, path.resolve(process.env.NEXT_PRIVATE_DEV_DIST_DIR)).replace(/\\/g, '/')
  : undefined;
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

function packageRuntimeEntry(packageRoot) {
  const packageJson = readPackageJson(path.join(packageRoot, 'package.json'));
  const exportsDot = packageJson?.exports?.['.'] ?? packageJson?.exports;
  const candidates = [
    exportTarget(exportsDot?.import?.default),
    exportTarget(exportsDot?.import),
    exportTarget(exportsDot?.default),
    exportTarget(packageJson?.module),
    exportTarget(exportsDot?.require?.default),
    exportTarget(exportsDot?.require),
    exportTarget(packageJson?.main),
    'index.js',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.endsWith('.d.ts') || candidate.endsWith('.d.mts') || candidate.endsWith('.d.cts')) {
      continue;
    }
    const runtimePath = path.join(packageRoot, candidate);
    if (fs.existsSync(runtimePath)) {
      return runtimePath;
    }
  }

  return packageRoot;
}

function readPackageJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function exportTarget(value) {
  return typeof value === 'string' ? value.replace(/^\.\//, '') : undefined;
}

function createWebpackDependencyAliases() {
  const aliases = {};
  for (const [dependencyName, packageRoot] of Object.entries({
    ...createHostSharedDependencyAliases((root) => root),
    ...createModuleDependencyAliases((root) => root),
  })) {
    aliases[`${dependencyName}$`] = packageRuntimeEntry(packageRoot);
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
const turbopackHostSharedDependencyAliases = createHostSharedDependencyAliases((packageRoot) =>
  relativeImportPath(nextConfigDir, packageRoot)
);
const webpackDependencyAliases = createWebpackDependencyAliases();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  ...(devDistDir ? { distDir: devDistDir } : {}),
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
      ...webpackDependencyAliases,
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
        source: '/brand/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
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
