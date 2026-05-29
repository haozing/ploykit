import { InfoPage } from '@host/components/site/SitePages';
import { generatePresentedHostMetadata, renderPresentedHostPage } from '@host/lib/host-page-rendering';
import { readHostMessageValue } from '@host/lib/host-i18n';
import { readLanguageParam, type LanguageRouteParams } from '@host/lib/route-params';

interface InfoPageCopy {
  title: string;
  subtitle: string;
  body: string;
}

export default async function SuccessPage({ params }: { params: Promise<LanguageRouteParams> }) {
  const lang = await readLanguageParam(params);
  const copy = readHostMessageValue<InfoPageCopy>(lang, 'site.pages.success');
  return renderPresentedHostPage({
    pageId: 'site.success',
    defaultPage: (
      <InfoPage lang={lang} title={copy.title} subtitle={copy.subtitle}>
        <p>{copy.body}</p>
      </InfoPage>
    ),
    lang,
  });
}

export async function generateMetadata({ params }: { params: Promise<LanguageRouteParams> }) {
  const lang = await readLanguageParam(params);
  return generatePresentedHostMetadata({ pageId: 'site.success', lang });
}
