import { labMessages, resolveLabLocale } from '../messages';

export default function PricingMainBefore({ locale }: { locale?: string }) {
  const messages = labMessages[resolveLabLocale(locale)];

  return (
    <section
      data-testid="host-lab-pricing-main-before"
      data-capability-marker={messages.marker.pricingBefore}
      className="rounded-md border border-violet-200 bg-violet-50 p-4 text-violet-900"
    >
      <div className="text-sm font-semibold">{messages.slots.pricingBeforeTitle}</div>
      <p className="mt-1 text-sm">{messages.slots.pricingBeforeBody}</p>
    </section>
  );
}
