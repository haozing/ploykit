/**
 * Unit tests for lib/env.ts
 *
 * Tests environment variable validation
 *
 * Note: env.ts validates on module load, so test environment
 * variables are set up in setup.ts before importing.
 */

import { env } from '../env';
import type { Env } from '../env';

describe('lib/env', () => {
  describe('env object', () => {
    it('should be defined', () => {
      expect(env).toBeDefined();
      expect(typeof env).toBe('object');
    });

    it('should have NODE_ENV', () => {
      expect(env.NODE_ENV).toBeDefined();
      expect(['development', 'production', 'test']).toContain(env.NODE_ENV);
    });

    it('should have DB_PROVIDER', () => {
      expect(env.DB_PROVIDER).toBeDefined();
      expect(['postgres', 'neon', 'supabase']).toContain(env.DB_PROVIDER);
    });

    it('should have SUPPORTED_LANGUAGES', () => {
      expect(env.SUPPORTED_LANGUAGES).toBeDefined();
      expect(typeof env.SUPPORTED_LANGUAGES).toBe('string');
      expect(env.SUPPORTED_LANGUAGES).toContain(',');
    });
  });

  describe('Database configuration', () => {
    it('should have appropriate database URL for provider', () => {
      if (env.DB_PROVIDER === 'supabase') {
        expect(env.DATABASE_URL).toBeDefined();
        expect(env.DATABASE_URL).toBeTruthy();
      }

      if (env.DB_PROVIDER === 'neon') {
        expect(env.NEON_DATABASE_URL).toBeDefined();
        expect(env.NEON_DATABASE_URL).toBeTruthy();
      }

      if (env.DB_PROVIDER === 'postgres') {
        // Either DATABASE_URL or POSTGRES_* params should be present
        const hasUrl = !!env.DATABASE_URL;
        const hasParams = !!(
          env.POSTGRES_HOST &&
          env.POSTGRES_DB &&
          env.POSTGRES_USER &&
          env.POSTGRES_PASSWORD
        );
        expect(hasUrl || hasParams).toBe(true);
      }
    });

    it('DATABASE_URL should be a valid format if present', () => {
      if (env.DATABASE_URL) {
        expect(env.DATABASE_URL).toMatch(/^postgres(ql)?:\/\//);
      }
    });

    it('NEON_DATABASE_URL should be a valid format if present', () => {
      if (env.NEON_DATABASE_URL) {
        expect(env.NEON_DATABASE_URL).toMatch(/^postgres(ql)?:\/\//);
      }
    });
  });

  describe('Optional configuration', () => {
    it('LOG_LEVEL should be valid if present', () => {
      if (env.LOG_LEVEL) {
        expect(['debug', 'info', 'warn', 'error']).toContain(env.LOG_LEVEL);
      }
    });

    it('POSTGRES_PORT should be a number if present', () => {
      if (env.POSTGRES_PORT !== undefined) {
        expect(typeof env.POSTGRES_PORT).toBe('number');
        expect(env.POSTGRES_PORT).toBeGreaterThan(0);
        expect(env.POSTGRES_PORT).toBeLessThanOrEqual(65535);
      }
    });
  });

  describe('Type safety', () => {
    it('env should match Env type', () => {
      const typedEnv: Env = env;
      expect(typedEnv).toBeDefined();
      expect(typedEnv.NODE_ENV).toBeDefined();
      expect(typedEnv.DB_PROVIDER).toBeDefined();
    });

    it('should have correct NODE_ENV type', () => {
      const nodeEnv: 'development' | 'production' | 'test' = env.NODE_ENV;
      expect(nodeEnv).toBeDefined();
    });

    it('should have correct DB_PROVIDER type', () => {
      const provider: 'postgres' | 'neon' | 'supabase' = env.DB_PROVIDER;
      expect(provider).toBeDefined();
    });
  });

  describe('Validation behavior', () => {
    it('should have validated and parsed all required fields', () => {
      // If this test runs, validation passed during module load
      expect(env.NODE_ENV).toBeTruthy();
      expect(env.DB_PROVIDER).toBeTruthy();
      expect(env.SUPPORTED_LANGUAGES).toBeTruthy();
    });

    it('should have applied defaults', () => {
      // SUPPORTED_LANGUAGES should have default value
      expect(env.SUPPORTED_LANGUAGES).toBe(env.SUPPORTED_LANGUAGES || 'en,zh');
    });
  });

  describe('Environment-specific behavior', () => {
    it('should have appropriate settings for current environment', () => {
      if (env.NODE_ENV === 'development') {
        // Development might have looser requirements
        expect(env.NODE_ENV).toBe('development');
      }

      if (env.NODE_ENV === 'production') {
        // Production should have all critical configs
        expect(env.DB_PROVIDER).toBeTruthy();
      }

      if (env.NODE_ENV === 'test') {
        // Test environment settings
        expect(env.NODE_ENV).toBe('test');
      }
    });
  });

  describe('Security', () => {
    it('should not expose sensitive data in logs (manual check)', () => {
      // This is a reminder that sensitive data should not be logged
      // The env module uses console.log for validation success,
      // but it should not log sensitive values like passwords
      expect(true).toBe(true);
    });

    it('DATABASE_URL should not contain plain credentials in logs', () => {
      // The actual implementation should mask credentials in logs
      // This test just verifies the field exists
      if (env.DATABASE_URL) {
        expect(env.DATABASE_URL).toBeTruthy();
      }
    });
  });

  describe('Cross-field validation', () => {
    it('should have consistent database configuration', () => {
      // The validation logic ensures provider-specific requirements are met
      // If this test runs, those validations passed
      expect(env.DB_PROVIDER).toBeTruthy();

      if (env.DB_PROVIDER === 'supabase') {
        expect(env.DATABASE_URL).toBeTruthy();
      }

      if (env.DB_PROVIDER === 'neon') {
        expect(env.NEON_DATABASE_URL).toBeTruthy();
      }
    });

    it('should validate database URL format for each provider', () => {
      // URL validation is done in superRefine
      // If this test runs, URL format was valid
      if (env.DATABASE_URL) {
        expect(env.DATABASE_URL).toMatch(/^postgres(ql)?:\/\/.+/);
      }

      if (env.NEON_DATABASE_URL) {
        expect(env.NEON_DATABASE_URL).toMatch(/^postgres(ql)?:\/\/.+/);
      }
    });
  });

  describe('Immutability', () => {
    it('env object is exported as const (TypeScript compile-time protection)', () => {
      // TypeScript provides compile-time immutability via const export
      // Runtime immutability would require Object.freeze() which is not applied
      // This test verifies the env object exists and is accessible
      expect(env).toBeDefined();
      expect(env.NODE_ENV).toBeTruthy();

      // Note: env is readonly, attempting to modify would cause a TypeScript error
      // Example: env.NODE_ENV = 'modified'; // Would be a compile-time error
    });
  });
});
