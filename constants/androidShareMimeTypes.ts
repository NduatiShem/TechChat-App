/** MIME types registered for Android SEND / SEND_MULTIPLE intent filters. */
export const ANDROID_SHARE_INTENT_FILTERS = [
  'text/plain',
  'text/*',
  'image/*',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

const SUPPORTED_EXACT = new Set<string>([
  ...ANDROID_SHARE_INTENT_FILTERS,
]);

const SUPPORTED_PREFIXES = ['image/', 'text/'];

export function isSupportedShareMime(mime?: string | null): boolean {
  if (!mime) return false;
  if (SUPPORTED_EXACT.has(mime)) return true;
  return SUPPORTED_PREFIXES.some((prefix) => mime.startsWith(prefix));
}
