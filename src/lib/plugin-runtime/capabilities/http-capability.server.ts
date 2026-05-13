import { Permission, PluginError, type PluginHttp } from '@ploykit/plugin-sdk';
import { enforceCapabilityPermission, type PluginCapabilityScope } from './guards.server';
import { assertSafeEgressTarget } from './egress-guard.server';

export interface PluginHttpHost {
  fetch(url: string | URL, init?: RequestInit): Promise<Response>;
}

export interface CreatePluginHttpOptions {
  host?: Partial<PluginHttpHost>;
}

const defaultHttpHost: PluginHttpHost = {
  fetch: (url, init) => fetch(url, init),
};

function resolveHost(host?: Partial<PluginHttpHost>): PluginHttpHost {
  return {
    ...defaultHttpHost,
    ...host,
  };
}

function toUrl(input: string | URL): URL {
  try {
    return input instanceof URL ? input : new URL(input);
  } catch {
    throw new PluginError({
      code: 'PLUGIN_HTTP_URL_INVALID',
      message: `ctx.http.fetch URL must be absolute: "${String(input)}".`,
      statusCode: 400,
      fix: 'Use an absolute http(s) URL that matches one of plugin.ts egress origins.',
      details: {
        url: String(input),
      },
    });
  }
}

function toAllowedOrigin(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    return new URL(url.origin);
  } catch {
    return null;
  }
}

function isAllowedByEgress(url: URL, egress: readonly string[]): boolean {
  return egress.some((value) => {
    const allowed = toAllowedOrigin(value);
    return (
      !!allowed &&
      allowed.protocol === url.protocol &&
      allowed.hostname === url.hostname &&
      allowed.port === url.port
    );
  });
}

export function createPluginHttpCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginHttpOptions = {}
): PluginHttp {
  const host = resolveHost(options.host);

  return {
    async fetch(urlInput, init) {
      enforceCapabilityPermission(scope, Permission.ExternalHttp, 'ctx.http.fetch');
      const url = toUrl(urlInput);

      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new PluginError({
          code: 'PLUGIN_HTTP_PROTOCOL_FORBIDDEN',
          message: `ctx.http.fetch only supports http(s) URLs. Received "${url.protocol}".`,
          statusCode: 400,
          fix: 'Use an http(s) URL behind a declared egress origin.',
          details: {
            pluginId: scope.contract.id,
            protocol: url.protocol,
          },
        });
      }

      if (!isAllowedByEgress(url, scope.contract.egress)) {
        throw new PluginError({
          code: 'PLUGIN_HTTP_EGRESS_FORBIDDEN',
          message: `Plugin "${scope.contract.id}" is not allowed to fetch "${url.origin}".`,
          statusCode: 403,
          fix: `Add "${url.origin}" to plugin.ts egress and keep Permission.ExternalHttp declared.`,
          details: {
            pluginId: scope.contract.id,
            origin: url.origin,
            allowedOrigins: scope.contract.egress,
          },
        });
      }

      await assertSafeEgressTarget({
        pluginId: scope.contract.id,
        url,
        code: 'PLUGIN_HTTP_SSRF_FORBIDDEN',
        messagePrefix: `Plugin "${scope.contract.id}" cannot fetch private or metadata host`,
        fix: 'Route private-network work through an approved connector or external service boundary.',
      });

      return host.fetch(url, init);
    },
  };
}
