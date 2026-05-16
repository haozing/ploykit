import type { PluginRuntimePageProps } from '@ploykit/plugin-sdk';
import StorageProbeClient from '../components/StorageProbeClient';
import { labMessages, resolveLabLocale } from '../messages';

export default function LabPage(props: PluginRuntimePageProps) {
  const messages = labMessages[resolveLabLocale(props.locale)];

  return (
    <div className="mx-auto w-full max-w-5xl py-12">
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">
          {messages.labPage.eyebrow}
        </p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950 md:text-4xl">
          {messages.labPage.title}
        </h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-slate-700">
          {messages.labPage.body}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase text-slate-500">
            {messages.labPage.cards.routeLabel}
          </div>
          <div className="mt-2 text-sm font-medium text-slate-950">{props.requestPath}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase text-slate-500">
            {messages.labPage.cards.shellLabel}
          </div>
          <div className="mt-2 text-sm font-medium text-slate-950">
            {messages.labPage.cards.shellValue}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase text-slate-500">
            {messages.labPage.cards.storageLabel}
          </div>
          <div className="mt-2 text-sm font-medium text-slate-950">
            {messages.labPage.cards.storageValue}
          </div>
        </div>
      </div>

      <StorageProbeClient locale={props.locale} />
    </div>
  );
}
