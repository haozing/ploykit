import { createPluginTranslator, type PluginRuntimeSlotProps } from '@ploykit/plugin-sdk';
import { labMarkers } from '../test-markers';

export default function HomeComponentSlot(props: PluginRuntimeSlotProps) {
  const t = createPluginTranslator(props.i18n);

  return (
    <section
      data-testid="host-lab-home-component-slot"
      data-capability-marker={labMarkers.homeComponentSlot}
      className="rounded-md border border-violet-200 bg-violet-50 p-4 text-violet-900"
    >
      <div className="text-sm font-semibold">{t('components.homeSlotTitle')}</div>
      <p className="mt-1 text-sm">{t('components.homeSlotBody')}</p>
    </section>
  );
}
