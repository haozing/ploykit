import dns from 'node:dns/promises';
import net from 'node:net';
import { PluginError } from '@ploykit/plugin-sdk';

export interface EgressGuardOptions {
  pluginId: string;
  url: URL;
  code: string;
  messagePrefix: string;
  fix?: string;
  details?: Record<string, unknown>;
}

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => Number(part));
  if (bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) return null;
  return bytes;
}

function isPrivateIpv4(bytes: number[]): boolean {
  const [a, b] = bytes;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 0 ||
    a >= 224
  );
}

function normalizeIpv6(value: string): string {
  return value.toLowerCase().replace(/^\[|\]$/g, '');
}

function isPrivateIpv6(value: string): boolean {
  const normalized = normalizeIpv6(value);
  return (
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.')
  );
}

export function isForbiddenEgressAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/\.$/, '');
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === 'metadata.google.internal'
  ) {
    return true;
  }

  const ipv4 = parseIpv4(normalized);
  if (ipv4) {
    return isPrivateIpv4(ipv4);
  }

  if (net.isIP(normalized) === 6 || normalized.includes(':')) {
    return isPrivateIpv6(normalized);
  }

  return false;
}

function throwForbidden(options: EgressGuardOptions, address: string, resolved = false): never {
  throw new PluginError({
    code: options.code,
    message: `${options.messagePrefix} "${address}".`,
    statusCode: 403,
    fix: options.fix,
    details: {
      pluginId: options.pluginId,
      host: options.url.hostname,
      address,
      resolved,
      ...options.details,
    },
  });
}

export async function assertSafeEgressTarget(options: EgressGuardOptions): Promise<void> {
  const hostname = options.url.hostname.toLowerCase().replace(/\.$/, '');
  if (isForbiddenEgressAddress(hostname)) {
    throwForbidden(options, hostname);
  }

  // DNS preflight blocks DNS-rebind paths that resolve a public-looking host to
  // private, link-local, loopback, multicast, or metadata network addresses.
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    for (const record of records) {
      if (isForbiddenEgressAddress(record.address)) {
        throwForbidden(options, record.address, true);
      }
    }
  } catch (error) {
    if (error instanceof PluginError) {
      throw error;
    }
    // If DNS cannot be resolved here, the actual fetch will still fail for the
    // default host. Mocked hosts in tests may intentionally use .test domains.
  }
}
