import { createPluginTranslator, type PluginRuntimeSlotProps } from '@ploykit/plugin-sdk';
import { labMarkers } from '../test-markers';

export default function HomeHeroBefore(props: PluginRuntimeSlotProps) {
  const t = createPluginTranslator(props.i18n);

  return (
    <section
      data-testid="host-lab-home-hero-before"
      data-capability-marker={labMarkers.homeBefore}
      className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"
    >
      <div className="text-sm font-semibold">{t('slots.homeBeforeTitle')}</div>
      <p className="mt-1 text-sm">{t('slots.homeBeforeBody')}</p>
    </section>
  );
}
