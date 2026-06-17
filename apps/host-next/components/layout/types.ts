import type { ReactNode } from 'react';
import type { ModuleIconKey } from '@/lib/generated/module-icons';

export type NavIconKey = ModuleIconKey;

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
