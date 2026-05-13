/**
 * Vitest Configuration File
 *
 * This is the core configuration for the testing framework, defining:
 * - Test environment (Node.js)
 * - File matching patterns
 * - TypeScript path mapping
 * - Coverage report settings
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // Resolve configuration - for TypeScript path mapping
  resolve: {
    alias: {
      // Public plugin SDK entrypoints used by generated/plugin author code.
      '@ploykit/plugin-sdk/react': path.resolve(__dirname, './src/plugin-sdk/react.ts'),
      '@ploykit/plugin-sdk/testing': path.resolve(__dirname, './src/plugin-sdk/testing.ts'),
      '@ploykit/plugin-sdk': path.resolve(__dirname, './src/plugin-sdk/index.ts'),
      // Map @/plugins to plugins/ directory (must be before @, to avoid being overridden)
      '@/plugins': path.resolve(__dirname, './plugins'),
      '@/site.config': path.resolve(__dirname, './site.config.ts'),
      '@/theme.config': path.resolve(__dirname, './theme.config.ts'),
      // Map @/ to src/ directory
      // This allows using @/lib/hooks instead of ../../../lib/hooks in tests
      '@': path.resolve(__dirname, './src'),
    },
  },

  // Vitest test configuration
  test: {
    // Test environment: happy-dom (supports React components and server-side code testing)
    environment: 'happy-dom',

    // Global variables: use describe, it, expect without importing each time
    globals: true,

    // Server-only mock: prevent server-only import errors during testing
    server: {
      deps: {
        inline: ['server-only'],
      },
    },

    // Setup files: run before all tests
    setupFiles: ['./src/lib/test-utils/setup.ts'],

    // Test file matching patterns
    include: [
      // Match all .test.ts and .test.tsx files
      'src/**/*.{test,spec}.{ts,tsx}',
    ],

    // Excluded files/directories
    exclude: ['node_modules', 'dist', '.next', 'coverage'],

    // Coverage configuration
    coverage: {
      // Coverage reporting tool (v8 recommended, faster)
      provider: 'v8',

      // Output report formats
      reporter: ['text', 'json', 'html', 'lcov'],

      // Files to include in coverage
      include: [
        'src/lib/_core/**/*.ts',
        'src/lib/auth/**/*.ts',
        'src/lib/db/**/*.ts',
        'src/lib/plugin-runtime/**/*.ts',
        'src/lib/runtime/**/*.ts',
        'src/lib/security/**/*.ts',
        'src/plugin-sdk/**/*.ts',
        'src/app/api/**/*.{ts,tsx}',
        'src/lib/hooks/**/*.ts',
        'src/lib/bus/**/*.ts',
        'src/lib/plugins/**/*.ts',
        'src/lib/services/**/*.ts',
        'src/lib/middleware/**/*.ts',
        'src/lib/entitlements/**/*.ts', // ✅ Added: Entitlements management
        'src/lib/stripe/**/*.ts', // ✅ Added: Stripe payment
        'src/hooks/**/*.ts',
        'src/components/**/*.{ts,tsx}',
        'src/app/**/page.tsx',
      ],

      // Excluded files
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**', '**/types.ts', '**/index.ts'],

      // Coverage thresholds (tests fail below these values)
      thresholds: {
        lines: 80, // Line coverage > 80%
        functions: 80, // Function coverage > 80%
        branches: 75, // Branch coverage > 75%
        statements: 80, // Statement coverage > 80%
      },
    },

    // Test timeout (milliseconds)
    testTimeout: 10000,

    // Hook timeout
    hookTimeout: 10000,

    // Isolate test files (each test file runs independently)
    isolate: true,

    // Options in watch mode
    watch: false,

    // Configure log output
    silent: false,

    // Test report format
    reporters: ['verbose'],
  },
});
