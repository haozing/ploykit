/**
 * Bus System Input Validation Tools
 *
 * Provides unified parameter validation to ensure type safety and business logic
 */

import type { AllHookName } from './hooks/types';
import { ALL_HOOK_NAMES } from './hooks/constants';
import { ValidationError } from '@/lib/_core/errors';

/**
 * Plugin ID format regular expression (lowercase letters, numbers, hyphens)
 */
const PLUGIN_ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EVENT_METADATA_ID_REGEX = /^[a-zA-Z0-9._:-]{1,200}$/;

function validateOptionalMetadataId(value: unknown, field: string, context: string): void {
  if (value === undefined) {
    return;
  }

  if (typeof value !== 'string') {
    throw new ValidationError(`${context}: ${field} must be a string`, {
      got: typeof value,
      expected: 'string',
      field,
      context,
    });
  }

  if (!EVENT_METADATA_ID_REGEX.test(value)) {
    throw new ValidationError(
      `${context}: ${field} may only contain letters, numbers, dots, underscores, colons, and hyphens`,
      { field, context }
    );
  }
}

/**
 * Bus Validator
 */
export class BusValidator {
  /**
   * Validate Plugin ID
   *
   * @param pluginId - Plugin ID
   * @param context - Calling context (for error messages)
   */
  static validatePluginId(pluginId: string, context: string): void {
    if (typeof pluginId !== 'string') {
      throw new ValidationError(`${context}: pluginId must be a string`, {
        got: typeof pluginId,
        expected: 'string',
      });
    }

    const trimmed = pluginId.trim();
    if (trimmed.length === 0) {
      throw new ValidationError(`${context}: pluginId cannot be empty`, { context });
    }

    if (!PLUGIN_ID_REGEX.test(trimmed)) {
      throw new ValidationError(
        `${context}: pluginId must contain only lowercase letters, numbers, and hyphens`,
        { pluginId, context }
      );
    }
  }

  /**
   * Verification Hook Name
   *
   * @param hookName - Hook Name
   */
  static validateHookName(hookName: string, context: string): void {
    if (!ALL_HOOK_NAMES.includes(hookName as AllHookName)) {
      throw new ValidationError(
        `${context}: Invalid hook name. Valid hooks: ${ALL_HOOK_NAMES.join(', ')}`,
        {
          hookName,
          validHooks: ALL_HOOK_NAMES,
          context,
        }
      );
    }
  }

  /**
   * VerificationEvent name
   *
   * @param event - Event name
   */
  static validateEventName(event: string, context: string): void {
    if (typeof event !== 'string') {
      throw new ValidationError(`${context}: event must be a string`, {
        got: typeof event,
        expected: 'string',
        context,
      });
    }

    const trimmed = event.trim();
    if (trimmed.length === 0) {
      throw new ValidationError(`${context}: event name cannot be empty`, { context });
    }
  }

  static validateEventMetadata(
    metadata: {
      eventId?: unknown;
      correlationId?: unknown;
      causationId?: unknown;
      idempotencyKey?: unknown;
    },
    context: string
  ): void {
    validateOptionalMetadataId(metadata.eventId, 'eventId', context);
    validateOptionalMetadataId(metadata.correlationId, 'correlationId', context);
    validateOptionalMetadataId(metadata.causationId, 'causationId', context);
    validateOptionalMetadataId(metadata.idempotencyKey, 'idempotencyKey', context);
  }

  /**
   * Validate Service Name
   *
   * Service names must contain a colon separator, e.g., "service:name" or "service:name@v1"
   *
   * @param service - Service name
   * @param context - Calling context (for error messages)
   */
  static validateServiceName(service: string, context: string): void {
    if (typeof service !== 'string') {
      throw new ValidationError(`${context}: service must be a string`, {
        got: typeof service,
        expected: 'string',
        context,
      });
    }

    const trimmed = service.trim();
    if (trimmed.length === 0) {
      throw new ValidationError(`${context}: service name cannot be empty`, { context });
    }

    if (!trimmed.includes(':')) {
      throw new ValidationError(
        `${context}: service name must contain a colon separator (e.g., "service:name" or "service:name@v1")`,
        { service, expectedFormat: 'service:name[@version]', context }
      );
    }
  }

  /**
   * Validate Priority
   *
   * @param priority - Priority value
   * @param context - Calling context (for error messages)
   */
  static validatePriority(priority: number, context: string): void {
    if (typeof priority !== 'number' || isNaN(priority)) {
      throw new ValidationError(`${context}: priority must be a number`, {
        got: typeof priority,
        expected: 'number',
        context,
      });
    }

    if (priority < 0) {
      throw new ValidationError(`${context}: priority must be non-negative`, {
        priority,
        minimum: 0,
        context,
      });
    }
  }
}
