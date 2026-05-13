/**
 * Unified Error Classes
 *
 * Provides consistent error handling across the application
 * All errors extend AppError for easy catching and type checking
 */

import { logger } from './logger';
import { ERROR_CODES } from './constants';

/**
 * Base application error class
 */
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert error to JSON for API responses
   */
  toJSON() {
    return {
      error: {
        name: this.name,
        message: this.message,
        code: this.code,
        statusCode: this.statusCode,
        details: this.details,
      },
    };
  }
}

/**
 * Resource not found (404)
 */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    const message = identifier ? `${resource} not found: ${identifier}` : `${resource} not found`;

    super(message, ERROR_CODES.RESOURCE_NOT_FOUND, 404, {
      resource,
      identifier,
    });
    this.name = 'NotFoundError';
  }
}

/**
 * Resource already exists (409)
 */
export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ERROR_CODES.RESOURCE_ALREADY_EXISTS, 409, details);
    this.name = 'ConflictError';
  }
}

/**
 * Invalid input data (400)
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ERROR_CODES.INVALID_INPUT, 400, details);
    this.name = 'ValidationError';
  }
}

/**
 * Authentication required (401)
 */
export class UnauthorizedError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, ERROR_CODES.AUTH_REQUIRED, 401);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Insufficient permissions (403)
 */
export class ForbiddenError extends AppError {
  constructor(message: string = 'Insufficient permissions', details?: Record<string, unknown>) {
    super(message, ERROR_CODES.INSUFFICIENT_PERMISSIONS, 403, details);
    this.name = 'ForbiddenError';
  }
}

/**
 * Entitlement/quota exceeded errors
 */
export class EntitlementError extends AppError {
  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message, code, 403, details);
    this.name = 'EntitlementError';
  }
}

/**
 * user limit exceeded
 */
export class UserLimitExceededError extends EntitlementError {
  constructor(current: number, limit: number) {
    super(
      `user limit reached. Current: ${current}, Limit: ${limit}`,
      ERROR_CODES.USER_LIMIT_EXCEEDED,
      { current, limit }
    );
    this.name = 'UserLimitExceededError';
  }
}

/**
 * Storage limit exceeded
 */
export class StorageLimitExceededError extends EntitlementError {
  constructor(current: number, limit: number, requested: number) {
    super(
      `Storage limit would be exceeded. Current: ${current}MB, Limit: ${limit}MB, Requested: ${requested}MB`,
      ERROR_CODES.STORAGE_LIMIT_EXCEEDED,
      { current, limit, requested, wouldBe: current + requested }
    );
    this.name = 'StorageLimitExceededError';
  }
}

/**
 * API rate limit exceeded
 */
export class RateLimitExceededError extends EntitlementError {
  constructor(current: number, limit: number) {
    super(
      `API call limit reached. Current: ${current}, Limit: ${limit}`,
      ERROR_CODES.API_LIMIT_EXCEEDED,
      { current, limit }
    );
    this.name = 'RateLimitExceededError';
  }
}

/**
 * Feature not available in current plan
 */
export class FeatureNotAvailableError extends EntitlementError {
  constructor(featureName: string, planName: string) {
    super(
      `Feature '${featureName}' is not available in ${planName}. Please upgrade your plan.`,
      ERROR_CODES.FEATURE_NOT_AVAILABLE,
      { feature: featureName, plan: planName }
    );
    this.name = 'FeatureNotAvailableError';
  }
}

/**
 * Subscription not active
 */
export class SubscriptionInactiveError extends EntitlementError {
  constructor(status: string, planName?: string) {
    super(
      `Subscription is ${status}. Please renew to continue using the service.`,
      ERROR_CODES.SUBSCRIPTION_INACTIVE,
      { status, plan: planName }
    );
    this.name = 'SubscriptionInactiveError';
  }
}

/**
 * Internal server error (500)
 */
export class InternalServerError extends AppError {
  constructor(message: string = 'Internal server error', details?: Record<string, unknown>) {
    super(message, ERROR_CODES.INTERNAL_ERROR, 500, details);
    this.name = 'InternalServerError';
  }
}

/**
 * Configuration error (invalid setup/config)
 */
export class ConfigurationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ERROR_CODES.INTERNAL_ERROR, 500, details);
    this.name = 'ConfigurationError';
  }
}

/**
 * Unsupported provider error
 */
export class UnsupportedProviderError extends AppError {
  constructor(provider: string, supportedProviders: string[]) {
    super(
      `Unsupported database provider: ${provider}. Supported providers: ${supportedProviders.join(', ')}`,
      ERROR_CODES.INTERNAL_ERROR,
      500,
      { provider, supportedProviders }
    );
    this.name = 'UnsupportedProviderError';
  }
}

/**
 * Database error
 */
export class DatabaseError extends InternalServerError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { ...details, type: 'database' });
    this.name = 'DatabaseError';
    this.code = ERROR_CODES.DATABASE_ERROR;
  }
}

/**
 * External service error
 */
export class ExternalServiceError extends InternalServerError {
  constructor(service: string, message: string, details?: Record<string, unknown>) {
    super(`${service} error: ${message}`, { ...details, service });
    this.name = 'ExternalServiceError';
    this.code = ERROR_CODES.EXTERNAL_SERVICE_ERROR;
  }
}

/**
 * Plugin not found error
 */
export class PluginNotFoundError extends NotFoundError {
  constructor(pluginId: string) {
    super('Plugin', pluginId);
    this.name = 'PluginNotFoundError';
    this.code = 'PLUGIN_NOT_FOUND';
  }
}

/**
 * Plugin already installed error
 */
export class PluginAlreadyInstalledError extends ConflictError {
  constructor(pluginId: string, userId: string) {
    super(`Plugin "${pluginId}" is already installed for this user`, {
      pluginId,
      userId,
    });
    this.name = 'PluginAlreadyInstalledError';
    this.code = 'PLUGIN_ALREADY_INSTALLED';
  }
}

/**
 * Plugin not installed error
 */
export class PluginNotInstalledError extends NotFoundError {
  constructor(pluginId: string, userId: string) {
    super('Plugin installation', `${pluginId} for user ${userId}`);
    this.name = 'PluginNotInstalledError';
    this.code = 'PLUGIN_NOT_INSTALLED';
    this.details = { pluginId, userId };
  }
}

/**
 * Plugin installation error
 */
export class PluginInstallError extends InternalServerError {
  constructor(pluginId: string, message: string, details?: Record<string, unknown>) {
    super(`Failed to install plugin "${pluginId}": ${message}`, { ...details, pluginId });
    this.name = 'PluginInstallError';
    this.code = 'PLUGIN_INSTALL_ERROR';
  }
}

/**
 * Plugin lifecycle error
 */
export class PluginLifecycleError extends InternalServerError {
  constructor(
    pluginId: string,
    lifecycle: string,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(`Plugin "${pluginId}" ${lifecycle} failed: ${message}`, {
      ...details,
      pluginId,
      lifecycle,
    });
    this.name = 'PluginLifecycleError';
    this.code = 'PLUGIN_LIFECYCLE_ERROR';
  }
}

/**
 * Type guard to check if error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Convert unknown error to AppError
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new InternalServerError(error.message, {
      originalError: error.name,
      stack: error.stack,
    });
  }

  return new InternalServerError('An unknown error occurred', {
    error: String(error),
  });
}

function removeStackFields(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => removeStackFields(item));
  }

  const result: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    if (key.toLowerCase().includes('stack')) {
      continue;
    }

    result[key] = removeStackFields(nestedValue);
  }

  return result;
}

function shouldRedactErrorDetailKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, '');

  return [
    'password',
    'token',
    'secret',
    'authorization',
    'cookie',
    'setcookie',
    'rawbody',
    'body',
    'payload',
    'messagebody',
    'apikey',
    'accesstoken',
    'refreshtoken',
    'stripe',
    'databaseurl',
    'connectionstring',
  ].some((sensitiveKey) => normalized.includes(sensitiveKey));
}

export function sanitizeErrorDetailsForResponse(value: unknown): unknown {
  const stackless = removeStackFields(value);

  if (stackless === null || stackless === undefined || typeof stackless !== 'object') {
    return stackless;
  }

  if (Array.isArray(stackless)) {
    return stackless.map((item) => sanitizeErrorDetailsForResponse(item));
  }

  const result: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(stackless)) {
    result[key] = shouldRedactErrorDetailKey(key)
      ? '[REDACTED]'
      : sanitizeErrorDetailsForResponse(nestedValue);
  }

  return result;
}

export function serializeAppErrorForResponse(appError: AppError) {
  const response = appError.toJSON();

  if (response.error.details) {
    response.error.details = sanitizeErrorDetailsForResponse(response.error.details) as Record<
      string,
      unknown
    >;
  }

  return response;
}

/**
 * Convert unknown error to error response object
 */
export function toErrorResponse(error: unknown) {
  const appError = toAppError(error);
  return serializeAppErrorForResponse(appError);
}

/**
 * Error handler for API routes
 *
 * @example
 * ```typescript
 * try {
 *   // ... your logic
 * } catch (error) {
 *   return handleApiError(error);
 * }
 * ```
 */
export function handleApiError(error: unknown): Response {
  const appError = toAppError(error);

  // Log error using structured logger
  if (appError.statusCode >= 500) {
    logger.error(
      {
        name: appError.name,
        message: appError.message,
        code: appError.code,
        details: appError.details,
        stack: appError.stack,
      },
      '[API Error] Server error'
    );
  } else {
    logger.warn(
      {
        name: appError.name,
        message: appError.message,
        code: appError.code,
        details: appError.details,
      },
      '[API Error] Client error'
    );
  }

  return new Response(JSON.stringify(serializeAppErrorForResponse(appError)), {
    status: appError.statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Plugin has no API endpoints
 */
export class PluginNoAPIError extends NotFoundError {
  constructor(pluginId: string) {
    super('Plugin API', `Plugin "${pluginId}" does not expose API endpoints`);
    this.name = 'PluginNoAPIError';
    this.code = 'PLUGIN_NO_API';
    this.details = { pluginId };
  }
}
