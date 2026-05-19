import type { NextConfig } from 'next';
import fs from 'fs';
import path from 'path';
import createNextIntlPlugin from 'next-intl/plugin';
import {
  getActivePluginMapFiles,
  getSourcePluginMapFiles,
} from './src/lib/plugin-runtime/plugin-map-files';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
const pluginMapNodeProvider = path.resolve(
  __dirname,
  './src/lib/plugin-runtime/loader/plugin-map-provider.server.ts'
);
const pluginMapBundledProvider = path.resolve(
  __dirname,
  './src/lib/plugin-runtime/loader/plugin-map-bundled-provider.server.ts'
);
const pluginMapLoaderDir = path.dirname(pluginMapNodeProvider);

function ensureActivePluginMapForWebpack(): string | null {
  const active = getActivePluginMapFiles(__dirname);
  const source = getSourcePluginMapFiles(__dirname);
  if (!active.runtimeArtifact || active.mapFile === source.mapFile) {
    return null;
  }

  if (!fs.existsSync(active.mapFile)) {
    throw new Error(
      `Active plugin map file is missing: ${path.relative(
        __dirname,
        active.mapFile
      )}. Run npm run plugins:scan:runtime or update PLOYKIT_PLUGIN_MAP_FILE.`
    );
  }
  if (!fs.existsSync(active.manifestFile)) {
    throw new Error(
      `Active plugin map manifest file is missing: ${path.relative(
        __dirname,
        active.manifestFile
      )}. Run npm run plugins:scan:runtime or update PLOYKIT_PLUGIN_MAP_MANIFEST_FILE.`
    );
  }

  return active.mapFile;
}

const nextConfig: NextConfig = {
  typedRoutes: false,

  // Enable standalone output for Docker deployment
  output: 'standalone',

  experimental: {
    externalDir: true,
  },

  serverExternalPackages: ['@earendil-works/pi-ai'],

  // TypeScript build errors must not be ignored - hard gate for quality
  typescript: {
    ignoreBuildErrors: false,
  },

  // Note: instrumentationHook is enabled by default in Next.js 15+
  // No need for experimental flag

  // Keep webpack aliases in sync with tsconfig.json.
  webpack: (config, { isServer, webpack }) => {
    const activePluginMap = ensureActivePluginMapForWebpack();
    const resolveModules = new Set([
      path.resolve(__dirname, './node_modules'),
      ...(config.resolve.modules || []),
    ]);
    const existingAliases = { ...(config.resolve.alias ?? {}) };
    delete existingAliases['@'];

    config.resolve.alias = {
      ...existingAliases,

      // Public plugin SDK entrypoints used by generated/plugin author code.
      '@ploykit/plugin-sdk/react$': path.resolve(__dirname, './src/plugin-sdk/react.ts'),
      '@ploykit/plugin-sdk/testing$': path.resolve(__dirname, './src/plugin-sdk/testing.ts'),
      '@ploykit/plugin-sdk$': path.resolve(__dirname, './src/plugin-sdk/index.ts'),

      // Root directory configuration files
      '@/site.config': path.resolve(__dirname, './site.config.ts'),
      '@/theme.config': path.resolve(__dirname, './theme.config.ts'),
      '@/plugins': path.resolve(__dirname, './plugins'),

      // @/* -> ./src/* (Next.js default, but explicit is clearer)
      '@': path.resolve(__dirname, './src'),
    };

    // Add absolute path resolution for the default plugins directory on server side.
    if (isServer) {
      resolveModules.add(path.resolve(__dirname, './plugins'));
      config.plugins = [
        ...(config.plugins || []),
        new webpack.NormalModuleReplacementPlugin(
          /plugin-map-provider\.server$/,
          (resource: { context: string; request: string }) => {
            if (path.resolve(resource.context) === pluginMapLoaderDir) {
              resource.request = pluginMapBundledProvider;
            }
          }
        ),
        new webpack.NormalModuleReplacementPlugin(
          /plugin-map-runtime-placeholder$/,
          (resource: { context: string; request: string }) => {
            if (path.resolve(resource.context) === pluginMapLoaderDir) {
              resource.request =
                activePluginMap ?? path.resolve(__dirname, './src/lib/plugin-map.ts');
            }
          }
        ),
      ];
    }
    config.resolve.modules = [...resolveModules];

    // Suppress expected warnings for plugin system dynamic imports
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      {
        module: /unified-system\.ts/,
        message: /Critical dependency: the request of a dependency is an expression/,
      },
      {
        module: /hook-loader\.server\.ts/,
        message: /Can't resolve '@\/plugins'/,
      },
      {
        module: /module-resolver\.server\.ts/,
        message: /Critical dependency: the request of a dependency is an expression/,
      },
    ];

    return config;
  },
};

export default withNextIntl(nextConfig);
