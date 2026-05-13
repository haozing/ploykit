/**
 * Vitest Setup File
 *
 * Sets up environment variables for testing before any test files are imported
 */

import { vi } from 'vitest';

// Set up test environment variables
// @ts-expect-error - NODE_ENV is readonly but we need to set it for tests
process.env.NODE_ENV = 'test';
process.env.DB_PROVIDER = 'postgres';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
process.env.SUPPORTED_LANGUAGES = 'en,zh';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key_for_testing';

// Mock server-only module to prevent import errors in tests
vi.mock('server-only', () => ({
  default: {},
}));
