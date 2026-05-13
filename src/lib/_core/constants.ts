/**
 * Application Constants
 *
 * Centralized constants to avoid magic numbers and strings
 * Provides type-safe, well-documented constant values used throughout the application
 */

// ?
// Rate Limiting
// ?

/**
 * Rate limiting configuration for SQL queries (plugin system)
 */
export const SQL_RATE_LIMITS = {
  /** Number of queries allowed per second per plugin */
  QUERIES_PER_SECOND: 100,

  /** Burst capacity - maximum tokens that can accumulate */
  BURST_CAPACITY: 150,

  /** Time interval in milliseconds (1 second) */
  INTERVAL_MS: 1000,
} as const;

/**
 * Rate limiting configuration for API requests
 */
export const API_RATE_LIMITS = {
  /** API calls per minute for authenticated users */
  AUTHENTICATED_PER_MINUTE: 60,

  /** API calls per minute for anonymous users */
  ANONYMOUS_PER_MINUTE: 10,

  /** Burst capacity for authenticated users */
  AUTHENTICATED_BURST: 100,

  /** Burst capacity for anonymous users */
  ANONYMOUS_BURST: 20,
} as const;

// ?
// Pagination
// ?

/**
 * Pagination defaults and limits
 */
export const PAGINATION = {
  /** Default page number (1-indexed) */
  DEFAULT_PAGE: 1,

  /** Default number of items per page */
  DEFAULT_LIMIT: 20,

  /** Maximum items per page to prevent overload */
  MAX_LIMIT: 100,

  /** Minimum items per page */
  MIN_LIMIT: 1,
} as const;

// ?
// SQL Limits
// ?

/**
 * SQL query validation limits
 */
export const SQL_LIMITS = {
  /** Maximum length of SQL query string (50,000 characters) */
  MAX_QUERY_LENGTH: 50_000,

  /** Maximum number of query parameters */
  MAX_PARAMS: 100,

  /** Minimum query length */
  MIN_QUERY_LENGTH: 1,
} as const;

// ?
// Timeouts
// ?

/**
 * Timeout values in milliseconds
 */
export const TIMEOUTS = {
  /** Database query timeout (5 seconds) */
  DATABASE_QUERY_MS: 5_000,

  /** General API request timeout (30 seconds) */
  API_REQUEST_MS: 30_000,

  /** File upload timeout (60 seconds) */
  FILE_UPLOAD_MS: 60_000,

  /** External service timeout (10 seconds) */
  EXTERNAL_SERVICE_MS: 10_000,

  /** Session validation timeout (2 seconds) */
  SESSION_VALIDATION_MS: 2_000,
} as const;

// ?
// Cache TTL (Time To Live)
// ?

/**
 * Cache time-to-live values in seconds
 */
export const CACHE_TTL = {
  /** User session cache (1 hour) */
  USER_SESSION_SECONDS: 3600,

  /** Entitlement plans cache (1 hour) */
  ENTITLEMENT_PLANS_SECONDS: 3600,

  /** Role permissions cache (30 minutes) */
  ROLE_PERMISSIONS_SECONDS: 1800,

  /** User profile cache (10 minutes) */
  USER_PROFILE_SECONDS: 600,

  /** Audit logs cache (5 minutes) */
  AUDIT_LOGS_SECONDS: 300,

  //
  // Cache Manager specific TTLs
  //

  /** Plugin runtime contract cache (never expires, managed by HMR) */
  PLUGIN_CONTRACT_SECONDS: 0,

  /** User data cache (5 minutes) */
  USER_SECONDS: 300,

  /** User roles cache (15 minutes) */
  USER_ROLES_SECONDS: 900,

  /** User permissions cache (15 minutes) */
  USER_PERMISSIONS_SECONDS: 900,

  /** User entitlement cache (10 minutes) */
  USER_ENTITLEMENT_SECONDS: 600,

  /** Plugin settings cache (30 minutes) */
  PLUGIN_SETTINGS_SECONDS: 1800,
} as const;

// ?
// Retry Configuration
// ?

/**
 * Retry behavior configuration
 */
export const RETRY_CONFIG = {
  /** Maximum number of retry attempts */
  MAX_RETRIES: 3,

  /** Initial delay before first retry (1 second) */
  INITIAL_DELAY_MS: 1000,

  /** Maximum delay between retries (10 seconds) */
  MAX_DELAY_MS: 10_000,

  /** Backoff multiplier for exponential backoff */
  BACKOFF_MULTIPLIER: 2,
} as const;

// ?
// File Upload Limits
// ?

/**
 * File upload size limits
 */
export const FILE_LIMITS = {
  /** Maximum file size in bytes (10 MB) */
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,

  /** Maximum avatar file size in bytes (2 MB) */
  MAX_AVATAR_SIZE_BYTES: 2 * 1024 * 1024,

  /** Maximum document file size in bytes (50 MB) */
  MAX_DOCUMENT_SIZE_BYTES: 50 * 1024 * 1024,

  /** Maximum total upload size per request (100 MB) */
  MAX_TOTAL_SIZE_BYTES: 100 * 1024 * 1024,
} as const;

/**
 * Allowed file MIME types
 */
export const ALLOWED_MIME_TYPES = {
  /** Image file types */
  IMAGES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],

  /** Document file types */
  DOCUMENTS: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],

  /** Archive file types */
  ARCHIVES: ['application/zip', 'application/x-tar', 'application/gzip'],
} as const;

// ?
// String Length Limits
// ?

/**
 * Text field length limits
 */
export const STRING_LIMITS = {
  /** Slug length */
  SLUG_MIN: 1,
  SLUG_MAX: 100,

  /** User name length */
  USER_NAME_MIN: 1,
  USER_NAME_MAX: 100,

  /** Email length */
  EMAIL_MAX: 254, // RFC 5321

  /** Description length */
  DESCRIPTION_MAX: 500,

  /** Long text / notes */
  NOTES_MAX: 2000,

  /** Short text / title */
  TITLE_MAX: 200,

  /** Password length */
  PASSWORD_MIN: 8,
  PASSWORD_MAX: 128,
} as const;

// ?
// Default Entitlement Limits
// ?

/**
 * Default usage limits for Free plan
 */
export const FREE_PLAN_LIMITS = {
  /** Maximum users */
  MAX_USERS: 3,

  /** Maximum plugins */
  MAX_PLUGINS: 2,

  /** Maximum storage in MB */
  MAX_STORAGE_MB: 100,

  /** Maximum API calls per month */
  MAX_API_CALLS_PER_MONTH: 1000,

  /** Maximum file size in MB */
  MAX_FILE_SIZE_MB: 5,
} as const;

/**
 * Unlimited limit indicator
 */
export const UNLIMITED = -1;

// ?
// Audit Log
// ?

/**
 * Audit log retention periods
 */
export const AUDIT_RETENTION = {
  /** Keep audit logs for 90 days */
  RETENTION_DAYS: 90,

  /** Archive after 30 days */
  ARCHIVE_AFTER_DAYS: 30,

  /** Batch size for cleanup operations */
  CLEANUP_BATCH_SIZE: 1000,
} as const;

// ?
// Session Configuration
// ?

/**
 * Session management configuration
 */
export const SESSION_CONFIG = {
  /** Session duration in seconds (7 days) */
  DURATION_SECONDS: 7 * 24 * 60 * 60,

  /** Remember me duration in seconds (30 days) */
  REMEMBER_ME_SECONDS: 30 * 24 * 60 * 60,

  /** Session renewal threshold (1 day before expiry) */
  RENEWAL_THRESHOLD_SECONDS: 24 * 60 * 60,

  /** Idle timeout in seconds (30 minutes) */
  IDLE_TIMEOUT_SECONDS: 30 * 60,
} as const;

// ?
// Email Configuration
// ?

/**
 * Email sending limits
 */
export const EMAIL_LIMITS = {
  /** Maximum emails per hour per user */
  MAX_PER_HOUR: 10,

  /** Maximum emails per day per user */
  MAX_PER_DAY: 50,

  /** Verification email retry attempts */
  VERIFICATION_RETRY_MAX: 3,

  /** Verification link expiry (24 hours) */
  VERIFICATION_EXPIRY_SECONDS: 24 * 60 * 60,
} as const;

// ?
// HTTP Status Codes (for reference)
// ?

/**
 * Common HTTP status codes
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

// ?
// Regex Patterns
// ?

/**
 * Common regex patterns for validation
 */
export const REGEX_PATTERNS = {
  /** Slug pattern: lowercase alphanumeric with hyphens */
  SLUG: /^[a-z0-9-]+$/,

  /** UUID v4 pattern */
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,

  /** Email pattern (basic) */
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,

  /** Strong password: min 8 chars, 1 upper, 1 lower, 1 number, 1 special */
  STRONG_PASSWORD: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,

  /** Phone number (international format) */
  PHONE: /^\+?[1-9]\d{1,14}$/,

  /** URL pattern */
  URL: /^https?:\/\/.+/,
} as const;

// ?
// Date/Time Formats
// ?

/**
 * Standard date/time formats
 */
export const DATE_FORMATS = {
  /** ISO 8601 date format */
  ISO_DATE: 'YYYY-MM-DD',

  /** ISO 8601 datetime format */
  ISO_DATETIME: 'YYYY-MM-DDTHH:mm:ss.SSSZ',

  /** Display date format */
  DISPLAY_DATE: 'MMM DD, YYYY',

  /** Display datetime format */
  DISPLAY_DATETIME: 'MMM DD, YYYY HH:mm',

  /** Short date format */
  SHORT_DATE: 'MM/DD/YYYY',
} as const;

// ?
// Error Codes
// ?

/**
 * Application-specific error codes
 */
export const ERROR_CODES = {
  // Authentication errors
  AUTH_REQUIRED: 'AUTH_001',
  INVALID_CREDENTIALS: 'AUTH_002',
  SESSION_EXPIRED: 'AUTH_003',
  EMAIL_NOT_VERIFIED: 'AUTH_004',

  // Authorization errors
  INSUFFICIENT_PERMISSIONS: 'AUTHZ_001',
  RESOURCE_FORBIDDEN: 'AUTHZ_002',

  // Validation errors
  INVALID_INPUT: 'VAL_001',
  MISSING_REQUIRED_FIELD: 'VAL_002',
  INVALID_FORMAT: 'VAL_003',

  // Resource errors
  RESOURCE_NOT_FOUND: 'RES_001',
  RESOURCE_ALREADY_EXISTS: 'RES_002',
  RESOURCE_IN_USE: 'RES_003',

  // Entitlement errors
  USER_LIMIT_EXCEEDED: 'ENT_001',
  STORAGE_LIMIT_EXCEEDED: 'ENT_002',
  API_LIMIT_EXCEEDED: 'ENT_003',
  FEATURE_NOT_AVAILABLE: 'ENT_004',
  SUBSCRIPTION_INACTIVE: 'ENT_005',

  // System errors
  DATABASE_ERROR: 'SYS_001',
  EXTERNAL_SERVICE_ERROR: 'SYS_002',
  INTERNAL_ERROR: 'SYS_003',
  RATE_LIMIT_EXCEEDED: 'SYS_004',
} as const;
