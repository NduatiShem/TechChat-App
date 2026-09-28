import { isSupportedShareMime } from '@/constants/androidShareMimeTypes';

const EXTENSION_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

export function resolveShareMime(mimeType: string | null | undefined, fileName: string): string {
  const normalized = mimeType?.trim() || 'application/octet-stream';
  if (normalized !== 'application/octet-stream' && isSupportedShareMime(normalized)) {
    return normalized;
  }

  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext && EXTENSION_MIME[ext]) {
    return EXTENSION_MIME[ext];
  }

  return normalized;
}

export function isShareFileAllowed(mimeType: string, fileName: string): boolean {
  const resolved = resolveShareMime(mimeType, fileName);
  return isSupportedShareMime(resolved);
}
