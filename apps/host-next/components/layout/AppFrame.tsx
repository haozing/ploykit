import type { ReactNode } from 'react';
import { Header } from './Header';
import { MobileNav } from './MobileNav';
import { Sidebar } from './Sidebar';
import { ClientTransitionLinks } from './ClientTransitionLinks';
import type { HeaderScope, HeaderUser, NavGroup } from './types';
import { type SupportedLanguage } from '@host/lib/i18n';
import { readHostMessageValue } from '@host/lib/host-i18n';

export interface AppFrameLabels {
  brandName: string;
  consoleLabel: string;
  platformLabel: string;
  platformFullName: string;
  version: string;
  navigation: string;
  areaNavigation: {
    admin: string;
    dashboard: string;
  };
  mobileNavigation: string;
  closeNavigation: string;
  menu: string;
  overview: string;
}

export function AppFrame({
  area,
  lang,
  navGroups,
  children,
  activePath,
  scope,
  user,
}: {
  area: 'admin' | 'dashboard';
  lang: SupportedLanguage;
  navGroups: readonly NavGroup[];
  children: ReactNode;
  activePath?: string;
  scope?: HeaderScope;
  user?: HeaderUser;
}) {
  const labels = readHostMessageValue<AppFrameLabels>(lang, 'shell.layout');

  return (
    <div className="min-h-screen bg-admin-bg text-admin-text" data-host-app-frame={area}>
      <ClientTransitionLinks area={area} />
      <div className="flex min-h-screen">
        <Sidebar
          area={area}
          lang={lang}
          groups={navGroups}
          activePath={activePath}
          label={labels.areaNavigation[area]}
          labels={labels}
        />
        <div className="min-w-0 flex-1">
          <Header lang={lang} area={area} scope={scope} user={user} />
          <MobileNav
            area={area}
            lang={lang}
            groups={navGroups}
            activePath={activePath}
            labels={labels}
          />
          {children}
        </div>
      </div>
    </div>
  );
}
