import { SiteHomePage } from '@host/components/site/SitePages';
import { isSupportedLanguage } from '@host/lib/i18n';
import { readLanguageParam, type LanguageRouteParams } from '@host/lib/route-params';
import { generatePresentedHostMetadata, renderPresentedHostPage } from '@host/lib/host-page-rendering';
import { renderSiteModulePage, siteModuleMetadata } from '@host/lib/site-module-page';

export async function generateMetadata({
  params,
}: {
  params: Promise<LanguageRouteParams>;
}) {
  const rawParams = await params;
  if (!isSupportedLanguage(rawParams.lang)) {
    return siteModuleMetadata(`/${rawParams.lang}`);
  }

  const lang = await readLanguageParam(Promise.resolve(rawParams));
  return generatePresentedHostMetadata({ pageId: 'site.home', lang });
}

export default async function LocalizedHomePage({
  params,
}: {
  params: Promise<LanguageRouteParams>;
}) {
  const rawParams = await params;
  if (!isSupportedLanguage(rawParams.lang)) {
    return renderSiteModulePage(`/${rawParams.lang}`);
  }

  const lang = await readLanguageParam(Promise.resolve(rawParams));
  return renderPresentedHostPage({
    pageId: 'site.home',
    defaultPage: <SiteHomePage lang={lang} />,
    lang,
  });
}
