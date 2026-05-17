/**
 * ESLint Configuration (Flat Config Format for Next.js 16+)
 *
 * 本配置基于 Next.js 16+ 和 TypeScript 最佳实践，提供：
 * - 🔒 类型安全：严格的 TypeScript 规则
 * - 🏗️  架构守护：强制使用 L0 层基础设施（如统一的环境变量管理）
 * - 🚀 性能优化：基于 Next.js 服务器组件的规则调整
 * - 🧪 测试友好：测试文件中放宽类型检查
 * - 🔐 安全防护：禁止 eval、Function 构造函数等危险操作
 *
 * @see https://eslint.org/docs/latest/use/configure/configuration-files-new
 * @see https://nextjs.org/docs/app/api-reference/config/eslint
 */

import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const eslintConfig = [
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },

  // ════════════════════════════════════════════════════════════════
  // Global ignores
  // ════════════════════════════════════════════════════════════════
  {
    ignores: [
      // Dependencies
      'node_modules/**',
      '.pnp/**',
      '.yarn/**',

      // Build outputs
      '.next/**',
      'out/**',
      'build/**',
      'dist/**',
      '.ploykit-build/**',

      // Testing
      'coverage/**',
      'test-results/**',

      // TypeScript
      '*.tsbuildinfo',
      'next-env.d.ts',

      // Deployment
      '.vercel/**',

      // Cache & Temporary
      '.turbo/**',
      '.cache/**',

      // Generated files
      'drizzle/migrations/**',
      'plugins/**/assets/**',

      // Public binary/media assets
      'public/brand/**',
      'public/media/**',

      // Utility scripts
      'scripts/**',

      // Test config files
      '**/jest.config.js',
      '**/jest.setup.js',

      // Dev tools
      'dev-tools/**',

      // Config files
      '*.config.{ts,js,mjs,cjs}',
      'drizzle.config.ts',
      'tailwind.config.ts',
      'next.config.ts',
      'vitest.config.ts',
      'postcss.config.mjs',

      // Logs
      '*.log',
      'npm-debug.log*',
      'yarn-debug.log*',
      'yarn-error.log*',
      '.pnpm-debug.log*',
    ],
  },

  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2024,
        React: 'readonly',
        JSX: 'readonly',
      },
    },
  },

  js.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  nextPlugin.configs['core-web-vitals'],
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  eslintConfigPrettier,

  // ════════════════════════════════════════════════════════════════
  // JavaScript 文件规则 - 不使用 TypeScript parser
  // ════════════════════════════════════════════════════════════════
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      parserOptions: {
        project: false,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },

  // ════════════════════════════════════════════════════════════════
  // 全局规则 - 代码质量和类型安全（严格模式）
  // ════════════════════════════════════════════════════════════════
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // TypeScript 类型安全规则
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: {
            attributes: false,
          },
        },
      ],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',

      // 基础代码质量规则
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-control-regex': 'off',
      'no-constant-binary-expression': 'off',
      'no-irregular-whitespace': 'off',
      'no-useless-assignment': 'off',
      'no-useless-catch': 'off',
      'preserve-caught-error': 'off',
      'require-yield': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // 架构守护规则 - 确保遵循 L0 层基础设施
  // ════════════════════════════════════════════════════════════════
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    ignores: [
      'src/lib/_core/env.ts',
      'src/lib/_core/logger.ts',
      '**/*.config.{ts,js,mjs}',
      'src/instrumentation.ts',
      'src/proxy.ts',
      '**/__tests__/**',
      '**/test-utils/**',
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      'src/app/global-error.tsx',
      'src/app/**/error.tsx',
      'src/components/errors/**',
      'src/lib/auth/client.ts',
      '**/*client*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            '🚫 不要直接访问 process.env，请使用 @/lib/_core/env 模块。\n' +
            '✅ 正确做法：import { env } from "@/lib/_core/env"; const dbUrl = env.DATABASE_URL;\n' +
            '这确保了环境变量的类型安全和启动时验证。',
        },
      ],
    },
  },

  // ════════════════════════════════════════════════════════════════
  // Next.js 服务器组件规则
  // ════════════════════════════════════════════════════════════════
  {
    files: [
      'src/app/**/page.tsx',
      'src/app/**/layout.tsx',
      'src/app/**/loading.tsx',
      'src/app/**/not-found.tsx',
      'src/app/**/template.tsx',
      'src/app/**/default.tsx',
    ],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
    },
  },

  // ════════════════════════════════════════════════════════════════
  // 测试文件规则 - 放宽类型检查
  // ════════════════════════════════════════════════════════════════
  {
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
];

export default eslintConfig;
