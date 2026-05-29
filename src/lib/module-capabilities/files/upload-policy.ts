import path from 'node:path';
import type { ModuleFileCreateUploadInput, ModuleFileVisibility } from '@ploykit/module-sdk';

export interface ModuleFileAntivirusInput {
  fileId?: string;
  storageKey?: string;
  checksum?: string;
  name: string;
  contentType?: string;
  sizeBytes: number;
  metadata?: Record<string, unknown>;
}

export interface ModuleFileUploadPolicy {
  maxBytes?: number;
  allowedMimeTypes?: readonly string[];
  allowedExtensions?: readonly string[];
  defaultVisibility?: ModuleFileVisibility;
  allowPublic?: boolean;
  antivirus?: (input: ModuleFileAntivirusInput) => Promise<
    { ok: true } | { ok: false; reason: string }
  >;
}

const inferredContentTypes: Record<string, string> = {
  '.csv': 'text/csv',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.png': 'image/png',
  '.txt': 'text/plain',
};

export function inferModuleFileContentType(name: string): string | undefined {
  return inferredContentTypes[path.extname(name).toLowerCase()];
}

export function validateModuleFileUploadPolicy(
  policy: ModuleFileUploadPolicy,
  input: ModuleFileCreateUploadInput & {
    actualSizeBytes?: number;
    observedContentType?: string;
  },
  options: { requireContentType?: boolean } = {}
): void {
  const sizeBytes = input.actualSizeBytes ?? input.sizeBytes ?? 0;
  if (policy.maxBytes !== undefined && sizeBytes > policy.maxBytes) {
    throw new Error('MODULE_FILE_UPLOAD_TOO_LARGE');
  }

  const contentType = input.observedContentType ?? input.contentType;
  if (policy.allowedMimeTypes && !contentType && options.requireContentType) {
    throw new Error('MODULE_FILE_UPLOAD_MIME_REQUIRED');
  }

  if (policy.allowedMimeTypes && contentType && !policy.allowedMimeTypes.includes(contentType)) {
    throw new Error('MODULE_FILE_UPLOAD_MIME_DENIED');
  }

  if (policy.allowedExtensions) {
    const extension = path.extname(input.name).toLowerCase();
    const allowed = policy.allowedExtensions.map((item) =>
      item.startsWith('.') ? item.toLowerCase() : `.${item.toLowerCase()}`
    );
    if (!allowed.includes(extension)) {
      throw new Error('MODULE_FILE_UPLOAD_EXTENSION_DENIED');
    }
  }

  if (input.visibility === 'public' && policy.allowPublic === false) {
    throw new Error('MODULE_FILE_UPLOAD_PUBLIC_DENIED');
  }
}

export async function runModuleFileAntivirusPolicy(
  policy: ModuleFileUploadPolicy,
  input: ModuleFileAntivirusInput
): Promise<void> {
  if (!policy.antivirus) {
    return;
  }
  const result = await policy.antivirus(input);
  if (!result.ok) {
    throw new Error(`MODULE_FILE_UPLOAD_ANTIVIRUS_DENIED: ${result.reason}`);
  }
}
