import type { NavGroup, NavItem } from './types';

export function isActivePath(pathname: string, href: string): boolean {
  if (href === '/') {
    return pathname === '/';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function groupNavItems(items: readonly NavItem[], groupId = 'default'): readonly NavGroup[] {
  return [
    {
      id: groupId,
      label: 'Navigation',
      items,
    },
  ];
}
