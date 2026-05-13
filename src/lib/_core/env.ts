/**
 * Environment Variables Validation
 *
 * Enhanced validation with cross-field checks and better error messages
 *
 * Usage:
 * ```typescript
 * import { env } from '@/lib/_core/env';
 * const provider = env.DB_PROVIDER;  // Type-safe access
 * ```
 */

// Load .env file before any validation (critical for tsx scripts and server-side code)
import 'dotenv/config';

import { z } from 'zod';

//
// Custom validators
//

/**
 * Validate PostgreSQL connection URL format
 */
const postgresUrlSchema = z
  .string()
  .min(1, 'PostgreSQL URL cannot be empty')
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
      } catch {
        return false;
      }
    },
    {
      message:
        'Invalid PostgreSQL connection URL format. Expected: postgres://user:password@host:port/database',
    }
  );

//
// Validation helpers
//

type _EnvData = z.infer<typeof envSchema>;
type ValidationContext = z.RefinementCtx;

/**
 * Helper to add URL validation error
 */
function addUrlValidationError(
  ctx: ValidationContext,
  path: string,
  url: string | undefined
): void {
  if (!url) return;

  const urlValidation = postgresUrlSchema.safeParse(url);
  if (!urlValidation.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [path],
      message: urlValidation.error.issues[0]?.message || `Invalid ${path} format`,
    });
  }
}

/**
 * Validate PostgreSQL provider configuration
 */
function validatePostgresConfig(data: Record<string, unknown>, ctx: ValidationContext): void {
  const hasConnectionUrl = !!data.DATABASE_URL;
  const hasConnectionParams =
    !!data.POSTGRES_HOST && !!data.POSTGRES_DB && !!data.POSTGRES_USER && !!data.POSTGRES_PASSWORD;

  if (!hasConnectionUrl && !hasConnectionParams) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATABASE_URL'],
      message:
        'For postgres provider, either DATABASE_URL or all of (POSTGRES_HOST, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD) must be provided',
    });
    return;
  }

  if (hasConnectionUrl) {
    addUrlValidationError(ctx, 'DATABASE_URL', data.DATABASE_URL as string | undefined);
  }
}

/**
 * Validate Neon provider configuration
 */
function validateNeonConfig(data: Record<string, unknown>, ctx: ValidationContext): void {
  if (!data.NEON_DATABASE_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['NEON_DATABASE_URL'],
      message: 'NEON_DATABASE_URL is required when using neon provider',
    });
    return;
  }

  addUrlValidationError(ctx, 'NEON_DATABASE_URL', data.NEON_DATABASE_URL as string | undefined);
}

/**
 * Validate Supabase provider configuration
 */
function validateSupabaseConfig(data: Record<string, unknown>, ctx: ValidationContext): void {
  if (!data.DATABASE_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATABASE_URL'],
      message: 'DATABASE_URL is required when using supabase provider',
    });
    return;
  }

  addUrlValidationError(ctx, 'DATABASE_URL', data.DATABASE_URL as string | undefined);
}

//
// Environment variables schema
//

const envSchema = z
  .object({
    //
    // Node environment
    //
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    NEXT_PHASE: z.string().optional(),

    //
    // Database configuration
    //
    DB_PROVIDER: z.enum(['postgres', 'neon', 'supabase']).default('supabase'),

    // Database connection strings
    DATABASE_URL: z.string().optional(),
    NEON_DATABASE_URL: z.string().optional(),

    // PostgreSQL connection parameters (for postgres provider)
    POSTGRES_HOST: z.string().optional(),
    POSTGRES_PORT: z.coerce.number().int().positive().optional(),
    POSTGRES_DB: z.string().optional(),
    POSTGRES_USER: z.string().optional(),
    POSTGRES_PASSWORD: z.string().optional(),

    // Database connection pool configuration
    DB_POOL_SIZE: z.coerce.number().int().positive().default(10),
    DB_IDLE_TIMEOUT: z.coerce.number().int().positive().default(30),
    DB_CONNECTION_TIMEOUT: z.coerce.number().int().positive().default(30),
    DB_QUERY_TIMEOUT: z.coerce.number().int().positive().default(30000),

    //
    // Application configuration
    //
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
    SUPPORTED_LANGUAGES: z.string().default('en,zh'),

    //
    // Stripe configuration
    // Note: Made optional for build time. Runtime validation handled in @/lib/stripe/env-guard.ts
    //
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    //
    // Better Auth configuration
    //
    BETTER_AUTH_SECRET: z.string().optional(),
    AUTH_SECRET: z.string().optional(),
    BETTER_AUTH_URL: z.string().url().optional(),
    NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
    AUTH_PASSWORD_RESET_DELIVERY: z.enum(['log', 'disabled']).optional(),
    PLUGIN_SECRET_ENCRYPTION_KEY: z.string().optional(),
    PLUGIN_CONNECTOR_CALLBACK_SECRET: z.string().optional(),
    PLUGIN_FILE_SIGNING_SECRET: z.string().optional(),
    PLUGIN_TURNSTILE_SECRET_KEY: z.string().optional(),
    CLOUDFLARE_TURNSTILE_SECRET_KEY: z.string().optional(),
    PLUGIN_ANONYMOUS_CAPTCHA_BYPASS_TOKEN: z.string().optional(),

    //
    // Feature gates
    //
    BILLING_ENABLED: z.enum(['true', 'false']).default('false'),
    BILLING_DEMO_API_ENABLED: z.enum(['true', 'false']).default('false'),
    FILE_STORAGE_ENABLED: z.enum(['true', 'false']).default('false'),
    FILE_STORAGE_DRIVER: z.enum(['local', 's3', 'r2']).optional(),
    FILE_STORAGE_LOCAL_ROOT: z.string().optional(),
    FILE_STORAGE_ENDPOINT: z.string().url().optional(),
    FILE_STORAGE_BUCKET: z.string().optional(),
    FILE_STORAGE_ACCESS_KEY_ID: z.string().optional(),
    FILE_STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
    FILE_STORAGE_REGION: z.string().optional(),
    FILE_STORAGE_FORCE_PATH_STYLE: z.enum(['true', 'false']).optional(),
    FILE_STORAGE_PUBLIC_BASE_URL: z.string().url().optional(),

    // OAuth providers (optional)
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // Skip all runtime-only validation during Next.js production build.
    const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';
    if (isBuildPhase) {
      return;
    }

    // Check if user explicitly configured database (not just using defaults)
    const hasExplicitDbConfig =
      !!process.env.DB_PROVIDER ||
      !!process.env.DATABASE_URL ||
      !!process.env.NEON_DATABASE_URL ||
      !!process.env.POSTGRES_HOST;

    // Skip only database validation if no DB was explicitly configured.
    // Other production and feature-gate checks must still run.
    if (hasExplicitDbConfig) {
      const validators: Record<string, () => void> = {
        postgres: () => validatePostgresConfig(data, ctx),
        neon: () => validateNeonConfig(data, ctx),
        supabase: () => validateSupabaseConfig(data, ctx),
      };

      const validator = validators[data.DB_PROVIDER];
      if (validator) {
        validator();
      }
    }

    // Production hard checks
    if (data.NODE_ENV === 'production') {
      const authSecret = data.BETTER_AUTH_SECRET || data.AUTH_SECRET;
      if (!authSecret) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['BETTER_AUTH_SECRET'],
          message: 'BETTER_AUTH_SECRET or AUTH_SECRET is required in production',
        });
      } else if (authSecret.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['BETTER_AUTH_SECRET'],
          message: 'Auth secret must be at least 32 characters long in production',
        });
      }

      if (!data.BETTER_AUTH_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['BETTER_AUTH_URL'],
          message: 'BETTER_AUTH_URL is required in production',
        });
      }

      if (!data.PLUGIN_SECRET_ENCRYPTION_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PLUGIN_SECRET_ENCRYPTION_KEY'],
          message: 'PLUGIN_SECRET_ENCRYPTION_KEY is required in production',
        });
      } else if (data.PLUGIN_SECRET_ENCRYPTION_KEY.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PLUGIN_SECRET_ENCRYPTION_KEY'],
          message: 'Plugin secret encryption key must be at least 32 characters long',
        });
      }

      if (!data.PLUGIN_FILE_SIGNING_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PLUGIN_FILE_SIGNING_SECRET'],
          message: 'PLUGIN_FILE_SIGNING_SECRET is required in production',
        });
      } else if (data.PLUGIN_FILE_SIGNING_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PLUGIN_FILE_SIGNING_SECRET'],
          message: 'Plugin file signing secret must be at least 32 characters long',
        });
      }
    }

    // Billing feature gate
    if (data.BILLING_ENABLED === 'true') {
      if (!data.STRIPE_SECRET_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['STRIPE_SECRET_KEY'],
          message: 'STRIPE_SECRET_KEY is required when BILLING_ENABLED=true',
        });
      }
      if (!data.STRIPE_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['STRIPE_WEBHOOK_SECRET'],
          message: 'STRIPE_WEBHOOK_SECRET is required when BILLING_ENABLED=true',
        });
      }
    }

    // File storage feature gate
    if (data.FILE_STORAGE_ENABLED === 'true') {
      if (!data.FILE_STORAGE_DRIVER) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['FILE_STORAGE_DRIVER'],
          message: 'FILE_STORAGE_DRIVER is required when FILE_STORAGE_ENABLED=true',
        });
      }
      if (data.FILE_STORAGE_DRIVER === 'local' && !data.FILE_STORAGE_LOCAL_ROOT) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['FILE_STORAGE_LOCAL_ROOT'],
          message: 'FILE_STORAGE_LOCAL_ROOT is required when FILE_STORAGE_DRIVER=local',
        });
      }
      if (data.FILE_STORAGE_DRIVER === 's3' || data.FILE_STORAGE_DRIVER === 'r2') {
        const required = [
          ['FILE_STORAGE_ENDPOINT', data.FILE_STORAGE_ENDPOINT],
          ['FILE_STORAGE_BUCKET', data.FILE_STORAGE_BUCKET],
          ['FILE_STORAGE_ACCESS_KEY_ID', data.FILE_STORAGE_ACCESS_KEY_ID],
          ['FILE_STORAGE_SECRET_ACCESS_KEY', data.FILE_STORAGE_SECRET_ACCESS_KEY],
        ] as const;

        for (const [key, value] of required) {
          if (!value) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [key],
              message: `${key} is required when FILE_STORAGE_DRIVER=${data.FILE_STORAGE_DRIVER}`,
            });
          }
        }
      }
    }
  });

//
// Type exports
//

export type Env = z.infer<typeof envSchema>;

//
// Validate environment variables
//

/**
 * Validate environment variables with enhanced error reporting
 */
function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('\nEnvironment validation failed!\n');
    console.error('The following environment variables have issues:\n');

    // Format errors in a user-friendly way
    const errors = result.error.flatten();

    // Field errors
    if (errors.fieldErrors && Object.keys(errors.fieldErrors).length > 0) {
      Object.entries(errors.fieldErrors).forEach(([field, messages]) => {
        console.error(`  ${field}:`);
        messages?.forEach((msg) => {
          console.error(`    - ${msg}`);
        });
      });
    }

    // Form errors (from superRefine)
    if (errors.formErrors && errors.formErrors.length > 0) {
      console.error('\n  General validation errors:');
      errors.formErrors.forEach((msg) => {
        console.error(`    - ${msg}`);
      });
    }

    console.error('\nPlease check your .env file and fix the issues above.\n');

    console.error('Current DB_PROVIDER:', process.env.DB_PROVIDER || 'not set');

    console.error('Current NODE_ENV:', process.env.NODE_ENV || 'not set');
    console.error('');

    throw new Error('Environment validation failed. See errors above.');
  }

  // Log successful validation in development (only once per process)
  if (result.data.NODE_ENV === 'development' && !globalThis.__envValidated) {
    globalThis.__envValidated = true;
    // Using console directly for startup info - this is intentional
    // eslint-disable-next-line no-console
    console.log('Environment variables validated successfully');
    // eslint-disable-next-line no-console
    console.log(`   - Provider: ${result.data.DB_PROVIDER}`);
    // eslint-disable-next-line no-console
    console.log(`   - Node ENV: ${result.data.NODE_ENV}`);
    // eslint-disable-next-line no-console
    console.log(`   - Log Level: ${result.data.LOG_LEVEL || 'not set (will use default)'}`);
  }

  return result.data;
}

// Global type declaration for HMR persistence
declare global {
  var __envValidated: boolean;
}

// Export validated environment variables
export const env = validateEnv();
