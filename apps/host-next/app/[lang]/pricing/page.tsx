import Link from 'next/link';
import { InfoPage } from '@host/components/site/SitePages';
import { Card } from '@host/components/ui';
import { cn } from '@host/components/ui/cn';
import { isSupportedLanguage, localizedPath } from '@host/lib/i18n';
import type { LanguageRouteParams } from '@host/lib/route-params';
import {
  getHostBillingProviderStatus,
  loadHostBillingCatalog,
} from '@host/lib/commercial-provider';
import { DEFAULT_HOST_PRODUCT_ID } from '@host/lib/default-scope';
import { getHostRuntimeStore } from '@host/lib/runtime-store';
import {
  generatePresentedHostMetadata,
  renderPresentedHostPage,
} from '@host/lib/host-page-rendering';
import { readHostMessageValue } from '@host/lib/host-i18n';
import { renderSiteModulePage, siteModuleMetadata } from '@host/lib/site-module-page';

interface PricingPageCopy {
  title: string;
  subtitle: string;
  billingProvider: string;
  checkout: string;
  plans: string;
  ready: string;
  localFallback: string;
  included: string;
  entitlements: string;
  start: string;
  providerModes: {
    local: string;
  };
  flow: {
    title: string;
    body: string;
  };
}

function formatPrice(amount: number, currency: string): string {
  const value = amount / 100;
  return `${Number.isInteger(value) ? value : value.toFixed(2)} ${currency.toUpperCase()}`;
}

function formatBillingProviderMode(mode: 'local' | 'stripe', localLabel: string): string {
  if (mode === 'stripe') {
    return 'Stripe';
  }
  return localLabel;
}

export async function generateMetadata({ params }: { params: Promise<LanguageRouteParams> }) {
  const routeParams = await params;
  if (!isSupportedLanguage(routeParams.lang)) {
    return siteModuleMetadata(`/${routeParams.lang}/pricing`);
  }

  const lang = routeParams.lang;
  return generatePresentedHostMetadata({ pageId: 'site.pricing', lang });
}

export default async function PricingPage({ params }: { params: Promise<LanguageRouteParams> }) {
  const routeParams = await params;
  if (!isSupportedLanguage(routeParams.lang)) {
    return renderSiteModulePage(`/${routeParams.lang}/pricing`);
  }

  const lang = routeParams.lang;
  const runtimeStore = await getHostRuntimeStore();
  const catalog = await loadHostBillingCatalog(runtimeStore.store, DEFAULT_HOST_PRODUCT_ID);
  const provider = getHostBillingProviderStatus();
  const copy = readHostMessageValue<PricingPageCopy>(lang, 'site.pages.pricing');
  const checkoutReady = provider.stripeConfigured && provider.priceConfigured;
  const providerLabel = formatBillingProviderMode(provider.mode, copy.providerModes.local);

  const defaultPage = (
    <InfoPage lang={lang} title={copy.title} subtitle={copy.subtitle}>
      <section className="grid gap-4 md:grid-cols-3">
        {[
          [copy.billingProvider, providerLabel],
          [copy.checkout, checkoutReady ? copy.ready : copy.localFallback],
          [copy.plans, String(catalog.plans.length)],
        ].map(([label, value], index) => (
          <Card key={label} className="rounded-[1.2rem] p-5">
            <span className="text-xs font-semibold text-admin-text-subtle">{label}</span>
            <strong
              className={cn(
                'mt-2 block text-2xl font-semibold tracking-tight',
                index === 1 && !checkoutReady ? 'text-amber-600' : 'text-admin-text'
              )}
            >
              {value}
            </strong>
          </Card>
        ))}
      </section>
      <section
        className={cn(
          'grid items-start gap-5 lg:grid-cols-2',
          catalog.skus.length > 1 ? 'xl:grid-cols-3' : 'mx-auto max-w-5xl'
        )}
      >
        {catalog.skus.map((sku, index) => (
          <Card
            key={sku.id}
            className={cn(
              'relative flex flex-col overflow-hidden rounded-[1.35rem] p-6',
              index === 0 &&
                'border-admin-primary/25 bg-[linear-gradient(135deg,var(--admin-surface),var(--admin-primary-soft))]'
            )}
          >
            <div
              className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full border border-admin-primary/15"
              aria-hidden
            />
            <div className="relative flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-admin-text">
                  {sku.name}
                </h2>
              </div>
            </div>
            <div className="relative mt-5">
              <strong className="text-4xl font-semibold tracking-tight text-admin-text">
                {formatPrice(sku.amount, sku.currency)}
              </strong>
              <span className="ml-2 text-sm font-medium text-admin-text-muted">
                / {sku.interval}
              </span>
            </div>
            <p className="relative mt-3 text-sm leading-6 text-admin-text-muted">
              {copy.included} {sku.credits} {sku.creditUnit}
            </p>
            {sku.entitlements.length ? (
              <p className="relative mt-5 text-sm leading-6 text-admin-text-muted">
                {sku.entitlements.join(' / ')}
              </p>
            ) : null}
            <Link
              href={`${localizedPath(lang, '/register')}?next=${encodeURIComponent(
                localizedPath(lang, '/dashboard/billing')
              )}`}
              className="relative mt-6 inline-flex h-11 items-center justify-center rounded-xl border border-admin-primary bg-admin-primary px-4 text-sm font-semibold !text-white shadow-[0_12px_28px_rgba(37,99,235,0.18)] transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary dark:!text-white dark:hover:bg-blue-400"
            >
              {copy.start}
            </Link>
          </Card>
        ))}
        <Card className="relative overflow-hidden rounded-[1.35rem] bg-[linear-gradient(135deg,var(--admin-surface),var(--admin-primary-soft))] p-6">
          <div
            className="pointer-events-none absolute -right-14 -top-14 h-40 w-40 rotate-45 border border-admin-primary/20"
            aria-hidden
          />
          <h2 className="relative text-2xl font-semibold tracking-tight text-admin-text">
            {copy.flow.title}
          </h2>
          <p className="relative mt-3 text-sm leading-7 text-admin-text-muted">
            {copy.flow.body}
          </p>
          <div className="relative mt-6 grid gap-3">
            {[
              [copy.billingProvider, providerLabel],
              [copy.plans, String(catalog.plans.length)],
              [
                copy.entitlements,
                catalog.skus[0]?.entitlements.length
                  ? catalog.skus[0].entitlements.join(', ')
                  : '-',
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-admin-md border border-admin-border bg-admin-surface/75 px-3 py-2"
              >
                <span className="block text-xs font-semibold text-admin-text-subtle">{label}</span>
                <strong className="mt-1 block text-sm text-admin-text">{value}</strong>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </InfoPage>
  );

  return renderPresentedHostPage({
    pageId: 'site.pricing',
    defaultPage,
    lang,
  });
}
