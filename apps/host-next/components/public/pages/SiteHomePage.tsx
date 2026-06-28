import {
  Activity,
  Blocks,
  Box,
  BrainCircuit,
  Database,
  FileArchive,
  GitBranch,
  Layers3,
  PanelsTopLeft,
  PlugZap,
  Rocket,
  ShieldCheck,
  Sparkles,
  Store,
  Workflow,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { Fragment } from 'react';
import { SiteShell } from '@host/components/ProductShell';
import { ButtonLink, Card } from '@host/components/ui';
import { cn } from '@host/components/ui/cn';
import { readHostMessageValue } from '@host/lib/host-i18n';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';

type Icon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

interface HomeTextItem {
  title: string;
  body: string;
}

interface SiteHomeExperienceCopy {
  hero: {
    titleLines: string[];
    subtitle: string;
    primaryCta: string;
    docsCta: string;
    githubCta: string;
    stackIntro: string;
    codeFilename: string;
  };
  trustItems: HomeTextItem[];
  stackItems: string[];
  features: {
    title: string;
    body: string;
    cards: HomeTextItem[];
  };
  capabilities: {
    title: string;
    body: string;
    cards: HomeTextItem[];
  };
  composition: {
    title: string;
    body: string;
    steps: HomeTextItem[];
  };
  buildCards: HomeTextItem[];
  final: {
    title: string;
    body: string;
    githubCta: string;
    startCta: string;
  };
}

function attachIcons<T extends HomeTextItem>(
  items: readonly T[],
  icons: readonly Icon[],
  fallback: Icon
): Array<T & { icon: Icon }> {
  return items.map((item, index) => ({
    ...item,
    icon: icons[index] ?? fallback,
  }));
}

const trustIcons: readonly Icon[] = [
  Blocks,
  ShieldCheck,
  Rocket,
  GitBranch,
];

const featureIcons: readonly Icon[] = [
  Box,
  BrainCircuit,
  Layers3,
];

const capabilityIcons: readonly Icon[] = [
  Database,
  PanelsTopLeft,
  Workflow,
  FileArchive,
  BrainCircuit,
  ShieldCheck,
];

const buildIcons: readonly Icon[] = [
  PanelsTopLeft,
  Store,
  GitBranch,
  PlugZap,
  Activity,
  Sparkles,
];

const compositionIcons: readonly Icon[] = [
  Blocks,
  ShieldCheck,
  Rocket,
];

const codeLines = [
  "import { defineModule, page, api, Permission } from '@ploykit/module-sdk';",
  '',
  'export default defineModule({',
  "  id: 'content-studio',",
  "  name: 'Content Studio',",
  "  version: '0.1.0',",
  "  permissions: [Permission.FilesWrite, Permission.SurfaceContribute],",
  '  pages: [',
  '    page({',
  "      id: 'content.home',",
  "      area: 'dashboard',",
  "      path: '/content',",
  "      component: './pages/ContentPage.tsx',",
  "      auth: 'auth',",
  '    }),',
  '  ],',
  '  apis: [',
  '    api({',
  "      id: 'content.publish',",
  "      path: '/content/publish',",
  "      handler: './api/publish',",
  "      methods: ['POST'],",
  "      auth: 'auth',",
  '    }),',
  '  ],',
  "  jobs: { publish_digest: { handler: './jobs/publish-digest' } },",
  "  events: { publishes: ['content.published'] },",
  '});',
];


const primaryCtaClassName =
  'h-10 rounded-admin-md border border-admin-primary bg-admin-primary px-4 text-[13px] font-semibold !text-white shadow-[0_10px_24px_rgba(37,99,235,0.16)] transition-colors hover:bg-blue-700 dark:!text-white dark:hover:bg-blue-400 sm:px-5';

const secondaryCtaClassName =
  'h-10 rounded-admin-md border-admin-border bg-admin-surface/90 px-4 text-[13px] font-semibold text-admin-text shadow-[0_8px_20px_rgba(15,23,42,0.055)] transition-colors hover:border-admin-primary/20 hover:bg-admin-surface-muted sm:px-5';

const githubCtaClassName =
  'inline-flex h-10 items-center justify-center gap-2 rounded-admin-md border border-admin-border bg-admin-surface/90 px-4 text-[13px] font-semibold text-admin-text shadow-[0_8px_20px_rgba(15,23,42,0.055)] transition-colors hover:border-admin-primary/20 hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary sm:px-5';

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.49c-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z"
      />
    </svg>
  );
}

function IconCard({
  icon: IconComponent,
  title,
  body,
  compact,
}: {
  icon: Icon;
  title: string;
  body: string;
  compact?: boolean;
}) {
  return (
    <Card
      className={cn(
        'group h-full transition duration-200 hover:-translate-y-0.5 hover:border-admin-primary/20 hover:shadow-[0_18px_48px_rgba(15,23,42,0.08)]',
        compact ? 'p-4' : 'p-5'
      )}
    >
      <div className="flex items-start gap-4">
        <span
          className={cn(
            'grid shrink-0 place-items-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft text-admin-primary transition duration-200 group-hover:bg-admin-primary/10',
            compact ? 'h-10 w-10' : 'h-11 w-11'
          )}
        >
          <IconComponent className={compact ? 'h-[18px] w-[18px]' : 'h-5 w-5'} aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-6 text-admin-text">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-admin-text-muted">{body}</p>
        </div>
      </div>
    </Card>
  );
}

function BuildTile({
  icon: IconComponent,
  title,
  body,
  index,
  featured,
  wide,
}: {
  icon: Icon;
  title: string;
  body: string;
  index: number;
  featured?: boolean;
  wide?: boolean;
}) {
  return (
    <Card
      className={cn(
        'group relative overflow-hidden p-4 transition duration-200 hover:border-admin-primary/25 hover:shadow-[0_18px_48px_rgba(15,23,42,0.08)]',
        wide && 'sm:col-span-2',
        featured &&
          'bg-[linear-gradient(135deg,var(--admin-surface),var(--admin-primary-soft))] sm:p-5'
      )}
    >
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-admin-primary/5 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        aria-hidden
      />
      <div className="relative flex items-start gap-4">
        <span
          className={cn(
            'flex shrink-0 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft text-admin-primary',
            featured ? 'h-12 w-12' : 'h-11 w-11'
          )}
        >
          <IconComponent className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-admin-text-subtle">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="h-px w-7 bg-admin-primary/30" aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold leading-6 text-admin-text">{title}</h3>
            <p className="mt-1 text-sm leading-6 text-admin-text-muted">{body}</p>
          </div>
        </div>
      </div>
    </Card>
  );
}

function SectionTitle({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2 className="text-3xl font-semibold tracking-tight text-admin-text sm:text-4xl">
        {title}
      </h2>
      <p className="mt-3 text-base leading-7 text-admin-text-muted">{body}</p>
    </div>
  );
}

function CodePreview({ filename }: { filename: string }) {
  return (
    <div className="relative">
      <div
        className="absolute -inset-6 rounded-admin-lg bg-admin-primary/15 blur-3xl dark:bg-admin-primary/10"
        aria-hidden
      />
      <div className="relative overflow-hidden rounded-admin-lg border border-slate-800/80 bg-[#07111f] shadow-[0_28px_80px_rgba(37,99,235,0.18)] dark:border-white/10 dark:shadow-[0_28px_80px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div className="flex gap-2">
            <span className="h-3 w-3 rounded-full bg-red-400" />
            <span className="h-3 w-3 rounded-full bg-amber-400" />
            <span className="h-3 w-3 rounded-full bg-emerald-400" />
          </div>
          <span className="text-xs font-medium text-slate-400">{filename}</span>
        </div>
        <pre className="overflow-x-auto p-4 font-mono text-[11px] leading-5 text-slate-200 sm:p-5 sm:text-[13px] sm:leading-6">
          <code>
            {codeLines.map((line, index) => (
              <span key={`${line}-${index}`} className="block">
                <span className="select-none pr-3 text-slate-600 sm:pr-4">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span>{line}</span>
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

export function SiteHomePage({ lang }: { lang: SupportedLanguage }) {
  const copy = readHostMessageValue<SiteHomeExperienceCopy>(lang, 'site.homeExperience');
  const trustItems = attachIcons(copy.trustItems, trustIcons, Blocks);
  const featureCards = attachIcons(copy.features.cards, featureIcons, Box);
  const capabilityCards = attachIcons(copy.capabilities.cards, capabilityIcons, Database);
  const buildCards = attachIcons(copy.buildCards, buildIcons, PanelsTopLeft);
  const compositionSteps = attachIcons(copy.composition.steps, compositionIcons, Blocks);

  return (
    <SiteShell lang={lang}>
      <main className="overflow-hidden">
        <section className="relative border-b border-admin-border bg-[radial-gradient(circle_at_16%_16%,rgba(37,99,235,0.14),transparent_28%),radial-gradient(circle_at_82%_12%,rgba(56,189,248,0.14),transparent_24%),linear-gradient(180deg,var(--admin-surface),var(--admin-bg))]">
          <div
            className="pointer-events-none absolute left-[-8rem] top-28 hidden h-72 w-72 rotate-45 border border-admin-primary/15 lg:block"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute right-10 top-28 hidden grid-cols-8 gap-3 opacity-35 lg:grid"
            aria-hidden
          >
            {Array.from({ length: 64 }).map((_, index) => (
              <span key={index} className="h-1 w-1 rounded-full bg-admin-primary" />
            ))}
          </div>
          <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.95fr)] lg:px-8 lg:py-20">
            <div className="relative z-10 min-w-0">
              <h1 className="max-w-4xl text-[2.45rem] font-semibold leading-[1.08] tracking-normal text-admin-text [text-wrap:balance] sm:text-6xl sm:leading-[1.04] lg:text-7xl">
                {copy.hero.titleLines.map((line, index) => (
                  <Fragment key={line + '-' + index}>
                    {index > 0 ? <br /> : null}
                    {line}
                  </Fragment>
                ))}
              </h1>
              <p className="mt-6 max-w-2xl break-words text-base leading-8 text-admin-text-muted sm:text-lg">
                {copy.hero.subtitle}
              </p>
              <div className="mt-8 flex flex-wrap gap-2.5">
                <ButtonLink href={localizedPath(lang, '/register')} className={primaryCtaClassName}>
                  {copy.hero.primaryCta}
                </ButtonLink>
                <ButtonLink
                  href={localizedPath(lang, '/docs')}
                  variant="secondary"
                  className={secondaryCtaClassName}
                >
                  {copy.hero.docsCta}
                </ButtonLink>
                <a href="https://github.com/haozing/ploykit" className={githubCtaClassName}>
                  <GitHubMark className="h-4 w-4" />
                  {copy.hero.githubCta}
                </a>
              </div>
            </div>
            <CodePreview filename={copy.hero.codeFilename} />
          </div>

          <div className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-8">
            <div className="overflow-hidden rounded-admin-lg border border-admin-border bg-admin-surface/80 shadow-admin-card backdrop-blur">
              <div className="grid divide-y divide-admin-border lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1.75fr)] lg:divide-x lg:divide-y-0">
                <div className="p-5 sm:p-6">
                  <p className="max-w-xl text-sm leading-6 text-admin-text-muted">
                    {copy.hero.stackIntro}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    {copy.stackItems.map((item) => (
                      <div
                        key={item}
                        className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-surface px-4 text-xs font-semibold text-admin-primary shadow-sm shadow-slate-950/5"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4">
                  {trustItems.map((item, index) => {
                    const IconComponent = item.icon;
                    return (
                      <div
                        key={item.title}
                        className={cn(
                          'flex flex-col items-center justify-center border-t border-admin-border p-5 text-center sm:p-6 lg:border-t-0',
                          index % 2 === 1 && 'sm:border-l sm:border-admin-border',
                          index > 0 && 'lg:border-l lg:border-admin-border'
                        )}
                      >
                        <IconComponent className="h-5 w-5 text-admin-primary" aria-hidden />
                        <h3 className="mt-4 text-sm font-semibold text-admin-text">
                          {item.title}
                        </h3>
                        <p className="mt-2 text-xs leading-5 text-admin-text-muted">
                          {item.body}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-5 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(280px,0.9fr)_repeat(3,minmax(0,1fr))] lg:items-center lg:px-8">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-admin-text">
              {copy.features.title}
            </h2>
          </div>
          {featureCards.map((item) => (
            <IconCard key={item.title} icon={item.icon} title={item.title} body={item.body} />
          ))}
        </section>

        <section className="border-y border-admin-border bg-admin-surface/55 py-14">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionTitle title={copy.capabilities.title} body={copy.capabilities.body} />
            <div className="mt-9 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {capabilityCards.map((item) => (
                <IconCard
                  key={item.title}
                  icon={item.icon}
                  title={item.title}
                  body={item.body}
                  compact
                />
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(320px,0.82fr)_minmax(0,1.18fr)] lg:items-start">
            <div className="relative overflow-hidden rounded-admin-lg border border-admin-border bg-[linear-gradient(135deg,var(--admin-surface),var(--admin-primary-soft))] p-6 shadow-admin-card sm:p-8">
              <div
                className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full border border-admin-primary/20"
                aria-hidden
              />
              <div
                className="pointer-events-none absolute bottom-0 right-8 h-28 w-px bg-admin-primary/15"
                aria-hidden
              />
              <div className="relative">
                <h2 className="text-3xl font-semibold tracking-tight text-admin-text sm:text-4xl">
                  {copy.composition.title}
                </h2>
                <p className="mt-3 text-base leading-7 text-admin-text-muted">
                  {copy.composition.body}
                </p>
                <div className="mt-8 space-y-3">
                  {compositionSteps.map((step) => {
                    const IconComponent = step.icon;
                    return (
                      <div
                        key={step.title}
                        className="flex gap-3 rounded-admin-md border border-admin-border bg-admin-surface/75 p-3 shadow-sm shadow-slate-950/5"
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-admin-sm bg-admin-primary-soft text-admin-primary">
                          <IconComponent className="h-4 w-4" aria-hidden />
                        </span>
                        <div>
                          <strong className="text-sm font-semibold text-admin-text">
                            {step.title}
                          </strong>
                          <p className="mt-0.5 text-xs leading-5 text-admin-text-muted">
                            {step.body}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {buildCards.map((item, index) => (
                <BuildTile
                  key={item.title}
                  icon={item.icon}
                  title={item.title}
                  body={item.body}
                  index={index}
                  featured={index === 0}
                  wide={index === 0 || index === buildCards.length - 1}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-admin-lg border border-admin-primary/15 bg-[radial-gradient(circle_at_14%_18%,rgba(37,99,235,0.16),transparent_28%),linear-gradient(135deg,var(--admin-surface),var(--admin-primary-soft))] p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] sm:p-8 lg:p-9">
            <div
              className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rotate-45 border border-admin-primary/20"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute right-10 top-10 hidden grid-cols-6 gap-2 opacity-30 sm:grid"
              aria-hidden
            >
              {Array.from({ length: 30 }).map((_, index) => (
                <span key={index} className="h-1 w-1 rounded-full bg-admin-primary" />
              ))}
            </div>
            <div className="relative grid gap-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div className="max-w-2xl">
                <h2 className="text-3xl font-semibold tracking-tight text-admin-text sm:text-4xl">
                  {copy.final.title}
                </h2>
                <p className="mt-3 text-sm leading-6 text-admin-text-muted sm:text-base sm:leading-7">
                  {copy.final.body}
                </p>
              </div>
              <div className="flex flex-wrap gap-2.5 lg:justify-end">
                <a href="https://github.com/haozing/ploykit" className={githubCtaClassName}>
                  <GitHubMark className="h-4 w-4" />
                  {copy.final.githubCta}
                </a>
                <ButtonLink href={localizedPath(lang, '/register')} className={primaryCtaClassName}>
                  {copy.final.startCta}
                </ButtonLink>
              </div>
            </div>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}
