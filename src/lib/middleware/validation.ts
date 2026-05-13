/**
 * Input Validation Middleware
 *
 * Provides Zod-based validation for API request inputs
 * Supports body, query parameters, and URL parameters validation
 */

import { NextRequest } from 'next/server';
import { ZodSchema, ZodError } from 'zod';
import type { ApiHandler, DefaultRouteContext } from './api-error-handler';
import { ValidationError } from '@/lib/_core/errors';

/**
 * Validated data context
 */
export interface ValidationContext<TBody = unknown, TQuery = unknown, TParams = unknown> {
  body?: TBody;
  query?: TQuery;
  params?: TParams;
}

/**
 * Validation schemas configuration
 */
export interface ValidationSchemas<TBody = unknown, TQuery = unknown, TParams = unknown> {
  body?: ZodSchema<TBody>;
  query?: ZodSchema<TQuery>;
  params?: ZodSchema<TParams>;
}

/**
 * API handler with validated data
 */
export type ValidatedApiHandler<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
  TContext = DefaultRouteContext,
> = (
  request: NextRequest,
  context: TContext & { validated: ValidationContext<TBody, TQuery, TParams> }
) => Promise<Response>;

/**
 * Body validation middleware
 *
 * Validates request body against a Zod schema
 *
 * @param schema - Zod schema for body validation
 * @param handler - API handler to wrap
 * @returns Wrapped handler with validated body
 *
 * @example
 * ```typescript
 * const createOrgSchema = z.object({
 *   name: z.string().min(1).max(100),
 *   slug: z.string().regex(/^[a-z0-9-]+$/),
 *   ownerId: z.string().uuid(),
 * });
 *
 * export const POST = withBodyValidation(
 *   createOrgSchema,
 *   async (request, { validated }) => {
 *     // validated.body is typed and validated
 *     const { name, slug, ownerId } = validated.body;
 *     return NextResponse.json({ success: true });
 *   }
 * );
 * ```
 */
export function withBodyValidation<TBody, TContext = DefaultRouteContext>(
  schema: ZodSchema<TBody>,
  handler: ValidatedApiHandler<TBody, never, never, TContext>
): ApiHandler<TContext> {
  return async (request: NextRequest, context: TContext) => {
    try {
      // Parse and validate body
      const rawBody = await request.json();
      const validatedBody = schema.parse(rawBody);

      // Call handler with validated data
      return handler(request, {
        ...context,
        validated: { body: validatedBody },
      });
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationError('Invalid request body', {
          errors: error.errors.map((error) => ({
            path: error.path.join('.'),
            message: error.message,
            code: error.code,
          })),
        });
      }
      throw error;
    }
  };
}

/**
 * Query parameters validation middleware
 *
 * Validates URL query parameters against a Zod schema
 *
 * @param schema - Zod schema for query validation
 * @param handler - API handler to wrap
 * @returns Wrapped handler with validated query
 *
 * @example
 * ```typescript
 * const listFiltersSchema = z.object({
 *   search: z.string().optional(),
 *   status: z.enum(['active', 'suspended', 'deleted']).optional(),
 *   page: z.coerce.number().int().positive().default(1),
 *   limit: z.coerce.number().int().positive().max(100).default(20),
 * });
 *
 * export const GET = withQueryValidation(
 *   listFiltersSchema,
 *   async (request, { validated }) => {
 *     const { search, status, page, limit } = validated.query;
 *     return NextResponse.json({ page, limit });
 *   }
 * );
 * ```
 */
export function withQueryValidation<TQuery, TContext = DefaultRouteContext>(
  schema: ZodSchema<TQuery>,
  handler: ValidatedApiHandler<never, TQuery, never, TContext>
): ApiHandler<TContext> {
  return async (request: NextRequest, context: TContext) => {
    try {
      // Extract query parameters
      const searchParams = request.nextUrl.searchParams;
      const queryObject = Object.fromEntries(searchParams.entries());

      // Validate query parameters
      const validatedQuery = schema.parse(queryObject);

      // Call handler with validated data
      return handler(request, {
        ...context,
        validated: { query: validatedQuery },
      });
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationError('Invalid query parameters', {
          errors: error.errors.map((error) => ({
            path: error.path.join('.'),
            message: error.message,
            code: error.code,
          })),
        });
      }
      throw error;
    }
  };
}

/**
 * URL parameters validation middleware
 *
 * Validates URL path parameters against a Zod schema
 *
 * @param schema - Zod schema for params validation
 * @param handler - API handler to wrap
 * @returns Wrapped handler with validated params
 *
 * @example
 * ```typescript
 * const paramsSchema = z.object({
 *   id: z.string().uuid(),
 *   userId: z.string().uuid(),
 * });
 *
 * export const GET = withParamsValidation(
 *   paramsSchema,
 *   async (request, { validated }) => {
 *     const { id, userId } = validated.params;
 *     return NextResponse.json({ id, userId });
 *   }
 * );
 * ```
 */
export function withParamsValidation<TParams, TContext extends object = DefaultRouteContext>(
  schema: ZodSchema<TParams>,
  handler: ValidatedApiHandler<never, never, TParams, TContext>
): ApiHandler<TContext> {
  return async (request: NextRequest, context: TContext) => {
    try {
      // Get params from context (Next.js 15 async params)
      const params =
        'params' in context && context.params instanceof Promise
          ? await context.params
          : // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (context as any).params || {};

      // Validate params
      const validatedParams = schema.parse(params);

      // Call handler with validated data
      return handler(request, {
        ...context,
        validated: { params: validatedParams },
      });
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationError('Invalid URL parameters', {
          errors: error.errors.map((error) => ({
            path: error.path.join('.'),
            message: error.message,
            code: error.code,
          })),
        });
      }
      throw error;
    }
  };
}

/**
 * Combined validation middleware
 *
 * Validates body, query, and params in a single middleware
 *
 * @param schemas - Validation schemas for each input type
 * @param handler - API handler to wrap
 * @returns Wrapped handler with all validated data
 *
 * @example
 * ```typescript
 * export const POST = withValidation(
 *   {
 *     body: createUserSchema,
 *     query: z.object({ notify: z.boolean().optional() }),
 *     params: z.object({ userId: z.string().uuid() }),
 *   },
 *   async (request, { validated }) => {
 *     const { body, query, params } = validated;
 *     return NextResponse.json({ success: true });
 *   }
 * );
 * ```
 */
export function withValidation<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
  TContext extends object = DefaultRouteContext,
>(
  schemas: ValidationSchemas<TBody, TQuery, TParams>,
  handler: ValidatedApiHandler<TBody, TQuery, TParams, TContext>
): ApiHandler<TContext> {
  return async (request: NextRequest, context: TContext) => {
    const validated: ValidationContext<TBody, TQuery, TParams> = {};

    try {
      // Validate body if schema provided
      if (schemas.body) {
        const rawBody = await request.json();
        validated.body = schemas.body.parse(rawBody);
      }

      // Validate query if schema provided
      if (schemas.query) {
        const searchParams = request.nextUrl.searchParams;
        const queryObject = Object.fromEntries(searchParams.entries());
        validated.query = schemas.query.parse(queryObject);
      }

      // Validate params if schema provided
      if (schemas.params) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const contextWithParams = context as any;
        const params =
          'params' in context && contextWithParams.params instanceof Promise
            ? await contextWithParams.params
            : contextWithParams.params || {};
        validated.params = schemas.params.parse(params);
      }

      // Call handler with validated data
      return handler(request, {
        ...context,
        validated,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationError('Validation failed', {
          errors: error.errors.map((error) => ({
            path: error.path.join('.'),
            message: error.message,
            code: error.code,
          })),
        });
      }
      throw error;
    }
  };
}
