import { InfoPage } from '@host/components/site/SitePages';
import { Card } from '@host/components/ui';
import {
  generatePresentedHostMetadata,
  renderPresentedHostPage,
} from '@host/lib/host-page-rendering';
import { readHostMessageValue } from '@host/lib/host-i18n';
import { readLanguageParam, type LanguageRouteParams } from '@host/lib/route-params';

interface InfoPageCopy {
  title: string;
  subtitle: string;
  body: string;
  highlights: Array<{
    title: string;
    body: string;
  }>;
}

export async function generateMetadata({ params }: { params: Promise<LanguageRouteParams> }) {
  const lang = await readLanguageParam(params);
  return generatePresentedHostMetadata({ pageId: 'site.about', lang });
}

export default async function AboutPage({ params }: { params: Promise<LanguageRouteParams> }) {
  const lang = await readLanguageParam(params);
  const copy = readHostMessageValue<InfoPageCopy>(lang, 'site.pages.about');
  const defaultPage = (
    <InfoPage lang={lang} title={copy.title} subtitle={copy.subtitle}>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(320px,0.55fr)]">
        <Card className="relative overflow-hidden rounded-[1.45rem] bg-[linear-gradient(135deg,var(--admin-surface),var(--admin-primary-soft))] p-6 sm:p-8">
          <div
            className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full border border-admin-primary/20"
            aria-hidden
          />
          <p className="relative max-w-3xl text-base leading-8 text-admin-text-muted">
            {copy.body}
          </p>
        </Card>
        <div className="grid gap-4">
          {copy.highlights.map((item) => (
            <Card key={item.title} className="rounded-[1.2rem] p-5">
              <h2 className="text-base font-semibold text-admin-text">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-admin-text-muted">{item.body}</p>
            </Card>
          ))}
        </div>
      </div>
    </InfoPage>
  );
  return renderPresentedHostPage({
    pageId: 'site.about',
    defaultPage,
    lang,
  });
}
