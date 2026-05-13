import { describe, expect, it } from 'vitest';
import {
  getPermissionDescription,
  normalizePermissionIdentifier,
  parsePermission,
  permissionMatches,
  validatePermission,
} from '../permission-service';

describe('permission service helpers', () => {
  it('keeps canonical permission identifiers unchanged', () => {
    expect(normalizePermissionIdentifier('admin:access:all')).toBe('admin:access:all');
    expect(normalizePermissionIdentifier('profile:view:self')).toBe('profile:view:self');
    expect(normalizePermissionIdentifier('admin:*:*')).toBe('admin:*:*');
  });

  it('parses only canonical three-part permission identifiers', () => {
    expect(parsePermission('admin:access:all')).toEqual({
      resource: 'admin',
      action: 'access',
      scope: 'all',
    });
    expect(validatePermission('profile:view:self')).toBe(true);
    expect(validatePermission('profile:view')).toBe(false);
  });

  it('matches canonical wildcard permissions', () => {
    expect(permissionMatches('admin:*:*', 'admin:access:all')).toBe(true);
    expect(permissionMatches('user:*:*', 'admin:access:all')).toBe(false);
    expect(permissionMatches('admin:*', 'admin:access:all')).toBe(false);
  });

  it('returns descriptions for canonical permissions', () => {
    expect(getPermissionDescription('admin:access:all')).toBe('Access the admin console');
  });
});
