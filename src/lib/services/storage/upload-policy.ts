import { ValidationError } from '@/lib/_core/errors';

const MAX_FILE_NAME_LENGTH = 180;
const MAX_FOLDER_DEPTH = 5;

const MIME_EXTENSION_ALLOWLIST: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
  'application/zip': ['.zip'],
  'application/gzip': ['.gz', '.tgz'],
  'application/x-tar': ['.tar'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'text/plain': ['.txt', '.log', '.md'],
  'text/csv': ['.csv'],
  'application/json': ['.json'],
};

const ZIP_BASED_MIME_TYPES = new Set([
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const CFB_BASED_MIME_TYPES = new Set(['application/msword', 'application/vnd.ms-excel']);

export interface UploadPolicyInput {
  file: Buffer;
  originalName: string;
  mimeType?: string;
  folder?: string;
  maxFileSizeBytes: number;
}

export interface UploadPolicyResult {
  safeOriginalName: string;
  safeFolder?: string;
  contentType: string;
  detectedMimeType?: string;
  extension: string;
}

function getExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === fileName.length - 1) {
    return '';
  }

  return fileName.slice(lastDot).toLowerCase();
}

export function sanitizeFileName(originalName: string): string {
  const normalized = originalName
    .normalize('NFKC')
    .replace(/[\\/]+/g, '_')
    .trim();
  const withoutControls = normalized.replace(/[\u0000-\u001f\u007f]/g, '');
  const safe = withoutControls
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .trim();

  const fallback = safe || 'upload.bin';
  return fallback.slice(0, MAX_FILE_NAME_LENGTH);
}

export function sanitizeFolder(folder?: string): string | undefined {
  if (!folder) {
    return undefined;
  }

  const segments = folder
    .normalize('NFKC')
    .split(/[\\/]+/)
    .map((segment) =>
      segment
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^\.+/, '')
        .trim()
    )
    .filter(Boolean);

  if (segments.length === 0) {
    return undefined;
  }

  if (segments.length > MAX_FOLDER_DEPTH || segments.some((segment) => segment === '..')) {
    throw new ValidationError('Invalid upload folder');
  }

  return segments.join('/');
}

function hasPrefix(file: Buffer, bytes: number[]): boolean {
  if (file.length < bytes.length) {
    return false;
  }

  return bytes.every((byte, index) => file[index] === byte);
}

function hasAsciiAt(file: Buffer, offset: number, value: string): boolean {
  if (file.length < offset + value.length) {
    return false;
  }

  return file.subarray(offset, offset + value.length).toString('ascii') === value;
}

export function sniffMimeType(file: Buffer): string | undefined {
  if (hasPrefix(file, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (hasPrefix(file, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (hasAsciiAt(file, 0, 'GIF87a') || hasAsciiAt(file, 0, 'GIF89a')) {
    return 'image/gif';
  }
  if (hasAsciiAt(file, 0, 'RIFF') && hasAsciiAt(file, 8, 'WEBP')) {
    return 'image/webp';
  }
  if (hasAsciiAt(file, 0, '%PDF-')) {
    return 'application/pdf';
  }
  if (
    hasPrefix(file, [0x50, 0x4b, 0x03, 0x04]) ||
    hasPrefix(file, [0x50, 0x4b, 0x05, 0x06]) ||
    hasPrefix(file, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return 'application/zip';
  }
  if (hasPrefix(file, [0x1f, 0x8b])) {
    return 'application/gzip';
  }
  if (hasAsciiAt(file, 257, 'ustar')) {
    return 'application/x-tar';
  }
  if (hasPrefix(file, [0xd0, 0xcf, 0x11, 0xe0])) {
    return 'application/msword';
  }

  const sample = file.subarray(0, Math.min(file.length, 512));
  const hasBinaryControl = sample.some(
    (byte) => byte < 0x09 || (byte > 0x0d && byte < 0x20) || byte === 0x7f
  );
  if (!hasBinaryControl) {
    return 'text/plain';
  }

  return undefined;
}

function normalizeDeclaredMime(mimeType?: string): string {
  const normalized = (mimeType || '').split(';')[0].trim().toLowerCase();
  return normalized || 'application/octet-stream';
}

function isDetectedMimeCompatible(declaredMime: string, detectedMime?: string): boolean {
  if (!detectedMime) {
    return false;
  }
  if (declaredMime === detectedMime) {
    return true;
  }
  if (ZIP_BASED_MIME_TYPES.has(declaredMime) && detectedMime === 'application/zip') {
    return true;
  }
  if (CFB_BASED_MIME_TYPES.has(declaredMime) && detectedMime === 'application/msword') {
    return true;
  }
  if (
    ['text/plain', 'text/csv', 'application/json'].includes(declaredMime) &&
    detectedMime === 'text/plain'
  ) {
    return true;
  }

  return false;
}

export function validateUploadPolicy(input: UploadPolicyInput): UploadPolicyResult {
  if (input.file.length === 0) {
    throw new ValidationError('File is empty');
  }

  if (input.file.length > input.maxFileSizeBytes) {
    throw new ValidationError(
      `File too large. Maximum size is ${Math.floor(input.maxFileSizeBytes / 1024 / 1024)}MB`
    );
  }

  const safeOriginalName = sanitizeFileName(input.originalName);
  const extension = getExtension(safeOriginalName);
  const declaredMime = normalizeDeclaredMime(input.mimeType);
  const detectedMimeType = sniffMimeType(input.file);
  const contentType =
    declaredMime === 'application/octet-stream' && detectedMimeType
      ? detectedMimeType
      : declaredMime;
  const allowedExtensions = MIME_EXTENSION_ALLOWLIST[contentType];

  if (!allowedExtensions || !extension || !allowedExtensions.includes(extension)) {
    throw new ValidationError('File type or extension is not allowed');
  }

  if (!isDetectedMimeCompatible(contentType, detectedMimeType)) {
    throw new ValidationError('File content does not match the declared MIME type');
  }

  return {
    safeOriginalName,
    safeFolder: sanitizeFolder(input.folder),
    contentType,
    detectedMimeType,
    extension,
  };
}

export function sanitizeDownloadFileName(fileName: string): string {
  return sanitizeFileName(fileName).replace(/["\\\r\n]/g, '_');
}
