import { labMessages, resolveLabLocale } from '../messages';

export default function PricingMainAfter({ locale }: { locale?: string }) {
  const messages = labMessages[resolveLabLocale(locale)];

  return (
    <section
      data-testid="host-lab-pricing-main-after"
      data-capability-marker={messages.marker.pricingAfter}
      className="rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900"
    >
      <div className="text-sm font-semibold">{messages.slots.pricingAfterTitle}</div>
      <p className="mt-1 text-sm">{messages.slots.pricingAfterBody}</p>
    </section>
  );
}
