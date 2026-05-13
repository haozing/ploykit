/**
 * Logger - Unified logging system based on Pino
 *
 * Features:
 * - Structured logging (JSON format)
 * - Auto environment adaptation (dev: pretty print, prod: JSON)
 * - Support for contextual child loggers
 * - High performance (Pino is the fastest Node.js logging library)
 * - Configurable logging options
 *
 * Usage examples:
 * ```typescript
 * import { logger, createLogger, configureLogger } from '@/lib/_core/logger';
 *
 * // Basic logging
 * logger.info('Server started');
 * logger.error({ err: error }, 'Failed to connect');
 *
 * // Create contextual logger
 * const pluginLogger = createLogger({ pluginId: 'welcome', userId: 'user-abc-123' });
 * pluginLogger.info('Plugin installed');
 *
 * // Configure logger
 * configureLogger({ level: 'debug', redactPaths: ['password'] });
 * ```
 */

import pino, { type LoggerOptions } from 'pino';

// Logger Configuration

export const DEFAULT_LOG_REDACT_PATHS = [
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'apiKey',
  'stripe',
  'headers.authorization',
  'headers.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
  'payload.password',
  'payload.token',
  'payload.secret',
  'payload.apiKey',
  'payload.stripe',
  '*.password',
  '*.token',
  '*.secret',
  '*.authorization',
  '*.cookie',
  '*.apiKey',
  '*.stripe',
];

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  /** Log level (debug, info, warn, error) */
  level?: 'debug' | 'info' | 'warn' | 'error';

  /** Additional base context to include in all logs */
  baseContext?: Record<string, unknown>;

  /** Paths to redact in logs (e.g., ['password', 'apiKey']) */
  redactPaths?: string[];

  /** Enable timestamp in logs (default: true) */
  timestamp?: boolean;

  /** Pretty print in development (requires pino-pretty) */
  prettyPrint?: boolean;
}

/**
 * Global logger configuration
 */
let loggerConfig: LoggerConfig = {
  level:
    (process.env.LOG_LEVEL as LoggerConfig['level']) ||
    (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  baseContext: {
    env: process.env.NODE_ENV,
  },
  redactPaths: DEFAULT_LOG_REDACT_PATHS,
  timestamp: true,
  prettyPrint: false,
};

/**
 * Build Pino options from configuration
 */
function buildPinoOptions(config: LoggerConfig): LoggerOptions {
  const redactPaths = Array.from(
    new Set([...DEFAULT_LOG_REDACT_PATHS, ...(config.redactPaths || [])])
  );

  const options: LoggerOptions = {
    level: config.level || 'info',
    base: config.baseContext,
    redact: {
      paths: redactPaths,
      censor: '[REDACTED]',
    },
  };

  if (config.timestamp !== false) {
    options.timestamp = pino.stdTimeFunctions.isoTime;
  }

  return options;
}

/**
 * Logger Instance
 *
 * Configuration:
 * - level: Controlled via LOG_LEVEL environment variable, defaults to dev=debug, prod=info
 * - No transport (avoids worker thread issues with pino-pretty)
 * - Uses basic JSON output
 */
export const logger = pino(buildPinoOptions(loggerConfig));

/**
 * Configure logger at runtime
 *
 * WARNING: This should be called early in application initialization
 * Note: Changing configuration after logger creation requires recreation
 *
 * @param config - Partial logger configuration
 *
 * @example
 * ```typescript
 * configureLogger({
 *   level: 'debug',
 *   redactPaths: ['password', 'apiKey', 'token'],
 *   baseContext: { service: 'api', version: '1.0.0' }
 * });
 * ```
 */
export function configureLogger(config: Partial<LoggerConfig>): void {
  loggerConfig = {
    ...loggerConfig,
    ...config,
  };

  // Note: Pino doesn't support hot-reloading configuration
  // For dynamic log level changes, use logger.level property directly
  // Example: logger.level = 'debug'
  if (config.level) {
    logger.level = config.level;
  }
}

/**
 * Get current logger configuration
 *
 * @returns Current logger configuration
 */
export function getLoggerConfig(): Readonly<LoggerConfig> {
  return Object.freeze({ ...loggerConfig });
}

/**
 * Create contextual child logger
 *
 * Used to create log records for specific modules, users, or requests
 *
 * @param context - Context object (will be automatically attached to all logs)
 * @returns Logger instance
 *
 * @example
 * ```typescript
 * const requestLogger = createLogger({
 *   requestId: 'req-123',
 *   userId: 'user-xyz'
 * });
 *
 * requestLogger.info('Processing request');
 * // Output: { "level": 30, "requestId": "req-123", "userId": "user-xyz", ... }
 * ```
 */
export function createLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

/**
 * Predefined module loggers (optional, use as needed)
 *
 * If a module has high log volume, you can create a dedicated logger:
 * ```typescript
 * export const pluginLogger = logger.child({ module: 'plugin' });
 * export const dbLogger = logger.child({ module: 'db' });
 * ```
 *
 * For small projects, using logger or createLogger directly is sufficient
 */
