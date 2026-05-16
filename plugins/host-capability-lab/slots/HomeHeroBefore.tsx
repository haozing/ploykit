import { labMessages, resolveLabLocale } from '../messages';

export default function HomeHeroBefore({ locale }: { locale?: string }) {
  const messages = labMessages[resolveLabLocale(locale)];

  return (
    <section
      data-testid="host-lab-home-hero-before"
      data-capability-marker={messages.marker.homeBefore}
      className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"
    >
      <div className="text-sm font-semibold">{messages.slots.homeBeforeTitle}</div>
      <p className="mt-1 text-sm">{messages.slots.homeBeforeBody}</p>
    </section>
  );
}
