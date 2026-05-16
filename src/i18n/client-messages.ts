import type { AbstractIntlMessages } from 'next-intl';

type MessageRecord = Record<string, unknown>;

const GLOBAL_CLIENT_MESSAGE_PATHS = ['common', 'components.shared.userDropdown', 'errors'];
const PUBLIC_SITE_MESSAGE_PATHS = ['home', 'about', 'privacy', 'terms', 'contact', 'pricing'];
const AUTH_MESSAGE_PATHS = ['auth'];
const DASHBOARD_MESSAGE_PATHS = ['dashboard', 'components'];
const ADMIN_MESSAGE_PATHS = ['dashboard', 'components'];

const HOST_MESSAGE_NAMESPACES = new Set(
  [
    ...GLOBAL_CLIENT_MESSAGE_PATHS,
    ...PUBLIC_SITE_MESSAGE_PATHS,
    ...AUTH_MESSAGE_PATHS,
    ...DASHBOARD_MESSAGE_PATHS,
    ...ADMIN_MESSAGE_PATHS,
  ].map((path) => path.split('.')[0])
);

export type ClientMessageScope = 'global' | 'site' | 'auth' | 'dashboard' | 'admin';

function withGlobalMessagePaths(paths: readonly string[]): string[] {
  return [...new Set([...GLOBAL_CLIENT_MESSAGE_PATHS, ...paths])];
}

const SCOPE_MESSAGE_PATHS: Record<ClientMessageScope, readonly string[]> = {
  global: GLOBAL_CLIENT_MESSAGE_PATHS,
  site: withGlobalMessagePaths(PUBLIC_SITE_MESSAGE_PATHS),
  auth: withGlobalMessagePaths(AUTH_MESSAGE_PATHS),
  dashboard: withGlobalMessagePaths(DASHBOARD_MESSAGE_PATHS),
  admin: withGlobalMessagePaths(ADMIN_MESSAGE_PATHS),
};

function isRecord(value: unknown): value is MessageRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPathValue(source: MessageRecord, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current)) {
      return undefined;
    }

    return current[segment];
  }, source);
}

function setPathValue(target: MessageRecord, path: string, value: unknown): void {
  const segments = path.split('.');
  let current = target;

  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment];
    if (!isRecord(existing)) {
      current[segment] = {};
    }

    const next = current[segment];
    if (isRecord(next)) {
      current = next;
    }
  }

  current[segments[segments.length - 1]] = value;
}

function pickMessagePaths(messages: MessageRecord, paths: readonly string[]): MessageRecord {
  const selected: MessageRecord = {};

  for (const path of paths) {
    const value = getPathValue(messages, path);
    if (value !== undefined) {
      setPathValue(selected, path, value);
    }
  }

  return selected;
}

function copyPluginNamespaces(source: MessageRecord, selected: MessageRecord): void {
  for (const [key, value] of Object.entries(source)) {
    if (!HOST_MESSAGE_NAMESPACES.has(key) && isRecord(value)) {
      selected[key] = value;
    }
  }
}

export function getClientMessagesForScope(
  messages: AbstractIntlMessages,
  scope: ClientMessageScope
): AbstractIntlMessages {
  const paths = SCOPE_MESSAGE_PATHS[scope];
  const source = messages as MessageRecord;
  const selected = pickMessagePaths(source, paths);
  copyPluginNamespaces(source, selected);

  return selected as AbstractIntlMessages;
}
