import type {
  ProductCompositionView,
  ProductThemeDiagnosticsView,
} from '@host/lib/product-composition';

function joinList(values: readonly string[], fallback = 'none') {
  return values.length > 0 ? values.join(', ') : fallback;
}

export function HostPagesPanel({
  composition,
  theme,
}: {
  composition: ProductCompositionView;
  theme: ProductThemeDiagnosticsView;
}) {
  return (
    <section className="space-y-5">
      <section className="flex flex-col gap-4 rounded-md border border-border bg-card p-5 shadow-sm">
        <div>
          <h2>Host Pages</h2>
          <p>展示页面注册表、激活覆盖、候选模块和组合诊断。</p>
        </div>
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted text-xs uppercase tracking-normal text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">Page</th>
                <th className="px-4 py-3 font-semibold">Area</th>
                <th className="px-4 py-3 font-semibold">Active override</th>
                <th className="px-4 py-3 font-semibold">Candidates</th>
                <th className="px-4 py-3 font-semibold">Diagnostics</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {composition.pages.map((page) => (
                <tr key={page.pageId}>
                  <td className="px-4 py-3 align-top">{page.pageId}</td>
                  <td className="px-4 py-3 align-top">{page.area}</td>
                  <td className="px-4 py-3 align-top">{page.activeModuleId ?? 'host default'}</td>
                  <td className="px-4 py-3 align-top">{page.replaceCandidates.join(', ') || 'none'}</td>
                  <td className="px-4 py-3 align-top">{page.diagnostics.join(' | ') || 'clean'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-md border border-border bg-card p-5 shadow-sm">
        <div>
          <h2>Slot Policies</h2>
          <p>展示 host.page 插槽允许列表、maxContributions、候选模块和当前激活贡献。</p>
        </div>
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted text-xs uppercase tracking-normal text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">Slot</th>
                <th className="px-4 py-3 font-semibold">Policy</th>
                <th className="px-4 py-3 font-semibold">Candidates</th>
                <th className="px-4 py-3 font-semibold">Active</th>
                <th className="px-4 py-3 font-semibold">Diagnostics</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {composition.slots.length > 0 ? (
                composition.slots.map((slot) => (
                  <tr key={slot.surfaceId}>
                    <td className="px-4 py-3 align-top">
                      <span className="block font-medium text-foreground">{slot.pageId}</span>
                      <span className="text-muted-foreground">{slot.slotId}</span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      {slot.configured ? (
                        <>
                          allow {joinList(slot.allowModules)}
                          <br />
                          max {slot.maxContributions ?? slot.effectiveMaxContributions}
                        </>
                      ) : (
                        `default max ${slot.effectiveMaxContributions}`
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">{joinList(slot.candidateModules)}</td>
                    <td className="px-4 py-3 align-top">{joinList(slot.activeModules, 'host default')}</td>
                    <td className="px-4 py-3 align-top">
                      {slot.diagnostics.length > 0
                        ? slot.diagnostics.join(' | ')
                        : slot.blockedContributions.length > 0
                          ? slot.blockedContributions
                              .map((item) => `${item.moduleId}: ${item.code}`)
                              .join(' | ')
                        : slot.blockedModules.length > 0
                          ? `blocked: ${slot.blockedModules.join(', ')}`
                          : 'clean'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-4 py-8 text-center text-muted-foreground" colSpan={5}>
                    No slot policies.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-md border border-border bg-card p-5 shadow-sm">
        <div>
          <h2>Theme Diagnostics</h2>
          <p>展示产品/工作区主题档案、模块主题令牌是否被宿主允许列表接受，以及是否声明 ThemeWrite。</p>
        </div>
        <div className="text-sm text-muted-foreground">Allowed tokens: {theme.allowedTokens.join(', ')}</div>
        <div className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-md border border-border bg-background p-4">
            <h3 className="text-base font-semibold text-foreground">Product Profile</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {theme.productProfile.profileName} / {theme.productProfile.modeDefault} /{' '}
              {theme.productProfile.density}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Tokens: {Object.keys(theme.productProfile.acceptedTokens).join(', ') || 'none'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Dark: {Object.keys(theme.productProfile.acceptedDarkTokens).join(', ') || 'none'}
            </p>
            {theme.productProfile.diagnostics.length > 0 ||
            Object.keys(theme.productProfile.rejectedTokens).length > 0 ? (
              <p className="mt-2 text-sm text-destructive">
                {[
                  ...theme.productProfile.diagnostics,
                  ...Object.keys(theme.productProfile.rejectedTokens),
                ].join(' | ')}
              </p>
            ) : null}
          </article>
          <article className="rounded-md border border-border bg-background p-4">
            <h3 className="text-base font-semibold text-foreground">Workspace Profiles</h3>
            {theme.workspaceProfiles.length > 0 ? (
              <div className="mt-2 grid gap-2 text-sm">
                {theme.workspaceProfiles.map((item) => (
                  <div
                    key={item.workspaceId ?? item.profileName}
                    className="rounded-md border border-border bg-card p-3"
                  >
                    <strong className="block text-foreground">{item.workspaceId}</strong>
                    <span className="text-muted-foreground">
                      {item.profileName} / tokens{' '}
                      {Object.keys(item.acceptedTokens).join(', ') || 'none'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">No workspace theme overrides.</p>
            )}
          </article>
        </div>
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted text-xs uppercase tracking-normal text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">Module</th>
                <th className="px-4 py-3 font-semibold">ThemeWrite</th>
                <th className="px-4 py-3 font-semibold">CSS</th>
                <th className="px-4 py-3 font-semibold">Accepted</th>
                <th className="px-4 py-3 font-semibold">Rejected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {theme.modules.length > 0 ? (
                theme.modules.map((module) => (
                  <tr key={module.moduleId}>
                    <td className="px-4 py-3 align-top">{module.moduleId}</td>
                    <td className="px-4 py-3 align-top">
                      {module.declaredThemeWrite ? 'declared' : 'missing'}
                    </td>
                    <td className="px-4 py-3 align-top">{module.hasCss ? 'blocked' : 'none'}</td>
                    <td className="px-4 py-3 align-top">
                      {Object.keys(module.acceptedTokens).join(', ') || 'none'}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {Object.keys(module.rejectedTokens).join(', ') || 'none'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-4 py-8 text-center text-muted-foreground" colSpan={5}>
                    No module theme declarations.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
