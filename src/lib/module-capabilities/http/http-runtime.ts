import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { Readable } from 'node:stream';
import type { ModuleHttpApi } from '@ploykit/module-sdk';

export interface ModuleHttpRuntimeOptions {
  moduleId: string;
  allowedOrigins: readonly string[];
  fetchImpl?: typeof fetch;
  maxBodyBytes?: number;
  maxResponseBytes?: number;
  timeoutMs?: number;
  allowedMethods?: readonly string[];
  redirect?: 'deny' | 'manual' | 'follow-same-origin';
  allowPrivateNetwork?: boolean;
  resolveHost?: (hostname: string) => Promise<readonly string[]>;
}

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'host',
  'proxy-authorization',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
]);

function requestUrl(input: string | URL | Request): URL {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  return new URL(input);
}

function requestMethod(input: string | URL | Request, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function bodySize(body: RequestInit['body'] | undefined | null): number | undefined {
  if (!body) {
    return 0;
  }
  if (typeof body === 'string') {
    return Buffer.byteLength(body);
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return body.byteLength;
  }
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return Buffer.byteLength(body.toString());
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return body.size;
  }
  return undefined;
}

function requestHeaders(input: string | URL | Request, init?: RequestInit): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  return headers;
}

function hasSensitiveHeaders(headers: Headers): string | undefined {
  for (const key of headers.keys()) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      return key;
    }
  }
  return undefined;
}

function parseIpv4(address: string): number | undefined {
  if (net.isIP(address) !== 4) {
    return undefined;
  }
  return address
    .split('.')
    .map(Number)
    .reduce((value, octet) => (value << 8) + octet, 0) >>> 0;
}

function inIpv4Range(address: number, base: string, bits: number): boolean {
  const parsedBase = parseIpv4(base);
  if (parsedBase === undefined) {
    return false;
  }
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (address & mask) === (parsedBase & mask);
}

function isPrivateAddress(address: string): boolean {
  const cleanAddress = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  if (cleanAddress !== address) {
    return isPrivateAddress(cleanAddress);
  }
  const kind = net.isIP(address);
  if (kind === 4) {
    const value = parseIpv4(address);
    return (
      value === undefined ||
      inIpv4Range(value, '0.0.0.0', 8) ||
      inIpv4Range(value, '10.0.0.0', 8) ||
      inIpv4Range(value, '100.64.0.0', 10) ||
      inIpv4Range(value, '127.0.0.0', 8) ||
      inIpv4Range(value, '169.254.0.0', 16) ||
      inIpv4Range(value, '172.16.0.0', 12) ||
      inIpv4Range(value, '192.0.0.0', 24) ||
      inIpv4Range(value, '192.168.0.0', 16) ||
      inIpv4Range(value, '198.18.0.0', 15) ||
      inIpv4Range(value, '224.0.0.0', 4)
    );
  }
  if (kind === 6) {
    const normalized = address.toLowerCase();
    const mappedIpv4 = ipv4FromMappedIpv6(normalized);
    if (mappedIpv4) {
      return isPrivateAddress(mappedIpv4);
    }
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fe80:') ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('ff')
    );
  }
  return false;
}

function ipv4FromMappedIpv6(address: string): string | undefined {
  const dotted = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted && net.isIP(dotted[1]) === 4) {
    return dotted[1];
  }

  const hex = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) {
    return undefined;
  }
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  if (!Number.isInteger(high) || !Number.isInteger(low) || high > 0xffff || low > 0xffff) {
    return undefined;
  }
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

async function defaultResolveHost(hostname: string): Promise<readonly string[]> {
  const cleanHostname =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (net.isIP(cleanHostname)) {
    return [cleanHostname];
  }
  const records = await dns.lookup(cleanHostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

async function resolvePinnedAddresses(
  moduleId: string,
  url: URL,
  resolveHost: (hostname: string) => Promise<readonly string[]>,
  allowPrivateNetwork: boolean
): Promise<readonly string[]> {
  const addresses = await resolveHost(url.hostname);
  if (addresses.length === 0 || addresses.some((address) => net.isIP(address) === 0)) {
    throw new Error(`MODULE_HTTP_DNS_INVALID: ${moduleId} -> ${url.hostname}`);
  }
  if (!allowPrivateNetwork && addresses.some(isPrivateAddress)) {
    throw new Error(`MODULE_HTTP_PRIVATE_NETWORK_DENIED: ${moduleId} -> ${url.hostname}`);
  }
  return addresses;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('MODULE_HTTP_TIMEOUT');
}

function createRuntimeAbortSignal(
  timeoutMs: number,
  existing?: AbortSignal
): { signal: AbortSignal; cleanup(): void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('MODULE_HTTP_TIMEOUT')), timeoutMs);
  const abort = () => controller.abort(existing?.reason ?? new Error('MODULE_HTTP_ABORTED'));
  if (existing?.aborted) {
    abort();
  } else {
    existing?.addEventListener('abort', abort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      existing?.removeEventListener('abort', abort);
    },
  };
}

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throw abortReason(signal);
  }
  let abort: (() => void) | undefined;
  const aborted = new Promise<T>((_resolve, reject) => {
    abort = () => reject(abortReason(signal));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (abort) {
      signal.removeEventListener('abort', abort);
    }
  }
}

async function streamWithinLimit(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal: AbortSignal,
  errorCode: string
): Promise<Uint8Array[]> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const read = await withAbort(reader.read(), signal);
      if (read.done) {
        break;
      }
      total += read.value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new Error(errorCode);
      }
      chunks.push(read.value);
    }
    return chunks;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The stream may already be cancelling after a size-limit violation.
    }
  }
}

async function assertRequestBodyWithinLimit(
  input: string | URL | Request,
  init: RequestInit | undefined,
  maxBytes: number,
  moduleId: string,
  signal: AbortSignal
): Promise<void> {
  const initSize = bodySize(init?.body);
  if (init?.body && initSize === undefined) {
    throw new Error(`MODULE_HTTP_BODY_UNSUPPORTED: ${moduleId}`);
  }
  if (initSize !== undefined && initSize > maxBytes) {
    throw new Error(`MODULE_HTTP_BODY_TOO_LARGE: ${moduleId}`);
  }
  if (init?.body || !(input instanceof Request) || !input.body) {
    return;
  }

  const method = requestMethod(input, init);
  if (method === 'GET' || method === 'HEAD') {
    return;
  }

  const contentLength = input.headers.get('content-length');
  if (contentLength) {
    const declaredSize = Number(contentLength);
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
      throw new Error(`MODULE_HTTP_BODY_TOO_LARGE: ${moduleId}`);
    }
  }

  let clone: Request;
  try {
    clone = input.clone();
  } catch {
    throw new Error(`MODULE_HTTP_BODY_UNREADABLE: ${moduleId}`);
  }
  if (!clone.body) {
    return;
  }
  await streamWithinLimit(clone.body, maxBytes, signal, `MODULE_HTTP_BODY_TOO_LARGE: ${moduleId}`);
}

async function bufferFromBody(body: RequestInit['body'] | undefined | null): Promise<Buffer | undefined> {
  if (!body) {
    return undefined;
  }
  if (typeof body === 'string') {
    return Buffer.from(body);
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(body);
  }
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength);
  }
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return Buffer.from(body.toString());
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer());
  }
  throw new Error('MODULE_HTTP_BODY_UNSUPPORTED');
}

async function requestBodyBuffer(
  input: string | URL | Request,
  init: RequestInit | undefined,
  method: string
): Promise<Buffer | undefined> {
  const initBody = await bufferFromBody(init?.body);
  if (initBody || init?.body) {
    return initBody;
  }
  if (!(input instanceof Request) || !input.body || method === 'GET' || method === 'HEAD') {
    return undefined;
  }
  return Buffer.from(await input.clone().arrayBuffer());
}

function headersToNode(headers: Headers): http.OutgoingHttpHeaders {
  const output: http.OutgoingHttpHeaders = {};
  headers.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}

function responseHeadersFromNode(headers: http.IncomingHttpHeaders): Headers {
  const output = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    output.set(key, Array.isArray(value) ? value.join(', ') : String(value));
  }
  return output;
}

async function fetchWithPinnedDns(input: {
  url: URL;
  method: string;
  headers: Headers;
  body: Buffer | undefined;
  signal: AbortSignal;
  addresses: readonly string[];
}): Promise<Response> {
  if (input.url.protocol !== 'http:' && input.url.protocol !== 'https:') {
    throw new Error(`MODULE_HTTP_PROTOCOL_DENIED: ${input.url.protocol}`);
  }
  if (input.addresses.length === 0) {
    throw new Error(`MODULE_HTTP_DNS_EMPTY: ${input.url.hostname}`);
  }
  if (input.addresses.some((address) => net.isIP(address) === 0)) {
    throw new Error(`MODULE_HTTP_DNS_INVALID: ${input.url.hostname}`);
  }

  const client = input.url.protocol === 'https:' ? https : http;
  let addressIndex = 0;
  const lookup: http.RequestOptions['lookup'] = (_hostname, options, callback) => {
    const lookupOptions = options as { all?: boolean };
    if (lookupOptions.all) {
      callback(
        null,
        input.addresses.map((address) => ({ address, family: net.isIP(address) }))
      );
      return;
    }
    const address = input.addresses[addressIndex % input.addresses.length];
    addressIndex += 1;
    callback(null, address, net.isIP(address));
  };

  return new Promise<Response>((resolve, reject) => {
    const request = client.request(
      {
        protocol: input.url.protocol,
        hostname: input.url.hostname,
        port: input.url.port,
        path: `${input.url.pathname}${input.url.search}`,
        method: input.method,
        headers: headersToNode(input.headers),
        lookup,
        servername: net.isIP(input.url.hostname) ? undefined : input.url.hostname,
        signal: input.signal,
      },
      (response) => {
        resolve(
          new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
            status: response.statusCode ?? 200,
            statusText: response.statusMessage,
            headers: responseHeadersFromNode(response.headers),
          })
        );
      }
    );
    request.once('error', reject);
    request.end(input.body);
  });
}

async function responseWithinLimit(
  response: Response,
  maxBytes: number,
  signal: AbortSignal
): Promise<Response> {
  const contentLength = response.headers.get('content-length');
  const declaredSize = contentLength ? Number(contentLength) : undefined;
  if (declaredSize !== undefined && Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw new Error('MODULE_HTTP_RESPONSE_TOO_LARGE');
  }
  if (!response.body) {
    return response;
  }

  const chunks = await streamWithinLimit(
    response.body,
    maxBytes,
    signal,
    'MODULE_HTTP_RESPONSE_TOO_LARGE'
  );

  return new Response(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function createModuleHttpApi(options: ModuleHttpRuntimeOptions): ModuleHttpApi {
  const allowedOrigins = new Set(options.allowedOrigins);
  const allowedMethods = new Set(
    (options.allowedMethods ?? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).map((method) =>
      method.toUpperCase()
    )
  );
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  const maxResponseBytes = options.maxResponseBytes ?? 2 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const redirect = options.redirect ?? 'manual';
  const resolveHost = options.resolveHost ?? defaultResolveHost;

  return {
    async fetch(input, init) {
      const url = requestUrl(input);
      const method = requestMethod(input, init);
      const headers = requestHeaders(input, init);
      const customFetchImpl = options.fetchImpl;
      const abort = createRuntimeAbortSignal(
        timeoutMs,
        init?.signal ?? (input instanceof Request ? input.signal : undefined)
      );

      try {
        if (!allowedOrigins.has(url.origin)) {
          throw new Error(`MODULE_HTTP_EGRESS_DENIED: ${options.moduleId} -> ${url.origin}`);
        }

        if (!allowedMethods.has(method)) {
          throw new Error(`MODULE_HTTP_METHOD_DENIED: ${method}`);
        }

        await assertRequestBodyWithinLimit(
          input,
          init,
          maxBodyBytes,
          options.moduleId,
          abort.signal
        );

        const sensitiveHeader = hasSensitiveHeaders(headers);
        if (sensitiveHeader) {
          throw new Error(`MODULE_HTTP_HEADER_DENIED: ${sensitiveHeader}`);
        }

        const addresses = await withAbort(
          resolvePinnedAddresses(
            options.moduleId,
            url,
            resolveHost,
            options.allowPrivateNetwork === true
          ),
          abort.signal
        );

        const response = await withAbort(
          customFetchImpl
            ? customFetchImpl(input, {
                ...init,
                redirect:
                  redirect === 'follow-same-origin' || redirect === 'deny' ? 'manual' : redirect,
                signal: abort.signal,
              })
            : fetchWithPinnedDns({
                url,
                method,
                headers,
                body: await withAbort(requestBodyBuffer(input, init, method), abort.signal),
                signal: abort.signal,
                addresses,
              }),
          abort.signal
        );

        const location = response.headers.get('location');
        if (location && response.status >= 300 && response.status < 400) {
          const redirectUrl = new URL(location, url);
          if (redirect === 'deny') {
            throw new Error('MODULE_HTTP_REDIRECT_DENIED');
          }
          if (redirect === 'follow-same-origin' && redirectUrl.origin !== url.origin) {
            throw new Error(`MODULE_HTTP_REDIRECT_ORIGIN_DENIED: ${redirectUrl.origin}`);
          }
          if (!allowedOrigins.has(redirectUrl.origin)) {
            throw new Error(
              `MODULE_HTTP_EGRESS_DENIED: ${options.moduleId} -> ${redirectUrl.origin}`
            );
          }
          if (options.allowPrivateNetwork !== true) {
            await withAbort(
              resolvePinnedAddresses(options.moduleId, redirectUrl, resolveHost, false),
              abort.signal
            );
          }
        }

        return responseWithinLimit(response, maxResponseBytes, abort.signal);
      } finally {
        abort.cleanup();
      }
    },
  };
}
