import { expect, type Page } from '@playwright/test';

export const ADMIN_EMAIL = 'admin@example.com';
export const ADMIN_PASSWORD = 'Admin@123456';
export const SAMPLE_PLUGIN_ID = 'sample-internal';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3100';
const ADMIN_COOKIE = process.env.PLAYWRIGHT_ADMIN_COOKIE;
let cachedAdminCookies: Awaited<ReturnType<ReturnType<Page['context']>['cookies']>> | null = null;

interface BrowserFetchResult<TBody> {
  status: number;
  ok: boolean;
  body: TBody;
}

interface PluginListItem {
  id: string;
  installed: boolean;
  enabled?: boolean;
}

interface AdminProfileBody {
  profile?: {
    email?: string;
  };
}

interface AdminProfileCheck {
  status: number;
  ok: boolean;
  body?: AdminProfileBody;
  text?: string;
}

async function browserFetchJson<TBody>(
  page: Page,
  path: string,
  init?: {
    method?: string;
    body?: unknown;
  }
): Promise<BrowserFetchResult<TBody>> {
  return page.evaluate(
    async ({ requestPath, requestInit }) => {
      const response = await fetch(requestPath, {
        method: requestInit?.method,
        headers:
          requestInit?.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: requestInit?.body === undefined ? undefined : JSON.stringify(requestInit.body),
      });
      const text = await response.text();

      return {
        status: response.status,
        ok: response.ok,
        body: text ? (JSON.parse(text) as TBody) : ({} as TBody),
      };
    },
    { requestPath: path, requestInit: init }
  );
}

async function readAdminProfileFromApiPage(page: Page): Promise<AdminProfileCheck> {
  const response = await page.goto('/api/user/profile');
  if (!response) {
    return {
      status: 0,
      ok: false,
      text: 'No response was returned for /api/user/profile.',
    };
  }

  const text = await response.text();
  try {
    return {
      status: response.status(),
      ok: response.ok(),
      body: text ? (JSON.parse(text) as AdminProfileBody) : {},
      text,
    };
  } catch {
    return {
      status: response.status(),
      ok: false,
      text,
    };
  }
}

function expectAdminProfile(check: AdminProfileCheck, label: string) {
  expect(
    check.ok,
    `${label} returned ${check.status}: ${check.text ?? JSON.stringify(check.body)}`
  ).toBe(true);
  expect(check.body?.profile?.email).toBe(ADMIN_EMAIL);
}

function cookieHeaderToBrowserCookies(cookieHeader: string) {
  const baseUrl = new URL(BASE_URL);

  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part.includes('='))
    .map((part) => {
      const separatorIndex = part.indexOf('=');
      return {
        name: part.slice(0, separatorIndex),
        value: part.slice(separatorIndex + 1),
        domain: baseUrl.hostname,
        path: '/',
        httpOnly: true,
        sameSite: 'Lax' as const,
        secure: baseUrl.protocol === 'https:',
      };
    });
}

export async function loginAsAdmin(page: Page, lang = 'zh') {
  if (ADMIN_COOKIE) {
    await page.context().addCookies(cookieHeaderToBrowserCookies(ADMIN_COOKIE));

    const profile = await readAdminProfileFromApiPage(page);
    expectAdminProfile(profile, 'Admin cookie profile check');
    return;
  }

  if (cachedAdminCookies?.length) {
    await page.context().addCookies(cachedAdminCookies);

    const profile = await readAdminProfileFromApiPage(page);
    if (profile.ok && profile.body?.profile?.email === ADMIN_EMAIL) {
      return;
    }
  }

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: {
      origin: BASE_URL,
      referer: new URL(`/${lang}/login`, BASE_URL).toString(),
    },
    data: {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      callbackURL: new URL(`/${lang}`, BASE_URL).toString(),
    },
  });
  const responseText = response.ok() ? '' : await response.text();
  expect(response.ok(), responseText || 'Admin API sign-in failed').toBe(true);
  cachedAdminCookies = await page.context().cookies(BASE_URL);

  const profile = await readAdminProfileFromApiPage(page);
  expectAdminProfile(profile, 'Admin profile check after sign-in');
}

export async function ensureSamplePluginEnabled(page: Page) {
  const list = async () =>
    browserFetchJson<{ plugins?: PluginListItem[] }>(page, '/api/admin/plugins');

  let response = await list();
  expect(
    response.ok,
    `GET /api/admin/plugins returned ${response.status}: ${JSON.stringify(response.body)}`
  ).toBe(true);
  let sample = response.body.plugins?.find((plugin) => plugin.id === SAMPLE_PLUGIN_ID);
  expect(sample).toBeTruthy();

  if (!sample?.installed) {
    const install = await browserFetchJson(page, `/api/admin/plugins/${SAMPLE_PLUGIN_ID}/install`, {
      method: 'POST',
      body: {},
    });
    expect(
      install.ok,
      `POST /api/admin/plugins/${SAMPLE_PLUGIN_ID}/install returned ${install.status}: ${JSON.stringify(install.body)}`
    ).toBe(true);
    response = await list();
    sample = response.body.plugins?.find((plugin) => plugin.id === SAMPLE_PLUGIN_ID);
  }

  if (!sample?.enabled) {
    const enable = await browserFetchJson(page, `/api/admin/plugins/${SAMPLE_PLUGIN_ID}/enable`, {
      method: 'POST',
      body: {},
    });
    expect(
      enable.ok,
      `POST /api/admin/plugins/${SAMPLE_PLUGIN_ID}/enable returned ${enable.status}: ${JSON.stringify(enable.body)}`
    ).toBe(true);
    response = await list();
    sample = response.body.plugins?.find((plugin) => plugin.id === SAMPLE_PLUGIN_ID);
  }

  expect(sample?.installed).toBe(true);
  expect(sample?.enabled).toBe(true);
}
