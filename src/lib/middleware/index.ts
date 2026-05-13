/**
 * Middleware Exports
 *
 * This module provides a unified API for all middleware functions.
 * All middleware follow the "onion model" pattern and can be composed together.
 */

// Error Handling Middleware
export {
  withErrorHandling,
  withPluginErrorHandling,
  withDevErrorHandling,
  withProdErrorHandling,
  catchAsync,
  withRetry,
  type ApiHandler,
  type DefaultRouteContext,
  type RouteContext,
  type ErrorHandlerOptions,
} from './api-error-handler';

// Authentication Middleware
export {
  withAuth,
  withOptionalAuth,
  withAuthenticatedUserContext,
  getOperatorUserId,
  getOperatorEmail,
  type AuthContext,
  type AuthenticatedApiHandler,
} from './auth';

// Validation Middleware
export {
  withBodyValidation,
  withQueryValidation,
  withParamsValidation,
  withValidation,
  type ValidationContext,
  type ValidationSchemas,
  type ValidatedApiHandler,
} from './validation';

// Usage Tracking Middleware
export { withUsageTracking, type UsageTrackingOptions } from './usage-tracking';

// Admin Guard Middleware
export { withAdminGuard } from './admin-guard';

// Debug Guard Middleware
export { withDebugGuard, type DebugGuardOptions } from './debug-guard';

// Rate Limiter Middleware
export {
  createRateLimiter,
  withRateLimit,
  authRateLimiter,
  apiRateLimiter,
  strictRateLimiter,
} from './rate-limiter';

// Origin Guard Middleware
export { withOriginGuard } from './origin-guard';

// CSRF Guard Middleware
export { withCsrfGuard } from './csrf-guard';

// Entitlement Guard Functions (for use within business logic)
export {
  canInstallPlugin,
  canUseStorage,
  canMakeApiCall,
  requireFeature,
  requireFeatures,
  requireActiveEntitlement,
  checkEntitlementStatus,
  checkAllLimits,
} from './entitlement-guard';
