import { labMessages, resolveLabLocale } from '../messages';

export default function HomeHeroAfter({ locale }: { locale?: string }) {
  const messages = labMessages[resolveLabLocale(locale)];

  return (
    <section
      data-testid="host-lab-home-hero-after"
      data-capability-marker={messages.marker.homeAfter}
      className="rounded-md border border-cyan-200 bg-cyan-50 p-4 text-cyan-900"
    >
      <div className="text-sm font-semibold">{messages.slots.homeAfterTitle}</div>
      <p className="mt-1 text-sm">{messages.slots.homeAfterBody}</p>
    </section>
  );
}
