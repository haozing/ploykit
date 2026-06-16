import { Fragment, isValidElement, type ReactNode } from 'react';
import { ModuleValue } from '@host/components/ModuleValue';
import { HostPageRenderer } from '@host/components/layout/HostPageRenderer';
import { HostPageSlot } from '@host/components/layout/HostPageSlot';
import { ProductThemeStyle } from '@host/components/theme/ProductThemeStyle';
import {
  resolveHostPageComposition,
  type HostPageCompositionPlan,
} from '@/lib/module-runtime/ui/host-page-composition';
import { getHostPageSlotSurfaceId } from '@/lib/module-runtime/ui/host-page-registry';
import { renderModuleSurface } from '@/lib/module-runtime/ui/surface-renderer';
import type { ModuleRuntimeAccessSession } from '@/lib/module-runtime/security/session';
import { createHostRequest } from './paths';
import { getModuleHost } from './module-host';
import { getProductComposition } from './product-composition';
import {
  resolvePagePresentation,
  type ResolvedPagePresentation,
} from './presentation/page-presentation';
import { presentHostRoute } from './presentation/route-presentation-manifest';
import { callModuleComponent } from './rendering';
import type { SupportedLanguage } from './i18n';
import {
  createAnonymousModuleHostSession,
  type ModuleHostSession,
} from '@/lib/module-runtime/host/session';

interface HostPageOverrideRenderResult {
  resolved: boolean;
  page?: ReactNode;
}

export async function renderHostPage({
  pageId,
  pathname,
  defaultPage,
  componentProps,
  lang,
  workspaceId,
  session,
}: {
  pageId: string;
  pathname: string;
  defaultPage: ReactNode;
  componentProps?: Record<string, unknown>;
  lang?: SupportedLanguage;
  workspaceId?: string | null;
  session?: ModuleHostSession;
}) {
  const presentation = await resolvePagePresentation({
    pageId,
    pathname,
    lang: lang ?? 'zh',
    workspaceId,
    session,
  });
  const pageComponentProps = {
    lang: presentation.language,
    pagePresentation: presentation,
    ...(componentProps ?? {}),
  };
  const renderSession = session ?? createAnonymousModuleHostSession();
  const [overridePage, slots] = await Promise.all([
    presentation.renderer === 'module'
      ? renderActiveHostPageOverride(presentation, pathname, pageComponentProps, renderSession)
      : Promise.resolve<HostPageOverrideRenderResult>({ resolved: false }),
    renderHostPageSlots(presentation.plan, pathname, pageComponentProps, renderSession),
  ]);

  return (
    <>
      {presentation.theme.workspace ? (
        <ProductThemeStyle
          id={`ploykit-page-theme-${presentation.pageId}`}
          theme={presentation.theme}
        />
      ) : null}
      <HostPageSlot slotId="hero">{slots.hero}</HostPageSlot>
      <HostPageSlot slotId="main.before">{slots['main.before']}</HostPageSlot>
      <HostPageRenderer
        plan={presentation.plan}
        defaultPage={defaultPage}
        overridePage={overridePage.page}
        overrideResolved={overridePage.resolved}
      />
      <HostPageSlot slotId="main.after">{slots['main.after']}</HostPageSlot>
      <HostPageSlot slotId="footer.before">{slots['footer.before']}</HostPageSlot>
    </>
  );
}

export async function renderPresentedHostPage({
  pageId,
  defaultPage,
  componentProps,
  lang,
  session,
  workspaceId,
  pathname,
}: {
  pageId: string;
  defaultPage: ReactNode;
  componentProps?: Record<string, unknown>;
  lang: SupportedLanguage;
  session?: ModuleHostSession;
  workspaceId?: string | null;
  pathname?: string;
}) {
  const route = await presentHostRoute({
    pageId,
    lang,
    session,
    workspaceId,
    pathname,
  });
  return renderHostPage({
    pageId,
    pathname: route.context.requestPath,
    defaultPage,
    componentProps: {
      routePresentation: route.manifest,
      requestContext: route.context,
      ...(componentProps ?? {}),
    },
    lang,
    workspaceId: workspaceId ?? route.context.workspaceId,
    session: route.context.session,
  });
}

export async function generatePresentedHostMetadata(input: {
  pageId: string;
  lang: SupportedLanguage;
  workspaceId?: string | null;
  pathname?: string;
}) {
  const route = await presentHostRoute({
    ...input,
    requireSession: false,
  });
  return route.metadata;
}

export async function renderHostPageSlotById({
  pageId,
  slotId,
  pathname,
  session,
  componentProps,
}: {
  pageId: string;
  slotId: string;
  pathname: string;
  session?: ModuleRuntimeAccessSession;
  componentProps?: Record<string, unknown>;
}) {
  const host = await getModuleHost();
  const renderSession = session ?? createAnonymousModuleHostSession();
  const plan = resolveHostPageComposition(host.runtime, {
    pageId,
    composition: getProductComposition(),
    session: renderSession,
  });
  return renderHostPageSlot(
    plan,
    slotId,
    pathname,
    componentProps ?? {},
    renderSession
  );
}

async function renderActiveHostPageOverride(
  presentation: ResolvedPagePresentation,
  pathname: string,
  componentProps: Record<string, unknown> = {},
  session: ModuleRuntimeAccessSession
): Promise<HostPageOverrideRenderResult> {
  const plan = presentation.plan;
  if (!plan.activeOverride) {
    return { resolved: false };
  }

  let surface: Awaited<ReturnType<typeof renderModuleSurface>>;
  try {
    const host = await getModuleHost();
    surface = await renderModuleSurface(host.runtime, {
      request: createHostRequest(pathname),
      surfaceId: plan.page.surfaceId,
      contributions: [plan.activeOverride],
      session,
      loaderDataByModuleId: new Map([[plan.activeOverride.moduleId, presentation.metadata]]),
      renderComponent({ component, loaderData }) {
        return callModuleComponent(component, {
          ...componentProps,
          loaderData,
          pageId: plan.page.id,
          pathname,
        });
      },
    });
  } catch {
    return { resolved: false };
  }

  const selected = surface.replace.find((item) => item.moduleId === plan.activeOverride?.moduleId);
  if (!selected) {
    return { resolved: false };
  }

  return {
    resolved: true,
    page: normalizeModuleRenderOutput(selected.rendered),
  };
}

async function renderHostPageSlots(
  plan: HostPageCompositionPlan,
  pathname: string,
  componentProps: Record<string, unknown>,
  session: ModuleRuntimeAccessSession
): Promise<Record<string, ReactNode[]>> {
  const slots: Record<string, ReactNode[]> = {};
  await Promise.all(
    Object.keys(plan.slots).map(async (slotId) => {
      const rendered = await renderHostPageSlot(plan, slotId, pathname, componentProps, session);
      if (rendered.length > 0) {
        slots[slotId] = rendered;
      }
    })
  );
  return slots;
}

async function renderHostPageSlot(
  plan: HostPageCompositionPlan,
  slotId: string,
  pathname: string,
  componentProps: Record<string, unknown>,
  session: ModuleRuntimeAccessSession
): Promise<ReactNode[]> {
  let surface: Awaited<ReturnType<typeof renderModuleSurface>>;
  try {
    const host = await getModuleHost();
    surface = await renderModuleSurface(host.runtime, {
      request: createHostRequest(pathname),
      surfaceId: getHostPageSlotSurfaceId(plan.page.id, slotId),
      contributions: plan.slots[slotId] ?? [],
      session,
      isolateErrors: true,
      renderComponent({ component, loaderData, contribution }) {
        return callModuleComponent(component, {
          ...componentProps,
          loaderData,
          pageId: plan.page.id,
          pathname,
          slotId,
          moduleId: contribution.moduleId,
        });
      },
    });
  } catch {
    return [];
  }

  return surface.all
    .filter((item) => item.mode !== 'replace')
    .map((item, index) => (
      <Fragment key={`${item.moduleId}:${item.surfaceId}:${item.mode}:${index}`}>
        {normalizeModuleRenderOutput(item.rendered)}
      </Fragment>
    ));
}

function normalizeModuleRenderOutput(output: unknown): ReactNode {
  if (
    output === null ||
    output === undefined ||
    typeof output === 'string' ||
    typeof output === 'number' ||
    typeof output === 'boolean' ||
    isValidElement(output)
  ) {
    return output;
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <ModuleValue value={output} />
    </main>
  );
}
