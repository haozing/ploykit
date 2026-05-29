import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import productPresentation from '../../../../product.presentation';

export interface BrandAssetSvgSecurity {
  safe: boolean;
  issues: readonly string[];
}

export interface BrandAssetManifestEntry {
  key: string;
  path: string;
  locale?: string;
  kind: 'logo' | 'mark' | 'favicon' | 'app-icon' | 'social' | 'email';
  required: boolean;
  exists: boolean;
  remote: boolean;
  withinPublicRoot: boolean;
  extension: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  sha256: string | null;
  svgSecurity: BrandAssetSvgSecurity | null;
}

export interface BrandAssetManifest {
  kind: 'ploykit.brand-assets.manifest';
  entries: readonly BrandAssetManifestEntry[];
  diagnostics: readonly BrandAssetDiagnostic[];
}

export interface BrandAssetDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path: string;
}

interface LocalAssetInspection {
  exists: boolean;
  withinPublicRoot: boolean;
  absolutePath: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  sha256: string | null;
  svgSecurity: BrandAssetSvgSecurity | null;
}

const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const FORMAT_BY_KIND: Record<BrandAssetManifestEntry['kind'], readonly string[]> = {
  logo: ['.svg', '.png', '.webp'],
  mark: ['.svg', '.png', '.webp'],
  favicon: ['.ico', '.svg', '.png'],
  'app-icon': ['.png', '.webp', '.svg'],
  social: ['.png', '.jpg', '.jpeg', '.webp'],
  email: ['.png', '.jpg', '.jpeg', '.webp'],
};
const MIME_BY_EXTENSION: Record<string, readonly string[]> = {
  '.ico': ['image/x-icon', 'image/vnd.microsoft.icon'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.svg': ['image/svg+xml'],
  '.webp': ['image/webp'],
};

function isRemote(assetPath: string): boolean {
  return assetPath.startsWith('http://') || assetPath.startsWith('https://');
}

function publicRoot(): string {
  return path.resolve(process.cwd(), 'apps', 'host-next', 'public');
}

function extensionFor(assetPath: string): string {
  return path.extname(new URL(assetPath, 'http://localhost').pathname).toLowerCase();
}

function publicAssetPath(assetPath: string): {
  absolutePath: string;
  withinPublicRoot: boolean;
} {
  const root = publicRoot();
  const pathname = new URL(assetPath, 'http://localhost').pathname;
  let decodedPathname = pathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    decodedPathname = pathname;
  }
  const relativePath = decodedPathname.startsWith('/')
    ? decodedPathname.slice(1)
    : decodedPathname;
  const absolutePath = path.resolve(root, relativePath);
  const withinPublicRoot = absolutePath === root || absolutePath.startsWith(`${root}${path.sep}`);
  return { absolutePath, withinPublicRoot };
}

function mimeTypeFor(buffer: Buffer, extension: string): string | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (extension === '.svg' && buffer.toString('utf8', 0, Math.min(buffer.length, 512)).includes('<svg')) {
    return 'image/svg+xml';
  }
  if (extension === '.ico') {
    return 'image/x-icon';
  }
  return null;
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || mimeTypeFor(buffer, '.png') !== 'image/png') {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      break;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) {
      break;
    }
    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf
    ) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function readWebpDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (
    buffer.length < 30 ||
    buffer.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    buffer.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    return null;
  }
  const chunk = buffer.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X') {
    return {
      width: buffer.readUIntLE(24, 3) + 1,
      height: buffer.readUIntLE(27, 3) + 1,
    };
  }
  return null;
}

function numberFromDimension(value: string | undefined): number | null {
  const match = value?.trim().match(/^([0-9]+(?:\.[0-9]+)?)/);
  return match ? Number(match[1]) : null;
}

function readSvgDimensions(source: string): { width: number | null; height: number | null } {
  const svgTag = source.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const width = numberFromDimension(svgTag.match(/\bwidth=["']([^"']+)["']/i)?.[1]);
  const height = numberFromDimension(svgTag.match(/\bheight=["']([^"']+)["']/i)?.[1]);
  if (width && height) {
    return { width, height };
  }
  const viewBox = svgTag.match(/\bviewBox=["']([^"']+)["']/i)?.[1];
  const values = viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((item) => Number.isFinite(item));
  if (values && values.length === 4) {
    return {
      width: values[2],
      height: values[3],
    };
  }
  return { width: null, height: null };
}

function scanSvgSecurity(source: string): BrandAssetSvgSecurity {
  const issues: string[] = [];
  const checks: Array<[RegExp, string]> = [
    [/<script\b/i, 'script'],
    [/<foreignObject\b/i, 'foreignObject'],
    [/<iframe\b/i, 'iframe'],
    [/<object\b/i, 'object'],
    [/<embed\b/i, 'embed'],
    [/\son[a-z]+\s*=/i, 'eventHandler'],
    [/(?:href|xlink:href|src)\s*=\s*["']\s*(?:https?:|\/\/|data:|javascript:)/i, 'externalReference'],
    [/url\(\s*['"]?\s*(?:https?:|\/\/|data:|javascript:)/i, 'externalCssReference'],
  ];
  for (const [pattern, issue] of checks) {
    if (pattern.test(source)) {
      issues.push(issue);
    }
  }
  return {
    safe: issues.length === 0,
    issues,
  };
}

function dimensionsFor(buffer: Buffer, mimeType: string | null): { width: number | null; height: number | null } {
  if (mimeType === 'image/png') {
    return readPngDimensions(buffer) ?? { width: null, height: null };
  }
  if (mimeType === 'image/jpeg') {
    return readJpegDimensions(buffer) ?? { width: null, height: null };
  }
  if (mimeType === 'image/webp') {
    return readWebpDimensions(buffer) ?? { width: null, height: null };
  }
  if (mimeType === 'image/svg+xml') {
    return readSvgDimensions(buffer.toString('utf8'));
  }
  return { width: null, height: null };
}

function inspectLocalAsset(assetPath: string, extension: string): LocalAssetInspection {
  const resolved = publicAssetPath(assetPath);
  if (!resolved.withinPublicRoot) {
    return {
      exists: false,
      withinPublicRoot: false,
      absolutePath: resolved.absolutePath,
      mimeType: null,
      width: null,
      height: null,
      sizeBytes: null,
      sha256: null,
      svgSecurity: null,
    };
  }
  if (!fs.existsSync(resolved.absolutePath)) {
    return {
      exists: false,
      withinPublicRoot: true,
      absolutePath: resolved.absolutePath,
      mimeType: null,
      width: null,
      height: null,
      sizeBytes: null,
      sha256: null,
      svgSecurity: null,
    };
  }

  const buffer = fs.readFileSync(resolved.absolutePath);
  const mimeType = mimeTypeFor(buffer, extension);
  const dimensions = dimensionsFor(buffer, mimeType);
  return {
    exists: true,
    withinPublicRoot: true,
    absolutePath: resolved.absolutePath,
    mimeType,
    width: dimensions.width,
    height: dimensions.height,
    sizeBytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    svgSecurity: mimeType === 'image/svg+xml' ? scanSvgSecurity(buffer.toString('utf8')) : null,
  };
}

function entry(input: {
  key: string;
  path?: string | null;
  locale?: string;
  kind: BrandAssetManifestEntry['kind'];
  required?: boolean;
}): BrandAssetManifestEntry | null {
  if (!input.path) {
    return null;
  }
  const extension = extensionFor(input.path);
  const remote = isRemote(input.path);
  const inspection = remote
    ? null
    : inspectLocalAsset(input.path, extension);

  return {
    key: input.key,
    path: input.path,
    locale: input.locale,
    kind: input.kind,
    required: input.required ?? true,
    exists: remote || inspection?.exists === true,
    remote,
    withinPublicRoot: remote || inspection?.withinPublicRoot === true,
    extension,
    mimeType: inspection?.mimeType ?? null,
    width: inspection?.width ?? null,
    height: inspection?.height ?? null,
    sizeBytes: inspection?.sizeBytes ?? null,
    sha256: inspection?.sha256 ?? null,
    svgSecurity: inspection?.svgSecurity ?? null,
  };
}

function addDiagnostic(
  diagnostics: BrandAssetDiagnostic[],
  severity: BrandAssetDiagnostic['severity'],
  code: string,
  message: string,
  diagnosticPath: string
): void {
  diagnostics.push({ severity, code, message, path: diagnosticPath });
}

function validateDimensions(
  diagnostics: BrandAssetDiagnostic[],
  asset: BrandAssetManifestEntry
): void {
  if (asset.remote || !asset.exists) {
    return;
  }
  const diagnosticPath = `brand.${asset.key}`;
  if (asset.width === null || asset.height === null) {
    addDiagnostic(
      diagnostics,
      'warning',
      'BRAND_ASSET_DIMENSIONS_UNKNOWN',
      `Brand asset "${asset.path}" dimensions could not be read.`,
      diagnosticPath
    );
    return;
  }

  if (asset.kind === 'social' && (asset.width !== 1200 || asset.height !== 630)) {
    addDiagnostic(
      diagnostics,
      'error',
      'BRAND_SOCIAL_IMAGE_DIMENSIONS_INVALID',
      `Social image "${asset.path}" must be 1200x630, got ${asset.width}x${asset.height}.`,
      diagnosticPath
    );
  }
  if (
    asset.kind === 'app-icon' &&
    (asset.width !== asset.height || asset.width < 192 || asset.height < 192)
  ) {
    addDiagnostic(
      diagnostics,
      'error',
      'BRAND_APP_ICON_DIMENSIONS_INVALID',
      `App icon "${asset.path}" must be a square image at least 192x192, got ${asset.width}x${asset.height}.`,
      diagnosticPath
    );
  }
  if (asset.kind === 'favicon' && (asset.width !== asset.height || asset.width < 32)) {
    addDiagnostic(
      diagnostics,
      'warning',
      'BRAND_FAVICON_DIMENSIONS_REVIEW',
      `Favicon "${asset.path}" should be square and at least 32x32, got ${asset.width}x${asset.height}.`,
      diagnosticPath
    );
  }
  if (asset.kind === 'mark' && (asset.width !== asset.height || asset.width < 32)) {
    addDiagnostic(
      diagnostics,
      'warning',
      'BRAND_MARK_DIMENSIONS_REVIEW',
      `Logo mark "${asset.path}" should be square and at least 32x32, got ${asset.width}x${asset.height}.`,
      diagnosticPath
    );
  }
  if (asset.kind === 'logo' && (asset.width < 128 || asset.height < 32)) {
    addDiagnostic(
      diagnostics,
      'warning',
      'BRAND_LOGO_DIMENSIONS_REVIEW',
      `Logo "${asset.path}" should be at least 128x32, got ${asset.width}x${asset.height}.`,
      diagnosticPath
    );
  }
}

function validateEntry(asset: BrandAssetManifestEntry): BrandAssetDiagnostic[] {
  const diagnostics: BrandAssetDiagnostic[] = [];
  const diagnosticPath = `brand.${asset.key}`;

  if (!asset.withinPublicRoot) {
    addDiagnostic(
      diagnostics,
      'error',
      'BRAND_ASSET_PATH_OUTSIDE_PUBLIC',
      `Brand asset "${asset.path}" must resolve under apps/host-next/public.`,
      diagnosticPath
    );
  }
  if (asset.required && !asset.exists) {
    addDiagnostic(
      diagnostics,
      'error',
      'BRAND_ASSET_MISSING',
      `Brand asset "${asset.path}" does not exist under apps/host-next/public.`,
      diagnosticPath
    );
  }
  if (asset.remote) {
    addDiagnostic(
      diagnostics,
      'warning',
      'BRAND_REMOTE_ASSET_UNVERIFIED',
      `Remote brand asset "${asset.path}" cannot be checked for dimensions, MIME, digest, or SVG safety.`,
      diagnosticPath
    );
    return diagnostics;
  }
  if (!asset.exists) {
    return diagnostics;
  }

  const allowedFormats = FORMAT_BY_KIND[asset.kind];
  if (!allowedFormats.includes(asset.extension)) {
    addDiagnostic(
      diagnostics,
      asset.kind === 'social' || asset.kind === 'app-icon' ? 'error' : 'warning',
      'BRAND_ASSET_FORMAT_INVALID',
      `Brand asset "${asset.path}" has extension "${asset.extension || '(none)'}"; expected one of ${allowedFormats.join(', ')}.`,
      diagnosticPath
    );
  }
  const expectedMimeTypes = MIME_BY_EXTENSION[asset.extension];
  if (!asset.mimeType || (expectedMimeTypes && !expectedMimeTypes.includes(asset.mimeType))) {
    addDiagnostic(
      diagnostics,
      'error',
      'BRAND_ASSET_MIME_INVALID',
      `Brand asset "${asset.path}" MIME/signature does not match its extension.`,
      diagnosticPath
    );
  }
  if (asset.sizeBytes !== null && asset.sizeBytes > MAX_ASSET_BYTES) {
    addDiagnostic(
      diagnostics,
      'warning',
      'BRAND_ASSET_SIZE_REVIEW',
      `Brand asset "${asset.path}" is larger than ${MAX_ASSET_BYTES} bytes.`,
      diagnosticPath
    );
  }
  if (asset.svgSecurity && !asset.svgSecurity.safe) {
    addDiagnostic(
      diagnostics,
      'error',
      'BRAND_SVG_UNSAFE',
      `SVG brand asset "${asset.path}" contains unsafe constructs: ${asset.svgSecurity.issues.join(', ')}.`,
      diagnosticPath
    );
  }
  validateDimensions(diagnostics, asset);
  return diagnostics;
}

export function createBrandAssetManifest(): BrandAssetManifest {
  const brand = productPresentation.definition.brand;
  const og = brand?.openGraphImage;
  const entries = [
    entry({ key: 'logo.light', path: brand?.logo?.light, kind: 'logo' }),
    entry({ key: 'logo.dark', path: brand?.logo?.dark, kind: 'logo' }),
    entry({ key: 'logo.mark', path: brand?.logo?.mark, kind: 'mark' }),
    entry({ key: 'favicon', path: brand?.favicon, kind: 'favicon' }),
    entry({ key: 'manifestIcon', path: brand?.manifestIcon, kind: 'app-icon' }),
    typeof og === 'string'
      ? entry({ key: 'openGraphImage.default', path: og, kind: 'social' })
      : entry({ key: 'openGraphImage.default', path: og?.default, kind: 'social' }),
    ...(typeof og === 'object' && og
      ? Object.entries(og)
          .filter(([locale]) => locale !== 'default')
          .map(([locale, assetPath]) =>
            entry({
              key: `openGraphImage.${locale}`,
              path: assetPath,
              locale,
              kind: 'social',
            })
          )
      : []),
  ].filter((item): item is BrandAssetManifestEntry => Boolean(item));
  const diagnostics = entries.flatMap(validateEntry);

  return {
    kind: 'ploykit.brand-assets.manifest',
    entries,
    diagnostics,
  };
}
