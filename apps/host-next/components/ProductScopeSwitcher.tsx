'use client';

import {
  shouldShowProductScopeSwitcher,
  type ProductScopeResolution,
} from '@/lib/module-runtime/scope/product-scope-resolver';
import type {
  ProductScopeWorkspace,
} from '@/lib/module-runtime/scope/product-scope-types';
import { useState, type FormEvent } from 'react';

export function ProductScopeSwitcher({
  resolution,
  workspaces,
}: {
  resolution: ProductScopeResolution;
  workspaces: readonly ProductScopeWorkspace[];
}) {
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!shouldShowProductScopeSwitcher(resolution)) {
    return null;
  }

  async function switchWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const workspaceId = String(formData.get('workspaceId') ?? '');
    if (!workspaceId || workspaceId === resolution.workspace.id) {
      return;
    }
    setSwitching(true);
    setError(null);
    const response = await fetch('/api/product-scope/switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId }),
    });
    if (!response.ok) {
      setSwitching(false);
      setError('Unable to switch workspace');
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('workspace');
    window.location.assign(`${url.pathname}${url.search}${url.hash}`);
  }

  return (
    <form className="scope-switcher" aria-label="Product scope" onSubmit={switchWorkspace}>
      <span>{resolution.product.name}</span>
      <select
        name="workspaceId"
        defaultValue={resolution.workspace.id}
        aria-label="Workspace"
        disabled={switching}
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="inline-flex min-h-8 items-center justify-center rounded-md px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted"
        disabled={switching}
      >
        {switching ? '切换中' : '切换'}
      </button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </form>
  );
}
