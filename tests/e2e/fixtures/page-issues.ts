import { expect, type Page, type TestInfo } from '@playwright/test';

interface PageIssue {
  type: 'console' | 'requestfailed';
  url: string;
  text: string;
}

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3100';
const BASE_ORIGINS = createEquivalentLocalOrigins(BASE_URL);
const LOCAL_NAVIGATION_ABORT_TEXTS = new Set([
  'net::ERR_ABORTED',
  'NS_BINDING_ABORTED',
  'NS_BASE_STREAM_CLOSED',
  'NS_ERROR_DOM_BAD_URI',
  'Load request cancelled',
  'Blocked by Content Security Policy.',
]);
const NAVIGATION_ABORTABLE_API_PATHS = [
  '/api/auth/get-session',
  '/api/user/profile',
  '/api/user/profile/password',
  '/api/user/role',
  '/api/admin/dashboard/',
  '/api/admin/plugins',
];

function createEquivalentLocalOrigins(baseUrl: string): string[] {
  const url = new URL(baseUrl);
  const origins = new Set<string>([url.origin]);

  if (url.hostname === '127.0.0.1') {
    url.hostname = 'localhost';
    origins.add(url.origin);
  } else if (url.hostname === 'localhost') {
    url.hostname = '127.0.0.1';
    origins.add(url.origin);
  }

  return [...origins];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isEquivalentLocalUrl(url: string): boolean {
  return BASE_ORIGINS.some((origin) => url.startsWith(`${origin}/`));
}

function isKnownLocalCspConsole(issue: PageIssue): boolean {
  if (issue.type !== 'console' || !isEquivalentLocalUrl(issue.url)) {
    return false;
  }

  const text = issue.text.toLowerCase();
  const referencesLocalOrigin = BASE_ORIGINS.some((origin) =>
    issue.text.toLowerCase().includes(origin.toLowerCase())
  );

  return (
    (text.includes('content security policy') || text.includes('content-security-policy')) &&
    (referencesLocalOrigin ||
      text.includes('blocked by content security policy') ||
      text.includes('connect-src'))
  );
}

function isNavigationAbortableLocalApi(url: string): boolean {
  return NAVIGATION_ABORTABLE_API_PATHS.some((path) => new URL(url).pathname.startsWith(path));
}

function isNavigationAbortableStaticAsset(url: string): boolean {
  const pathname = new URL(url).pathname;
  return pathname === '/favicon.ico' || pathname.startsWith('/_next/static/');
}

function isKnownLocalNavigationAbort(issue: PageIssue): boolean {
  return (
    issue.type === 'requestfailed' &&
    isEquivalentLocalUrl(issue.url) &&
    LOCAL_NAVIGATION_ABORT_TEXTS.has(issue.text) &&
    (issue.url.includes('_rsc=') ||
      isNavigationAbortableLocalApi(issue.url) ||
      isNavigationAbortableStaticAsset(issue.url))
  );
}

function isKnownAllowedIssue(issue: PageIssue): boolean {
  if (isKnownLocalCspConsole(issue) || isKnownLocalNavigationAbort(issue)) {
    return true;
  }

  if (
    issue.type === 'console' &&
    issue.text.includes('violates the following Content Security Policy directive') &&
    BASE_ORIGINS.some((origin) => issue.text.includes(`${origin}/`))
  ) {
    return true;
  }

  if (issue.type === 'requestfailed' && isEquivalentLocalUrl(issue.url) && issue.text === 'csp') {
    return true;
  }

  if (
    issue.type === 'requestfailed' &&
    issue.url.includes('_rsc=') &&
    issue.text === 'net::ERR_ABORTED'
  ) {
    return true;
  }

  if (
    issue.type === 'requestfailed' &&
    isEquivalentLocalUrl(issue.url) &&
    issue.url.includes('/_next/static/') &&
    issue.text === 'net::ERR_ABORTED'
  ) {
    return true;
  }

  if (
    issue.type === 'requestfailed' &&
    BASE_ORIGINS.some((origin) =>
      new RegExp(`^${escapeRegExp(origin)}\\/(en|zh)$`).test(issue.url)
    ) &&
    issue.text === 'net::ERR_ABORTED'
  ) {
    return true;
  }

  if (
    issue.type === 'requestfailed' &&
    isEquivalentLocalUrl(issue.url) &&
    issue.url.includes('/api/admin/dashboard/') &&
    issue.text === 'net::ERR_ABORTED'
  ) {
    return true;
  }

  if (
    issue.type === 'requestfailed' &&
    isEquivalentLocalUrl(issue.url) &&
    issue.url.includes('/api/user/role') &&
    issue.text === 'net::ERR_ABORTED'
  ) {
    return true;
  }

  return false;
}

export function collectPageIssues(page: Page) {
  const issues: PageIssue[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      issues.push({
        type: 'console',
        url: page.url(),
        text: message.text(),
      });
    }
  });

  page.on('requestfailed', (request) => {
    issues.push({
      type: 'requestfailed',
      url: request.url(),
      text: request.failure()?.errorText || 'unknown',
    });
  });

  return {
    issues,
    async assertNoUnexpected(testInfo: TestInfo) {
      const unexpected = issues.filter((issue) => !isKnownAllowedIssue(issue));

      await testInfo.attach('page-issues.json', {
        body: JSON.stringify({ issues, unexpected }, null, 2),
        contentType: 'application/json',
      });

      expect(unexpected).toEqual([]);
    },
  };
}
