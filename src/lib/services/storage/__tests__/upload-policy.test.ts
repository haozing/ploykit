import { describe, expect, it } from 'vitest';
import {
  sanitizeDownloadFileName,
  sanitizeFileName,
  sanitizeFolder,
  sniffMimeType,
  validateUploadPolicy,
} from '../upload-policy';

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

describe('upload policy', () => {
  it('sanitizes file names and folders', () => {
    expect(sanitizeFileName('../my report?.png')).toBe('_my report_.png');
    expect(sanitizeFolder('../team uploads\\2026')).toBe('team_uploads/2026');
    expect(sanitizeDownloadFileName('bad"\r\nname.png')).toBe('bad_name.png');
  });

  it('sniffs common binary MIME types', () => {
    expect(sniffMimeType(PNG_BYTES)).toBe('image/png');
    expect(sniffMimeType(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
    expect(sniffMimeType(Buffer.from('hello,world\n'))).toBe('text/plain');
  });

  it('accepts files when extension, declared MIME, and content agree', () => {
    const result = validateUploadPolicy({
      file: PNG_BYTES,
      originalName: '../avatar.png',
      mimeType: 'image/png',
      folder: 'avatars',
      maxFileSizeBytes: 1024,
    });

    expect(result).toEqual(
      expect.objectContaining({
        safeOriginalName: '_avatar.png',
        safeFolder: 'avatars',
        contentType: 'image/png',
        detectedMimeType: 'image/png',
        extension: '.png',
      })
    );
  });

  it('rejects files before blob write when MIME does not match content', () => {
    expect(() =>
      validateUploadPolicy({
        file: PNG_BYTES,
        originalName: 'avatar.pdf',
        mimeType: 'application/pdf',
        maxFileSizeBytes: 1024,
      })
    ).toThrow('File content does not match the declared MIME type');
  });

  it('rejects unsupported extensions', () => {
    expect(() =>
      validateUploadPolicy({
        file: Buffer.from('echo hello'),
        originalName: 'script.sh',
        mimeType: 'text/plain',
        maxFileSizeBytes: 1024,
      })
    ).toThrow('File type or extension is not allowed');
  });

  it('rejects files over the configured size limit', () => {
    expect(() =>
      validateUploadPolicy({
        file: Buffer.alloc(4),
        originalName: 'small.txt',
        mimeType: 'text/plain',
        maxFileSizeBytes: 3,
      })
    ).toThrow('File too large');
  });
});
