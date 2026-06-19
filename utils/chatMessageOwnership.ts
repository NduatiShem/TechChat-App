export function isOwnDirectMessage(
  message: { sender_id?: number },
  partnerUserId: number,
  currentUserId?: number | null
): boolean {
  const senderId = Number(message.sender_id);
  const partnerId = Number(partnerUserId);
  const me = Number(currentUserId);

  if (!Number.isFinite(senderId) || senderId <= 0) {
    return false;
  }

  // Match web: isOutgoing = message.sender_id === currentUser.id
  if (Number.isFinite(me) && me > 0) {
    return senderId === me;
  }

  // Auth not ready: messages from the chat partner are incoming (not mine)
  if (partnerId > 0) {
    return senderId !== partnerId;
  }

  return false;
}

export function isIncomingFromPartner(
  message: { sender_id?: number },
  partnerUserId: number
): boolean {
  const senderId = Number(message.sender_id);
  const partnerId = Number(partnerUserId);
  return partnerId > 0 && senderId === partnerId;
}

export function getIncomingSenderDisplay(
  message: { sender_id?: number; sender?: { name?: string; avatar_url?: string } },
  partnerUserId: number,
  partnerInfo?: {
    name?: string;
    avatar_url?: string;
    user?: { name?: string; avatar_url?: string };
  } | null
): { name: string; avatarUrl?: string } {
  if (!isIncomingFromPartner(message, partnerUserId)) {
    return {
      name: message.sender?.name ?? 'User',
      avatarUrl: message.sender?.avatar_url,
    };
  }

  return {
    name:
      message.sender?.name ??
      partnerInfo?.name ??
      partnerInfo?.user?.name ??
      'User',
    avatarUrl:
      message.sender?.avatar_url ??
      partnerInfo?.avatar_url ??
      partnerInfo?.user?.avatar_url,
  };
}

function isVoiceAttachment(
  attachment: { mime?: string; type?: string; name?: string }
): boolean {
  const mime = (attachment.mime || attachment.type || '').toLowerCase();
  if (mime.startsWith('audio/')) {
    return true;
  }

  const name = (attachment.name || '').toLowerCase();
  if (/\.(ogg|opus|m4a|aac|mp3|wav|caf|amr|weba)$/i.test(name)) {
    return true;
  }

  return /recorded|voice|audio/i.test(name);
}

export function isVoicePlaceholderMessage(message: string | null | undefined): boolean {
  return /^\[VOICE_MESSAGE:\d+\]$/i.test((message || '').trim());
}

export function parseVoiceMessage(
  message: string | null | undefined,
  attachments?: Array<{ mime?: string; type?: string; url?: string; path?: string; uri?: string; name?: string }>
): {
  duration: number;
  textPart?: string;
  audioAttachment?: NonNullable<typeof attachments>[number];
} | null {
  const trimmed = (message ?? '').trim();
  const voiceMatch = trimmed.match(/\[VOICE_MESSAGE:(\d+)\]/i);
  const audioAttachment = attachments?.find((att) => isVoiceAttachment(att));

  if (!voiceMatch && !audioAttachment) {
    return null;
  }

  const duration = voiceMatch ? parseInt(voiceMatch[1], 10) : 0;
  const textPart = isVoicePlaceholderMessage(trimmed)
    ? undefined
    : trimmed.replace(/\[VOICE_MESSAGE:\d+\]/gi, '').trim() || undefined;

  return {
    duration: Number.isFinite(duration) ? duration : 0,
    textPart,
    audioAttachment,
  };
}

export function resolveMediaUrl(
  rawUrl: string | undefined | null,
  getBaseUrl: () => string
): string | null {
  if (!rawUrl || !rawUrl.trim()) {
    return null;
  }

  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://') || rawUrl.startsWith('file://')) {
    return rawUrl;
  }

  const cleanUrl = rawUrl.startsWith('/') ? rawUrl.slice(1) : rawUrl;
  return `${getBaseUrl()}/${cleanUrl}`;
}
