import { InfoPage } from '@host/components/site/SitePages';
import { Card, Input, Textarea } from '@host/components/ui';
import {
  generatePresentedHostMetadata,
  renderPresentedHostPage,
} from '@host/lib/host-page-rendering';
import { readHostMessageValue } from '@host/lib/host-i18n';
import { readLanguageParam, type LanguageRouteParams } from '@host/lib/route-params';

interface ContactPageCopy {
  title: string;
  subtitle: string;
  received: string;
  failed: string;
  name: string;
  namePlaceholder: string;
  email: string;
  emailPlaceholder: string;
  company: string;
  optional: string;
  message: string;
  messagePlaceholder: string;
  submit: string;
  aside: {
    title: string;
    body: string;
    topics: string[];
  };
}

export async function generateMetadata({ params }: { params: Promise<LanguageRouteParams> }) {
  const lang = await readLanguageParam(params);
  return generatePresentedHostMetadata({ pageId: 'site.contact', lang });
}

export default async function ContactPage({
  params,
  searchParams,
}: {
  params: Promise<LanguageRouteParams>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const lang = await readLanguageParam(params);
  const query = searchParams ? await searchParams : {};
  const contactState = Array.isArray(query.contact) ? query.contact[0] : query.contact;
  const copy = readHostMessageValue<ContactPageCopy>(lang, 'site.pages.contact');

  const defaultPage = (
    <InfoPage lang={lang} title={copy.title} subtitle={copy.subtitle}>
      {contactState === 'received' ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-700">
          {copy.received}
        </p>
      ) : null}
      {contactState === 'failed' ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
          {copy.failed}
        </p>
      ) : null}
      <form action="/api/contact" method="post">
        <input type="hidden" name="lang" value={lang} />
        <div className="grid gap-6 lg:grid-cols-[minmax(280px,0.45fr)_minmax(0,0.9fr)]">
          <Card className="relative overflow-hidden rounded-[1.35rem] bg-[linear-gradient(135deg,var(--admin-surface),var(--admin-primary-soft))] p-6">
            <div
              className="pointer-events-none absolute -right-14 -top-14 h-40 w-40 rotate-45 border border-admin-primary/20"
              aria-hidden
            />
            <h2 className="text-2xl font-semibold tracking-tight text-admin-text">
              {copy.aside.title}
            </h2>
            <p className="mt-3 text-sm leading-7 text-admin-text-muted">
              {copy.aside.body}
            </p>
            <div className="mt-6 grid gap-3">
              {copy.aside.topics.map((item) => (
                <div
                  key={item}
                  className="rounded-admin-md border border-admin-border bg-admin-surface/75 px-3 py-2 text-xs font-semibold text-admin-text-muted"
                >
                  {item}
                </div>
              ))}
            </div>
          </Card>
          <Card className="grid gap-5 rounded-[1.35rem] p-6">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium text-admin-text">
                <span>{copy.name}</span>
                <Input name="name" required maxLength={120} placeholder={copy.namePlaceholder} />
              </label>
              <label className="grid gap-2 text-sm font-medium text-admin-text">
                <span>{copy.email}</span>
                <Input
                  name="email"
                  type="email"
                  required
                  maxLength={200}
                  placeholder={copy.emailPlaceholder}
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-admin-text md:col-span-2">
                <span>{copy.company}</span>
                <Input name="company" maxLength={160} placeholder={copy.optional} />
              </label>
            </div>
            <label className="grid gap-2 text-sm font-medium text-admin-text">
              <span>{copy.message}</span>
              <Textarea
                name="message"
                required
                rows={6}
                maxLength={2000}
                placeholder={copy.messagePlaceholder}
              />
            </label>
            <button
              type="submit"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-admin-primary bg-admin-primary px-4 text-sm font-semibold !text-white shadow-[0_12px_28px_rgba(37,99,235,0.18)] transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50 dark:!text-white dark:hover:bg-blue-400"
            >
              {copy.submit}
            </button>
          </Card>
        </div>
      </form>
    </InfoPage>
  );

  return renderPresentedHostPage({
    pageId: 'site.contact',
    defaultPage,
    componentProps: {
      contactState,
      lang,
    },
    lang,
  });
}
