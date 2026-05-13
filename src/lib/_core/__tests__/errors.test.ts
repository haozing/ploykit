/**
 * Unit tests for lib/errors.ts
 *
 * Tests all error classes and utility functions
 */

import {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  EntitlementError,
  UserLimitExceededError,
  StorageLimitExceededError,
  RateLimitExceededError,
  FeatureNotAvailableError,
  SubscriptionInactiveError,
  InternalServerError,
  ConfigurationError,
  UnsupportedProviderError,
  DatabaseError,
  ExternalServiceError,
  PluginNotFoundError,
  PluginAlreadyInstalledError,
  PluginNotInstalledError,
  PluginInstallError,
  PluginLifecycleError,
  PluginNoAPIError,
  handleApiError,
  isAppError,
  toAppError,
  toErrorResponse,
} from '../errors';
import { ERROR_CODES } from '../constants';

describe('lib/errors', () => {
  describe('AppError', () => {
    it('should create base error with correct properties', () => {
      const error = new AppError('Test message', 'TEST_CODE', 400, {
        detail: 'test',
      });

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('Test message');
      expect(error.code).toBe('TEST_CODE');
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual({ detail: 'test' });
      expect(error.name).toBe('AppError');
    });

    it('should default to status code 400', () => {
      const error = new AppError('Test', 'TEST');
      expect(error.statusCode).toBe(400);
    });

    it('should convert to JSON correctly', () => {
      const error = new AppError('Test message', 'TEST_CODE', 400, {
        key: 'value',
      });
      const json = error.toJSON();

      expect(json).toEqual({
        error: {
          name: 'AppError',
          message: 'Test message',
          code: 'TEST_CODE',
          statusCode: 400,
          details: { key: 'value' },
        },
      });
    });

    it('should have stack trace', () => {
      const error = new AppError('Test', 'TEST');
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('AppError');
    });
  });

  describe('NotFoundError', () => {
    it('should create 404 error', () => {
      const error = new NotFoundError('User', '123');

      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe(ERROR_CODES.RESOURCE_NOT_FOUND);
      expect(error.message).toBe('User not found: 123');
      expect(error.details).toEqual({
        resource: 'User',
        identifier: '123',
      });
    });

    it('should work without identifier', () => {
      const error = new NotFoundError('Resource');
      expect(error.message).toBe('Resource not found');
    });
  });

  describe('ConflictError', () => {
    it('should create 409 error', () => {
      const error = new ConflictError('Resource already exists', {
        id: '123',
      });

      expect(error.statusCode).toBe(409);
      expect(error.code).toBe(ERROR_CODES.RESOURCE_ALREADY_EXISTS);
      expect(error.message).toBe('Resource already exists');
    });
  });

  describe('ValidationError', () => {
    it('should create 400 error', () => {
      const error = new ValidationError('Invalid input', {
        field: 'email',
      });

      expect(error.statusCode).toBe(400);
      expect(error.code).toBe(ERROR_CODES.INVALID_INPUT);
    });
  });

  describe('UnauthorizedError', () => {
    it('should create 401 error with default message', () => {
      const error = new UnauthorizedError();

      expect(error.statusCode).toBe(401);
      expect(error.code).toBe(ERROR_CODES.AUTH_REQUIRED);
      expect(error.message).toBe('Authentication required');
    });

    it('should accept custom message', () => {
      const error = new UnauthorizedError('Invalid token');
      expect(error.message).toBe('Invalid token');
    });
  });

  describe('ForbiddenError', () => {
    it('should create 403 error with default message', () => {
      const error = new ForbiddenError();

      expect(error.statusCode).toBe(403);
      expect(error.code).toBe(ERROR_CODES.INSUFFICIENT_PERMISSIONS);
      expect(error.message).toBe('Insufficient permissions');
    });

    it('should accept custom message and details', () => {
      const error = new ForbiddenError('Access denied', { reason: 'test' });
      expect(error.message).toBe('Access denied');
      expect(error.details).toEqual({ reason: 'test' });
    });
  });

  describe('EntitlementError subclasses', () => {
    it('UserLimitExceededError should work correctly', () => {
      const error = new UserLimitExceededError(5, 3);

      expect(error).toBeInstanceOf(EntitlementError);
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe(ERROR_CODES.USER_LIMIT_EXCEEDED);
      expect(error.message).toContain('5');
      expect(error.message).toContain('3');
      expect(error.details).toEqual({ current: 5, limit: 3 });
    });

    it('StorageLimitExceededError should work correctly', () => {
      const error = new StorageLimitExceededError(80, 100, 30);

      expect(error.code).toBe(ERROR_CODES.STORAGE_LIMIT_EXCEEDED);
      expect(error.details).toEqual({
        current: 80,
        limit: 100,
        requested: 30,
        wouldBe: 110,
      });
    });

    it('RateLimitExceededError should work correctly', () => {
      const error = new RateLimitExceededError(150, 100);

      expect(error.code).toBe(ERROR_CODES.API_LIMIT_EXCEEDED);
      expect(error.details).toEqual({ current: 150, limit: 100 });
    });

    it('FeatureNotAvailableError should work correctly', () => {
      const error = new FeatureNotAvailableError('Advanced Analytics', 'Free');

      expect(error.code).toBe(ERROR_CODES.FEATURE_NOT_AVAILABLE);
      expect(error.message).toContain('Advanced Analytics');
      expect(error.message).toContain('Free');
      expect(error.details).toEqual({
        feature: 'Advanced Analytics',
        plan: 'Free',
      });
    });

    it('SubscriptionInactiveError should work correctly', () => {
      const error = new SubscriptionInactiveError('expired', 'Pro');

      expect(error.code).toBe(ERROR_CODES.SUBSCRIPTION_INACTIVE);
      expect(error.message).toContain('expired');
      expect(error.details).toEqual({ status: 'expired', plan: 'Pro' });
    });
  });

  describe('InternalServerError and subclasses', () => {
    it('InternalServerError should create 500 error', () => {
      const error = new InternalServerError('Something went wrong');

      expect(error.statusCode).toBe(500);
      expect(error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    });

    it('DatabaseError should work correctly', () => {
      const error = new DatabaseError('Connection failed', { host: 'localhost' });

      expect(error).toBeInstanceOf(InternalServerError);
      expect(error.code).toBe(ERROR_CODES.DATABASE_ERROR);
      expect(error.details).toHaveProperty('type', 'database');
      expect(error.details).toHaveProperty('host', 'localhost');
    });

    it('ExternalServiceError should work correctly', () => {
      const error = new ExternalServiceError('Stripe', 'Payment failed');

      expect(error.code).toBe(ERROR_CODES.EXTERNAL_SERVICE_ERROR);
      expect(error.message).toContain('Stripe');
      expect(error.message).toContain('Payment failed');
      expect(error.details).toHaveProperty('service', 'Stripe');
    });
  });

  describe('Plugin error classes', () => {
    it('PluginNotFoundError should work', () => {
      const error = new PluginNotFoundError('analytics');

      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.code).toBe('PLUGIN_NOT_FOUND');
      expect(error.message).toContain('analytics');
    });

    it('PluginAlreadyInstalledError should work', () => {
      const error = new PluginAlreadyInstalledError('analytics', 'user-123');

      expect(error).toBeInstanceOf(ConflictError);
      expect(error.code).toBe('PLUGIN_ALREADY_INSTALLED');
      expect(error.details).toEqual({
        pluginId: 'analytics',
        userId: 'user-123',
      });
    });

    it('PluginNotInstalledError should work', () => {
      const error = new PluginNotInstalledError('analytics', 'user-123');

      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.code).toBe('PLUGIN_NOT_INSTALLED');
    });

    it('PluginInstallError should work', () => {
      const error = new PluginInstallError('analytics', 'Dependency missing');

      expect(error).toBeInstanceOf(InternalServerError);
      expect(error.code).toBe('PLUGIN_INSTALL_ERROR');
      expect(error.message).toContain('analytics');
      expect(error.message).toContain('Dependency missing');
    });

    it('PluginLifecycleError should work', () => {
      const error = new PluginLifecycleError('analytics', 'onInstall', 'Timeout');

      expect(error.code).toBe('PLUGIN_LIFECYCLE_ERROR');
      expect(error.message).toContain('analytics');
      expect(error.message).toContain('onInstall');
      expect(error.details).toHaveProperty('lifecycle', 'onInstall');
    });

    it('PluginNoAPIError should work', () => {
      const error = new PluginNoAPIError('static-plugin');

      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.code).toBe('PLUGIN_NO_API');
    });
  });

  describe('ConfigurationError', () => {
    it('should create 500 error', () => {
      const error = new ConfigurationError('Invalid config', {
        key: 'DATABASE_URL',
      });

      expect(error.statusCode).toBe(500);
      expect(error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    });
  });

  describe('UnsupportedProviderError', () => {
    it('should include supported providers', () => {
      const error = new UnsupportedProviderError('mysql', ['postgres', 'neon']);

      expect(error.statusCode).toBe(500);
      expect(error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(error.message).toContain('mysql');
      expect(error.message).toContain('postgres');
      expect(error.message).toContain('neon');
      expect(error.details).toEqual({
        provider: 'mysql',
        supportedProviders: ['postgres', 'neon'],
      });
    });
  });

  describe('isAppError', () => {
    it('should return true for AppError instances', () => {
      expect(isAppError(new AppError('test', 'TEST'))).toBe(true);
      expect(isAppError(new NotFoundError('test'))).toBe(true);
      expect(isAppError(new ValidationError('test'))).toBe(true);
    });

    it('should return false for non-AppError', () => {
      expect(isAppError(new Error('test'))).toBe(false);
      expect(isAppError('string')).toBe(false);
      expect(isAppError(null)).toBe(false);
      expect(isAppError(undefined)).toBe(false);
      expect(isAppError({})).toBe(false);
    });
  });

  describe('toAppError', () => {
    it('should return AppError as-is', () => {
      const error = new NotFoundError('test');
      expect(toAppError(error)).toBe(error);
    });

    it('should convert Error to InternalServerError', () => {
      const error = new Error('Test error');
      const appError = toAppError(error);

      expect(appError).toBeInstanceOf(InternalServerError);
      expect(appError.message).toBe('Test error');
      expect(appError.details).toHaveProperty('originalError', 'Error');
    });

    it('should convert unknown to InternalServerError', () => {
      const appError = toAppError('string error');

      expect(appError).toBeInstanceOf(InternalServerError);
      expect(appError.message).toBe('An unknown error occurred');
      expect(appError.details).toHaveProperty('error', 'string error');
    });
  });

  describe('toErrorResponse', () => {
    it('should convert error to response object', () => {
      const error = new NotFoundError('User', '123');
      const response = toErrorResponse(error);

      expect(response).toEqual({
        error: {
          name: 'NotFoundError',
          message: 'User not found: 123',
          code: ERROR_CODES.RESOURCE_NOT_FOUND,
          statusCode: 404,
          details: {
            resource: 'User',
            identifier: '123',
          },
        },
      });
    });

    it('should handle non-AppError', () => {
      const response = toErrorResponse(new Error('Test'));

      expect(response.error.name).toBe('InternalServerError');
      expect(response.error.statusCode).toBe(500);
      expect(response.error.details).toEqual({ originalError: 'Error' });
      expect(JSON.stringify(response)).not.toContain('stack');
    });

    it('should sanitize sensitive details from error responses', () => {
      const response = toErrorResponse(
        new InternalServerError('Sensitive failure', {
          stack: 'do not expose stack',
          payload: { password: 'secret-password' },
          nested: {
            errorStack: 'nested stack',
            token: 'secret-token',
          },
        })
      );

      const serialized = JSON.stringify(response);

      expect(response.error.details).toEqual({
        payload: '[REDACTED]',
        nested: {
          token: '[REDACTED]',
        },
      });
      expect(serialized).not.toContain('do not expose stack');
      expect(serialized).not.toContain('nested stack');
      expect(serialized).not.toContain('secret-password');
    });
  });

  describe('handleApiError', () => {
    it('should not return stack details in API responses', async () => {
      const response = handleApiError(new Error('Boom'));
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error.details).toEqual({ originalError: 'Error' });
      expect(JSON.stringify(body)).not.toContain('stack');
    });
  });
});
