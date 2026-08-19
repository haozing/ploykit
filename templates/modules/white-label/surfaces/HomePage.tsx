import { localizedHref, templateCopy } from '../locales';

export default function HomePage(props?: { lang?: string }) {
  const copy = templateCopy(props?.lang).pages.home;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <p className="text-sm font-semibold uppercase text-primary">{copy.eyebrow}</p>
      <h1 className="mt-3 text-4xl font-semibold text-foreground">{copy.title}</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">{copy.description}</p>
      <a
        className="mt-6 inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground"
        href={localizedHref(props?.lang, '/register')}
      >
        {copy.primaryAction}
      </a>
    </main>
  );
}
