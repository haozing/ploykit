import { createPluginTranslator, type PluginRuntimeSlotProps } from '@ploykit/plugin-sdk';
import { labMarkers } from '../test-markers';

export default function HomeHeroAfter(props: PluginRuntimeSlotProps) {
  const t = createPluginTranslator(props.i18n);

  return (
    <section
      data-testid="host-lab-home-hero-after"
      data-capability-marker={labMarkers.homeAfter}
      className="rounded-md border border-cyan-200 bg-cyan-50 p-4 text-cyan-900"
    >
      <div className="text-sm font-semibold">{t('slots.homeAfterTitle')}</div>
      <p className="mt-1 text-sm">{t('slots.homeAfterBody')}</p>
    </section>
  );
}
