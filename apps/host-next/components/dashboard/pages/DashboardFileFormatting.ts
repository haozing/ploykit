import type { HostFileStorageStatus } from '@host/lib/files';
import { dashboardInlineText } from '@host/lib/dashboard-copy';
import type { SupportedLanguage } from '@host/lib/i18n';

export function formatStorageLabel(lang: SupportedLanguage, storage: HostFileStorageStatus): string {
  if (storage.durable) {
    return dashboardInlineText(lang, 'cloud_storage_fb0bba0d');
  }
  return dashboardInlineText(lang, 'local_storage_3974f971');
}

export function formatFilePurpose(lang: SupportedLanguage, value: string): string {
  const labels: Record<string, string> = {
    source: 'source_file_73f2562b',
    output: 'generated_result_4bba5c2e',
    attachment: 'attachment_60724b1b',
    avatar: 'avatar_8f6f49e2',
    document: 'document_b79f4255',
  };
  const label = labels[value];
  return label ? dashboardInlineText(lang, label) : dashboardInlineText(lang, 'file_873b4b0f');
}

export function formatFileType(lang: SupportedLanguage, value?: string | null): string {
  if (!value) {
    return dashboardInlineText(lang, 'file_873b4b0f');
  }
  if (value.startsWith('image/')) {
    return dashboardInlineText(lang, 'image_af0beeca');
  }
  if (value.startsWith('video/')) {
    return dashboardInlineText(lang, 'video_ed08debe');
  }
  if (value.startsWith('audio/')) {
    return dashboardInlineText(lang, 'audio_c00f635b');
  }
  if (value.includes('pdf')) {
    return dashboardInlineText(lang, 'document_b79f4255');
  }
  if (value.startsWith('text/')) {
    return dashboardInlineText(lang, 'text_a07b8bd6');
  }
  return dashboardInlineText(lang, 'file_873b4b0f');
}
