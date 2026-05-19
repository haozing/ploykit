import { describe, expect, it } from 'vitest';
import { MANAGEMENT_ITEMS } from '../system-dashboard-menus';

describe('system dashboard menus', () => {
  it('keeps RBAC detail routes under the users navigation item', () => {
    const usersItem = MANAGEMENT_ITEMS.find((item) => item.id === 'system-users');

    expect(usersItem?.href).toBe('/admin/users');
    expect(usersItem?.activeHrefs).toContain('/admin/rbac');
  });
});
