import { InfoPage } from '@host/components/site/SitePages';
import { Card } from '@host/components/ui';
import {
  generatePresentedHostMetadata,
  renderPresentedHostPage,
} from '@host/lib/host-page-rendering';
import { readHostMessageValue } from '@host/lib/host-i18n';
import { isSupportedLanguage } from '@host/lib/i18n';
import { renderSiteModulePage, siteModuleMetadata } from '@host/lib/site-module-page';
import type { LanguageRouteParams } from '@host/lib/route-params';

interface DocsPageCopy {
  title: string;
  subtitle: string;
  cards: Array<[string, string]>;
  start: {
    title: string;
    body: string;
  };
}

export async function generateMetadata({ params }: { params: Promise<LanguageRouteParams> }) {
  const routeParams = await params;
  if (!isSupportedLanguage(routeParams.lang)) {
    return siteModuleMetadata(`/${routeParams.lang}/docs`);
  }

  const lang = routeParams.lang;
  return generatePresentedHostMetadata({ pageId: 'site.docs', lang });
}

export default async function DocsPage({ params }: { params: Promise<LanguageRouteParams> }) {
  const routeParams = await params;
  if (!isSupportedLanguage(routeParams.lang)) {
    return renderSiteModulePage(`/${routeParams.lang}/docs`);
  }

  const lang = routeParams.lang;
  const copy = readHostMessageValue<DocsPageCopy>(lang, 'site.pages.docs');
  const defaultPage = (
    <InfoPage lang={lang} title={copy.title} subtitle={copy.subtitle}>
      <div className="grid gap-6 lg:grid-cols-[minmax(300px,0.55fr)_minmax(0,1fr)]">
        <Card className="relative overflow-hidden rounded-[1.45rem] bg-[linear-gradient(135deg,var(--admin-surface),var(--admin-primary-soft))] p-6 sm:p-8">
          <div
            className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rotate-45 border border-admin-primary/20"
            aria-hidden
          />
          <h2 className="text-2xl font-semibold tracking-tight text-admin-text">
            {copy.start.title}
          </h2>
          <p className="mt-3 text-sm leading-7 text-admin-text-muted">
            {copy.start.body}
          </p>
        </Card>
        <div className="grid gap-4 md:grid-cols-2">
          {copy.cards.map(([title, description], index) => (
            <Card
              key={title}
              className="group rounded-[1.2rem] p-5 transition duration-200 hover:border-admin-primary/25 hover:shadow-[0_18px_48px_rgba(15,23,42,0.08)]"
            >
              <div className="mb-3 flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-admin-text-subtle">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="h-px w-8 bg-admin-primary/30" aria-hidden />
              </div>
              <h2 className="text-base font-semibold text-admin-text">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-admin-text-muted">{description}</p>
            </Card>
          ))}
        </div>
      </div>
    </InfoPage>
  );

  return renderPresentedHostPage({
    pageId: 'site.docs',
    defaultPage,
    lang,
  });
}
