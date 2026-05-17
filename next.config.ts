import type { NextConfig } from 'next';
import path from 'path';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  typedRoutes: false,

  // Enable standalone output for Docker deployment
  output: 'standalone',

  serverExternalPackages: ['@earendil-works/pi-ai'],

  // TypeScript build errors must not be ignored - hard gate for quality
  typescript: {
    ignoreBuildErrors: false,
  },

  // Note: instrumentationHook is enabled by default in Next.js 15+
  // No need for experimental flag

  // Keep webpack aliases in sync with tsconfig.json.
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,

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

    // Add absolute path resolution for plugins directory on server side
    if (isServer) {
      config.resolve.modules = [
        ...(config.resolve.modules || []),
        path.resolve(__dirname, './plugins'),
      ];
    }

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
    ];

    return config;
  },
};

export default withNextIntl(nextConfig);
