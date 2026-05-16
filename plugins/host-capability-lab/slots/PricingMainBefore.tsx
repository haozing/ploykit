import { createPluginTranslator, type PluginRuntimeSlotProps } from '@ploykit/plugin-sdk';
import { labMarkers } from '../test-markers';

export default function PricingMainBefore(props: PluginRuntimeSlotProps) {
  const t = createPluginTranslator(props.i18n);

  return (
    <section
      data-testid="host-lab-pricing-main-before"
      data-capability-marker={labMarkers.pricingBefore}
      className="rounded-md border border-violet-200 bg-violet-50 p-4 text-violet-900"
    >
      <div className="text-sm font-semibold">{t('slots.pricingBeforeTitle')}</div>
      <p className="mt-1 text-sm">{t('slots.pricingBeforeBody')}</p>
    </section>
  );
}
