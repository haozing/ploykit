import type { ReactNode } from 'react';

export type NavIconKey =
  | 'activity'
  | 'badgeDollarSign'
  | 'barChart3'
  | 'cable'
  | 'circleDollarSign'
  | 'creditCard'
  | 'fileText'
  | 'folderOpen'
  | 'gauge'
  | 'layoutDashboard'
  | 'package'
  | 'search'
  | 'settings'
  | 'shieldCheck'
  | 'squareTerminal'
  | 'users';

export interface NavItem {
  href: string;
  label: string;
  detail?: string;
  badge?: string;
  icon?: NavIconKey;
  localized?: boolean;
}

export interface NavGroup {
  id: string;
  label: string;
  items: readonly NavItem[];
}

export interface HeaderUser {
  name: string;
  email?: string;
}

export interface HeaderScope {
  label: string;
  detail?: string;
  searchHref?: string;
}

export interface PageShellAction {
  key: string;
  node: ReactNode;
}
