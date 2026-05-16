import { createPluginTranslator, type PluginRuntimeSlotProps } from '@ploykit/plugin-sdk';
import { labMarkers } from '../test-markers';

export default function PricingMainAfter(props: PluginRuntimeSlotProps) {
  const t = createPluginTranslator(props.i18n);

  return (
    <section
      data-testid="host-lab-pricing-main-after"
      data-capability-marker={labMarkers.pricingAfter}
      className="rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900"
    >
      <div className="text-sm font-semibold">{t('slots.pricingAfterTitle')}</div>
      <p className="mt-1 text-sm">{t('slots.pricingAfterBody')}</p>
    </section>
  );
}
