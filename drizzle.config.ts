/**
 * Drizzle Kit Configuration
 *
 * Used for:
 * - Generate SQL migrations
 * - Manage database schema
 * - Start Drizzle Studio
 *
 * ✅ Note: Uses Session Mode (port 5432) for full PostgreSQL support
 */

import { defineConfig } from 'drizzle-kit';
import { getMigrationUrl } from './src/lib/db/config.server';

export default defineConfig({
  // Schema file path
  schema: './src/lib/db/schema/*',

  // Migration output directory
  out: './drizzle/migrations',

  // Database dialect
  dialect: 'postgresql',

  // Database connection configuration
  dbCredentials: {
    url: getMigrationUrl(),
  },

  // Verbose logging
  verbose: true,

  // Strict mode (type checking)
  strict: true,

  // Migration configuration
  migrations: {
    table: 'drizzle_migrations', // Migration records table name
    schema: 'public', // Schema name
  },
});
