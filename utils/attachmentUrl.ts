import { resolveMediaUrl } from '@/utils/chatMessageOwnership';

type AttachmentLike = {
  url?: string;
  path?: string;
  uri?: string;
};

/** Resolve display/upload URL for a message attachment. */
export function getAttachmentDisplayUrl(
  attachment: AttachmentLike | null | undefined,
  getBaseUrl: () => string
): string | null {
  if (!attachment) return null;
  const raw = attachment.url || attachment.path || attachment.uri || '';
  return resolveMediaUrl(raw, getBaseUrl);
}
