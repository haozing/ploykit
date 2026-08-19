import assert from 'node:assert/strict';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  createInMemoryModuleConnectorOperations,
  createInMemoryModuleRunRuntime,
  createInMemoryRuntimeAuditLog,
  createModuleAdminRuntime,
  createRuntimeLogger,
  redactSensitive,
} from '../src/lib/module-runtime';
import {
  createInMemoryModuleCommercialRuntime,
  createModuleHttpApi,
} from '../src/lib/module-capabilities';
import { loadRuntimeConfig } from '../src/lib/runtime-config';
import {
  createDashboardServerTimingHeader,
  createDashboardTimingReport,
  measureDashboardSpan,
} from '../apps/host-next/lib/dashboard-timing';
import {
  cachedDashboardProductScopeSnapshot,
  cachedDashboardModulePageRoute,
  cachedDashboardNavigation,
  cachedDashboardTheme,
  cachedDashboardUserProfile,
  dashboardShellModulePageKey,
  dashboardShellProductScopeResolutionKey,
  dashboardShellSessionKey,
  dashboardShellNavigationKey,
  invalidateDashboardShellCache,
  resetDashboardShellCacheForTests,
} from '../apps/host-next/lib/dashboard-shell-cache';
import { resolveHostClientTransitionHref } from '../apps/host-next/lib/client-transition-links';

type NextHeaderRule = {
  source: string;
  headers: Array<{ key: string; value: string }>;
};

type HostNextConfig = {
  headers(): Promise<NextHeaderRule[]>;
};

test('runtime config reports missing production inputs without fallback', () => {
  const result = loadRuntimeConfig({});

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    [
      'RUNTIME_CONFIG_DATABASE_URL_REQUIRED',
      'RUNTIME_CONFIG_HOST_URL_REQUIRED',
      'RUNTIME_CONFIG_AUTH_PROVIDER_INVALID',
    ]
  );
});

test('runtime config loads explicit production inputs', () => {
  const result = loadRuntimeConfig({
    DATABASE_URL: 'postgres://user:pass@localhost:5432/app',
    PLOYKIT_HOST_URL: 'https://app.example.com',
    PLOYKIT_AUTH_PROVIDER: 'host',
    PLOYKIT_RUNTIME_FLAGS: 'jobs=true,webhooks=false',
  });

  assert.equal(result.ok, true);
  assert.equal(result.config?.runtimeFlags.jobs, true);
  assert.equal(result.config?.runtimeFlags.webhooks, false);
});

test('runtime config accepts POSTGRES_URL as database fallback', () => {
  const result = loadRuntimeConfig({
    POSTGRES_URL: 'postgres://user:pass@localhost:5432/app',
    PLOYKIT_HOST_URL: 'https://app.example.com',
    PLOYKIT_AUTH_PROVIDER: 'host',
  });

  assert.equal(result.ok, true);
  assert.equal(result.config?.databaseUrl, 'postgres://user:pass@localhost:5432/app');
});

test('runtime config rejects reserved OIDC provider until an adapter exists', () => {
  const result = loadRuntimeConfig({
    DATABASE_URL: 'postgres://user:pass@localhost:5432/app',
    PLOYKIT_HOST_URL: 'https://app.example.com',
    PLOYKIT_AUTH_PROVIDER: 'oidc',
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0]?.code, 'RUNTIME_CONFIG_AUTH_PROVIDER_INVALID');
});

test('host static brand assets use immutable cache headers', async () => {
  const configUrl = new URL(
    `file://${path.resolve('apps/host-next/next.config.mjs').replace(/\\/g, '/')}`
  ).href;
  const { default: nextConfig } = (await import(configUrl)) as { default: HostNextConfig };
  const headers = await nextConfig.headers();
  const brandRule = headers.find((rule) => rule.source === '/brand/:path*');

  assert.ok(brandRule);
  assert.deepEqual(brandRule.headers, [
    {
      key: 'Cache-Control',
      value: 'public, max-age=31536000, immutable',
    },
  ]);
});

test('dashboard timing reports structured slow-route spans', async () => {
  const spans: Array<{ name: string; durationMs: number }> = [];
  const value = await measureDashboardSpan('route-resolve', spans, () => 'resolved');
  await measureDashboardSpan('scope', spans, () => ({ id: 'scope' }));
  await measureDashboardSpan('workspaces', spans, () => []);
  await measureDashboardSpan('profile', spans, () => null);
  await measureDashboardSpan('theme', spans, () => ({ mode: 'light' }));
  const report = createDashboardTimingReport(
    {
      pathname: '/origin-agentops/agents',
      routeKind: 'dashboard',
      moduleId: 'origin-agentops',
      status: 200,
      spans,
      totalMs: 1250,
    },
    1000
  );

  assert.equal(value, 'resolved');
  assert.deepEqual(
    spans.map((span) => span.name),
    ['route-resolve', 'scope', 'workspaces', 'profile', 'theme']
  );
  assert.equal(spans[0]?.name, 'route-resolve');
  assert.ok((spans[0]?.durationMs ?? -1) >= 0);
  assert.deepEqual(report, {
    kind: 'dashboard-timing',
    pathname: '/origin-agentops/agents',
    routeKind: 'dashboard',
    moduleId: 'origin-agentops',
    status: 200,
    spans,
    totalMs: 1250,
    slow: true,
  });
});

test('dashboard shell cache reuses scoped shell reads and respects invalidation', async () => {
  resetDashboardShellCacheForTests();
  const originalTtl = process.env.PLOYKIT_DASHBOARD_SHELL_CACHE_TTL_MS;
  process.env.PLOYKIT_DASHBOARD_SHELL_CACHE_TTL_MS = '1000';
  try {
    const session = {
      user: { id: 'user-1', role: 'user' as const },
      userId: 'user-1',
      authKind: 'user' as const,
      authSessionId: 'session-1',
      productId: 'product-1',
      workspaceId: 'workspace-1',
      workspaceRole: 'owner' as const,
    };
    const sameSession = { ...session, requestId: 'request-noise' };
    const nextSession = { ...session, authSessionId: 'session-2' };
    const request = new Request('https://app.example.com/dashboard?workspace=workspace-1', {
      headers: { host: 'app.example.com' },
    });

    assert.equal(dashboardShellSessionKey(session), dashboardShellSessionKey(sameSession));
    assert.notEqual(dashboardShellSessionKey(session), dashboardShellSessionKey(nextSession));
    assert.equal(
      dashboardShellProductScopeResolutionKey(request, session),
      'app.example.com|workspace-1||user:session-1:user-1:user:product-1:workspace-1:owner:'
    );
    assert.equal(
      dashboardShellNavigationKey(session),
      'user:session-1:user-1:user:product-1:workspace-1:owner:|user||||||||'
    );
    assert.equal(
      dashboardShellModulePageKey({
        request: new Request('https://app.example.com/dashboard/tool?b=2&a=1', {
          headers: { cookie: 'ploykit_product_scope=scope-cookie', host: 'app.example.com' },
        }),
        session,
        kind: 'dashboard',
        pathname: '/tool',
        language: 'zh',
      }),
      'app.example.com|dashboard|/tool|zh|a=1&b=2|scope-cookie|user:session-1:user-1:user:product-1:workspace-1:owner:|user||||||||'
    );
    assert.notEqual(
      dashboardShellNavigationKey(session),
      dashboardShellNavigationKey({
        ...session,
        entitlements: ['pro'],
      })
    );

    let snapshots = 0;
    const firstSnapshot = await Promise.all([
      cachedDashboardProductScopeSnapshot(async () => {
        snapshots += 1;
        return {
          version: 1 as const,
          products: [{ id: 'product-1', name: 'Product', profile: 'hidden-default' as const }],
          workspaces: [],
          memberships: [],
          invites: [],
          domainAliases: [],
        };
      }),
      cachedDashboardProductScopeSnapshot(async () => {
        snapshots += 1;
        throw new Error('snapshot cache miss');
      }),
    ]);
    assert.equal(snapshots, 1);
    assert.equal(firstSnapshot[0], firstSnapshot[1]);

    let profiles = 0;
    const profile = await cachedDashboardUserProfile(session, async () => {
      profiles += 1;
      return {
        id: 'user-1',
        email: 'user@example.com',
        role: 'user',
        status: 'active',
        productId: 'product-1',
        workspaceId: 'workspace-1',
        workspaceRole: 'owner',
        displayName: 'User One',
        preferences: {
          notifications: {
            inApp: true,
            email: false,
            billing: true,
            files: true,
            admin: true,
          },
          search: { recentSearches: [] },
        },
      };
    });
    const cachedProfile = await cachedDashboardUserProfile(session, async () => {
      profiles += 1;
      throw new Error('profile cache miss');
    });
    assert.equal(profiles, 1);
    assert.equal(cachedProfile, profile);

    let themes = 0;
    const theme = cachedDashboardTheme('workspace-1', () => {
      themes += 1;
      return {
        product: {} as never,
        workspace: null,
        page: null,
        defaultTheme: 'system' as const,
        cssVariables: { '--theme-color-background': '#fff' },
        darkCssVariables: {},
        localeTypography: {},
      };
    });
    const cachedTheme = cachedDashboardTheme('workspace-1', () => {
      themes += 1;
      throw new Error('theme cache miss');
    });
    assert.equal(themes, 1);
    assert.equal(cachedTheme, theme);

    let navigation = 0;
    const nav = cachedDashboardNavigation(session, () => {
      navigation += 1;
      return [{ href: '/dashboard', label: 'Dashboard' }];
    });
    const cachedNav = cachedDashboardNavigation(session, () => {
      navigation += 1;
      throw new Error('navigation cache miss');
    });
    assert.equal(navigation, 1);
    assert.equal(cachedNav, nav);

    let moduleRoutes = 0;
    const moduleRoute = await cachedDashboardModulePageRoute({
      request,
      session,
      kind: 'dashboard',
      pathname: '/cached-tool',
      language: 'zh',
      async loader() {
        moduleRoutes += 1;
        return { ok: true, value: moduleRoutes };
      },
      cachePolicy: () => ({ strategy: 'private', revalidateSeconds: 30 }),
    });
    const cachedModuleRoute = await cachedDashboardModulePageRoute({
      request,
      session,
      kind: 'dashboard',
      pathname: '/cached-tool',
      language: 'zh',
      async loader() {
        moduleRoutes += 1;
        throw new Error('module route cache miss');
      },
      cachePolicy: () => ({ strategy: 'private', revalidateSeconds: 30 }),
    });
    assert.equal(moduleRoutes, 1);
    assert.equal(cachedModuleRoute, moduleRoute);

    let uncachedModuleRoutes = 0;
    await cachedDashboardModulePageRoute({
      request,
      session,
      kind: 'dashboard',
      pathname: '/uncached-tool',
      async loader() {
        uncachedModuleRoutes += 1;
        return { ok: true };
      },
      cachePolicy: () => ({ strategy: 'none', revalidateSeconds: 30 }),
    });
    await cachedDashboardModulePageRoute({
      request,
      session,
      kind: 'dashboard',
      pathname: '/uncached-tool',
      async loader() {
        uncachedModuleRoutes += 1;
        return { ok: true };
      },
      cachePolicy: () => ({ strategy: 'none', revalidateSeconds: 30 }),
    });
    assert.equal(uncachedModuleRoutes, 2);

    invalidateDashboardShellCache('profile');
    const refreshedProfile = await cachedDashboardUserProfile(session, async () => {
      profiles += 1;
      return { ...profile, displayName: 'User Two' };
    });
    assert.equal(profiles, 2);
    assert.equal(refreshedProfile.displayName, 'User Two');

    invalidateDashboardShellCache();
    cachedDashboardTheme('workspace-1', () => {
      themes += 1;
      return theme;
    });
    assert.equal(themes, 2);
    cachedDashboardNavigation(session, () => {
      navigation += 1;
      return nav;
    });
    assert.equal(navigation, 2);
    const refreshedModuleRoute = await cachedDashboardModulePageRoute({
      request,
      session,
      kind: 'dashboard',
      pathname: '/cached-tool',
      language: 'zh',
      async loader() {
        moduleRoutes += 1;
        return { ok: true, value: moduleRoutes };
      },
      cachePolicy: () => ({ strategy: 'private', revalidateSeconds: 30 }),
    });
    assert.equal(moduleRoutes, 2);
    assert.notEqual(refreshedModuleRoute, moduleRoute);
  } finally {
    if (originalTtl === undefined) {
      delete process.env.PLOYKIT_DASHBOARD_SHELL_CACHE_TTL_MS;
    } else {
      process.env.PLOYKIT_DASHBOARD_SHELL_CACHE_TTL_MS = originalTtl;
    }
    resetDashboardShellCacheForTests();
  }
});

test('host client transition catches module dashboard anchors without breaking safe link defaults', () => {
  assert.deepEqual(
    resolveHostClientTransitionHref({
      area: 'dashboard',
      href: '/dashboard/origin-agentops/skills',
      currentUrl: 'https://app.example.com/dashboard/origin-agentops/agents',
    }),
    {
      shouldNavigate: true,
      href: '/dashboard/origin-agentops/skills',
    }
  );
  assert.deepEqual(
    resolveHostClientTransitionHref({
      area: 'dashboard',
      href: '/zh/dashboard/files?tab=all',
      currentUrl: 'https://app.example.com/zh/dashboard',
    }),
    {
      shouldNavigate: true,
      href: '/zh/dashboard/files?tab=all',
    }
  );
  assert.deepEqual(
    resolveHostClientTransitionHref({
      area: 'dashboard',
      href: '/dashboard/origin-agentops/traces',
      currentUrl: 'https://app.example.com/zh/dashboard/origin-agentops/runtime',
    }),
    {
      shouldNavigate: true,
      href: '/zh/dashboard/origin-agentops/traces',
    }
  );
  assert.deepEqual(
    resolveHostClientTransitionHref({
      area: 'admin',
      href: '/admin/modules',
      currentUrl: 'https://app.example.com/en/admin/users',
    }),
    {
      shouldNavigate: true,
      href: '/en/admin/modules',
    }
  );

  assert.equal(
    resolveHostClientTransitionHref({
      area: 'dashboard',
      href: 'https://external.example.com/dashboard',
      currentUrl: 'https://app.example.com/dashboard',
    }).shouldNavigate,
    false
  );
  assert.equal(
    resolveHostClientTransitionHref({
      area: 'dashboard',
      href: '/dashboard/files',
      currentUrl: 'https://app.example.com/dashboard',
      ctrlKey: true,
    }).shouldNavigate,
    false
  );
  assert.equal(
    resolveHostClientTransitionHref({
      area: 'dashboard',
      href: '/dashboard#files',
      currentUrl: 'https://app.example.com/dashboard',
    }).shouldNavigate,
    false
  );
  assert.equal(
    resolveHostClientTransitionHref({
      area: 'dashboard',
      href: '/api/billing/invoices?id=invoice-1',
      currentUrl: 'https://app.example.com/dashboard/orders',
    }).shouldNavigate,
    false
  );
});

test('dashboard timing can be encoded as a Server-Timing header', () => {
  assert.equal(
    createDashboardServerTimingHeader({
      spans: [
        { name: 'auth', durationMs: 12 },
        { name: 'module host', durationMs: 3.25 },
      ],
      totalMs: 18,
    }),
    'auth;dur=12, module-host;dur=3.3, total;dur=18'
  );
});

test('observability redacts secrets from logs and connector records', () => {
  const logger = createRuntimeLogger({
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
  logger.info('webhook received', {
    token: 'secret-token',
    nested: { webhookSignature: 'sig' },
  });
  const connectorOps = createInMemoryModuleConnectorOperations(
    () => new Date('2026-01-01T00:00:00.000Z')
  );
  const connectorRecord = connectorOps.record({
    moduleId: 'prod-test',
    connector: 'stripe',
    operation: 'charge',
    status: 'succeeded',
    durationMs: 12,
    request: { authorization: 'Bearer secret' },
    response: { cardNumber: '4111111111111111' },
  });

  assert.deepEqual(logger.records[0].metadata, {
    token: '[REDACTED]',
    nested: { webhookSignature: '[REDACTED]' },
  });
  assert.deepEqual(connectorRecord.request, { authorization: '[REDACTED]' });
  assert.deepEqual(connectorRecord.response, { cardNumber: '[REDACTED]' });
  assert.deepEqual(redactSensitive({ apiKey: 'x' }), { apiKey: '[REDACTED]' });
});

test('module http runtime enforces egress origin, method, and body size', async () => {
  const calls: string[] = [];
  const auditEvents: { ok: boolean; origin: string; path: string; status?: number }[] = [];
  const http = createModuleHttpApi({
    moduleId: 'prod-test',
    allowedOrigins: ['https://api.example.com'],
    allowedMethods: ['POST'],
    maxBodyBytes: 10,
    resolveHost: async () => ['203.0.113.10'],
    audit: (event) => {
      auditEvents.push({
        ok: event.ok,
        origin: event.origin,
        path: event.path,
        status: event.status,
      });
    },
    fetchImpl: async (input) => {
      calls.push(input instanceof Request ? input.url : String(input));
      return Response.json({ ok: true });
    },
  });

  assert.equal(
    (await http.fetch('https://api.example.com/run', { method: 'POST', body: 'ok' })).status,
    200
  );
  await assert.rejects(() => http.fetch('https://evil.example.com/run', { method: 'POST' }));
  await assert.rejects(() => http.fetch('https://api.example.com/run', { method: 'GET' }));
  await assert.rejects(() =>
    http.fetch('https://api.example.com/run', { method: 'POST', body: 'too-large-body' })
  );
  await assert.rejects(() =>
    http.fetch(
      new Request('https://api.example.com/run', {
        method: 'POST',
        body: 'request-body-too-large',
        duplex: 'half',
      } as RequestInit)
    )
  );
  assert.equal(calls.length, 1);
  assert.equal(auditEvents.filter((event) => event.ok).length, 1);
  assert.ok(auditEvents.some((event) => event.origin === 'https://evil.example.com'));
  assert.ok(auditEvents.every((event) => event.path === '/run'));
});

test('module http runtime blocks sensitive headers, private networks, redirects, response size and timeout', async () => {
  await assert.rejects(() =>
    createModuleHttpApi({
      moduleId: 'prod-test',
      allowedOrigins: ['https://api.example.com'],
      resolveHost: async () => ['127.0.0.1'],
      fetchImpl: async () => Response.json({ ok: true }),
    }).fetch('https://api.example.com/run')
  );

  await assert.rejects(() =>
    createModuleHttpApi({
      moduleId: 'prod-test',
      allowedOrigins: ['https://api.example.com'],
      resolveHost: async () => ['::ffff:127.0.0.1'],
      fetchImpl: async () => Response.json({ ok: true }),
    }).fetch('https://api.example.com/run')
  );

  await assert.rejects(() =>
    createModuleHttpApi({
      moduleId: 'prod-test',
      allowedOrigins: ['https://api.example.com'],
      resolveHost: async () => ['not-an-ip-address'],
      fetchImpl: async () => Response.json({ ok: true }),
    }).fetch('https://api.example.com/run')
  );

  await assert.rejects(() =>
    createModuleHttpApi({
      moduleId: 'prod-test',
      allowedOrigins: ['https://api.example.com'],
      resolveHost: async () => ['203.0.113.10'],
      fetchImpl: async () => Response.json({ ok: true }),
    }).fetch('https://api.example.com/run', {
      headers: { authorization: 'Bearer secret' },
    })
  );

  await assert.rejects(() =>
    createModuleHttpApi({
      moduleId: 'prod-test',
      allowedOrigins: ['https://api.example.com'],
      resolveHost: async () => ['203.0.113.10'],
      redirect: 'follow-same-origin',
      fetchImpl: async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://evil.example.com/next' },
        }),
    }).fetch('https://api.example.com/run')
  );

  await assert.rejects(() =>
    createModuleHttpApi({
      moduleId: 'prod-test',
      allowedOrigins: ['https://api.example.com'],
      resolveHost: async () => ['203.0.113.10'],
      maxResponseBytes: 4,
      fetchImpl: async () => new Response('too large'),
    }).fetch('https://api.example.com/run')
  );

  await assert.rejects(() =>
    createModuleHttpApi({
      moduleId: 'prod-test',
      allowedOrigins: ['https://api.example.com'],
      resolveHost: async () => ['203.0.113.10'],
      timeoutMs: 10,
      fetchImpl: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    }).fetch('https://api.example.com/run')
  );

  await assert.rejects(() =>
    createModuleHttpApi({
      moduleId: 'prod-test',
      allowedOrigins: ['https://api.example.com'],
      timeoutMs: 10,
      resolveHost: async () => new Promise<readonly string[]>(() => undefined),
      fetchImpl: async () => Response.json({ ok: true }),
    }).fetch('https://api.example.com/run')
  );
});

test('module http runtime pins default transport to validated DNS addresses', async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        host: request.headers.host,
        url: request.url,
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.equal(typeof address, 'object');
    assert.ok(address);
    const port = (address as AddressInfo).port;

    const http = createModuleHttpApi({
      moduleId: 'prod-test',
      allowedOrigins: [`http://api.example.com:${port}`],
      allowPrivateNetwork: true,
      resolveHost: async () => ['127.0.0.1'],
    });

    const response = await http.fetch(`http://api.example.com:${port}/run?ok=1`);
    const body = (await response.json()) as { host: string; url: string };

    assert.equal(response.status, 200);
    assert.equal(body.host, `api.example.com:${port}`);
    assert.equal(body.url, '/run?ok=1');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test('commercial runtime supports idempotent usage, metering, credits, and commerce', async () => {
  const commercial = createInMemoryModuleCommercialRuntime();
  const moduleCommercial = commercial.forModule('prod-test');
  const usage = await moduleCommercial.usage.record({
    meter: 'api.call',
    idempotencyKey: 'usage_1',
  });
  const usageDuplicate = await moduleCommercial.usage.record({
    meter: 'api.call',
    idempotencyKey: 'usage_1',
  });
  const authorization = await moduleCommercial.metering.authorize({
    meter: 'generation',
    quantity: 2,
    idempotencyKey: 'meter_1',
  });
  const committed = await moduleCommercial.metering.commit(authorization.id);
  await moduleCommercial.credits.grant({ userId: 'user_1', amount: 10 });
  const balance = await moduleCommercial.credits.consume({ userId: 'user_1', amount: 3 });
  const checkout = await moduleCommercial.commerce.createCheckout({
    userId: 'user_1',
    sku: 'credits_10',
    amount: 1000,
    currency: 'USD',
    idempotencyKey: 'checkout_1',
  });

  assert.equal(usage.id, usageDuplicate.id);
  assert.equal(committed.status, 'committed');
  assert.equal(balance.balance, 7);
  assert.equal((await moduleCommercial.commerce.getOrder(checkout.id))?.id, checkout.id);
  assert.equal(commercial.listUsage().length, 1);
});

test('commercial runtime rejects undeclared redeem codes and isolates current records by code', async () => {
  const commercial = createInMemoryModuleCommercialRuntime();
  const moduleCommercial = commercial.forModule('prod-test');

  assert.deepEqual(
    await moduleCommercial.redeemCodes.redeem({
      code: 'CODE_A',
      subject: { type: 'user', id: 'user_1' },
    }),
    { ok: false }
  );

  const batchA = await moduleCommercial.redeemCodes.createBatch({
    count: 1,
    entitlement: 'feature.a',
    maxRedemptions: 1,
  });
  const batchB = await moduleCommercial.redeemCodes.createBatch({
    count: 1,
    entitlement: 'feature.b',
    maxRedemptions: 1,
  });

  const first = await moduleCommercial.redeemCodes.redeem({
    code: batchA.codes[0]?.metadata.rawCode as string,
    subject: { type: 'user', id: 'user_1' },
  });
  const second = await moduleCommercial.redeemCodes.redeem({
    code: batchB.codes[0]?.metadata.rawCode as string,
    subject: { type: 'user', id: 'user_1' },
  });

  assert.equal(first.ok, true);
  assert.equal(first.entitlement, 'feature.a');
  assert.equal(second.ok, true);
  assert.equal(second.entitlement, 'feature.b');
});

test('commercial runtime derives expired redeem code status from expiresAt', async () => {
  const commercial = createInMemoryModuleCommercialRuntime({
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
  const moduleCommercial = commercial.forModule('prod-test');
  const batch = await moduleCommercial.redeemCodes.createBatch({
    count: 1,
    maxRedemptions: 1,
    expiresAt: '2025-01-01T00:00:00.000Z',
  });

  assert.equal((await moduleCommercial.redeemCodes.list({ status: 'expired' })).length, 1);
  assert.equal(
    (
      await moduleCommercial.redeemCodes.redeem({
        code: batch.codes[0]?.metadata.rawCode as string,
        subject: { type: 'user', id: 'user_1' },
      })
    ).ok,
    false
  );
});

test('admin runtime exposes operational records for host admin surfaces', async () => {
  const runs = createInMemoryModuleRunRuntime();
  const audit = createInMemoryRuntimeAuditLog({ moduleId: 'prod-test' });
  const commercial = createInMemoryModuleCommercialRuntime();
  runs.createRun({ moduleId: 'prod-test', kind: 'manual', name: 'sync' });
  await audit.record('prod.audit', { secret: 'hidden' });
  await commercial.forModule('prod-test').usage.record({ meter: 'api.call' });

  const admin = createModuleAdminRuntime({ runs, audit, commercial });

  assert.equal(admin.listRuns({ moduleId: 'prod-test' }).length, 1);
  assert.equal(admin.listAuditLogs({ moduleId: 'prod-test' }).length, 1);
  assert.equal(admin.listUsage().length, 1);
});
