import { createPluginTranslator, type PluginRuntimePageProps } from '@ploykit/plugin-sdk';
import { labMarkers } from '../test-markers';

export default function AboutOverride(props: PluginRuntimePageProps) {
  const t = createPluginTranslator(props.i18n);

  return (
    <article data-testid="host-lab-about-override" className="mx-auto max-w-5xl py-10">
      <div
        data-capability-marker={labMarkers.override}
        className="rounded-md border border-sky-200 bg-sky-50 p-4 text-sm font-medium text-sky-900"
      >
        {t('about.seoI18nValue')}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1.25fr_0.75fr]">
        <section>
          <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">
            {t('about.eyebrow')}
          </p>
          <h1 className="mt-2 text-4xl font-bold text-slate-950 md:text-5xl">{t('about.title')}</h1>
          <p className="mt-5 text-lg leading-8 text-slate-700">{t('about.body')}</p>
        </section>

        <aside className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase text-slate-500">{t('about.evidence')}</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-slate-500">{t('about.plugin')}</dt>
              <dd className="font-medium text-slate-950">{props.pluginId}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t('about.overridePath')}</dt>
              <dd className="font-medium text-slate-950">{props.requestPath}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t('about.shellContract')}</dt>
              <dd className="font-medium text-slate-950">{t('about.shellValue')}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t('about.seoI18n')}</dt>
              <dd className="font-medium text-slate-950">{t('about.seoI18nValue')}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </article>
  );
}
