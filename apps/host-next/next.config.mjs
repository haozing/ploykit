import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { collectModuleNpmDependencies } from '../../scripts/lib/module-dependencies.mjs';

const isDevelopment = process.env.NODE_ENV !== 'production';
const projectRoot = path.resolve(process.cwd());
const configPath = path.resolve(projectRoot, process.env.PLOYKIT_CONFIG ?? 'ploykit.config.json');
const nextConfigDir = path.dirname(fileURLToPath(import.meta.url));
const scriptSrc = ["'self'", "'unsafe-inline'", ...(isDevelopment ? ["'unsafe-eval'"] : [])].join(
  ' '
);

function commonAncestor(paths) {
  if (paths.length === 0) {
    return projectRoot;
  }
  const [first, ...rest] = paths.map((value) => path.resolve(value).split(path.sep));
  let end = first.length;
  for (const parts of rest) {
    end = Math.min(end, parts.length);
    for (let index = 0; index < end; index += 1) {
      if (parts[index].toLowerCase() !== first[index].toLowerCase()) {
        end = index;
        break;
      }
    }
  }
  return first.slice(0, end).join(path.sep) || path.parse(projectRoot).root;
}

function readPloyKitConfig() {
  if (!fs.existsSync(configPath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return undefined;
  }
}

function readTrustedModuleRoots(config) {
  return Array.isArray(config?.trustedModuleRoots)
    ? config.trustedModuleRoots
        .filter((value) => typeof value === 'string' && value.trim())
        .map((value) => path.resolve(path.dirname(configPath), value))
    : [];
}

function readModuleNpmDependencyNames() {
  return collectModuleNpmDependencies(path.dirname(configPath)).map((dependency) => dependency.name);
}

function relativeImportPath(fromDir, toPath) {
  const relative = path.relative(fromDir, toPath).replace(/\\/g, '/');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function createModuleDependencyAliases(config, formatPackageRoot) {
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
    'react',
    'react-dom',
  ];
  for (const dependencyName of dependencyNames) {
    const packageRoot = path.join(projectRoot, 'node_modules', dependencyName);
    if (fs.existsSync(packageRoot)) {
      aliases[dependencyName] = formatPackageRoot(packageRoot);
    }
  }
  return aliases;
}

const ployKitConfig = readPloyKitConfig();
const turbopackRoot = commonAncestor([projectRoot, nextConfigDir, ...readTrustedModuleRoots(ployKitConfig)]);
const turbopackModuleDependencyAliases = createModuleDependencyAliases(ployKitConfig, (packageRoot) =>
  relativeImportPath(nextConfigDir, packageRoot)
);
const webpackModuleDependencyAliases = createModuleDependencyAliases(ployKitConfig, (packageRoot) => packageRoot);
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
  experimental: {
    externalDir: true,
  },
  turbopack: {
    root: turbopackRoot,
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
