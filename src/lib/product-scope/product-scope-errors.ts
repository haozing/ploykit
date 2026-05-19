import { AppError } from '@/lib/_core/errors';

export class ProductScopeError extends AppError {
  constructor(
    code: string,
    message: string,
    statusCode: number,
    details?: Record<string, unknown>
  ) {
    super(message, code, statusCode, details);
    this.name = 'ProductScopeError';
  }
}

export function productScopeRequired(details?: Record<string, unknown>): ProductScopeError {
  return new ProductScopeError(
    'PRODUCT_SCOPE_REQUIRED',
    'A product scope must be selected before continuing.',
    409,
    details
  );
}

export function productScopeForbidden(details?: Record<string, unknown>): ProductScopeError {
  return new ProductScopeError(
    'PRODUCT_SCOPE_FORBIDDEN',
    'The current user cannot access this product scope.',
    403,
    details
  );
}

export function productScopeNotFound(details?: Record<string, unknown>): ProductScopeError {
  return new ProductScopeError(
    'PRODUCT_SCOPE_NOT_FOUND',
    'The requested product scope does not exist.',
    404,
    details
  );
}

export function productScopeCreateDisabled(details?: Record<string, unknown>): ProductScopeError {
  return new ProductScopeError(
    'PRODUCT_SCOPE_CREATE_DISABLED',
    'Creating product scopes is disabled for this product.',
    403,
    details
  );
}

export function productScopeSwitchDisabled(details?: Record<string, unknown>): ProductScopeError {
  return new ProductScopeError(
    'PRODUCT_SCOPE_SWITCH_DISABLED',
    'Switching product scopes is disabled for this product.',
    403,
    details
  );
}

export function productScopeMembersDisabled(details?: Record<string, unknown>): ProductScopeError {
  return new ProductScopeError(
    'PRODUCT_SCOPE_MEMBERS_DISABLED',
    'Managing product scope members is disabled for this product.',
    403,
    details
  );
}

export function productScopeRoleRequired(details?: Record<string, unknown>): ProductScopeError {
  return new ProductScopeError(
    'PRODUCT_SCOPE_ROLE_REQUIRED',
    'The current product scope role is not allowed for this action.',
    403,
    details
  );
}
