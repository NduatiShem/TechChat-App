import type { OutboxPayload } from '@/types/database';
import type { ChatMessage } from '@/types/chat';
import { apiMessageToChatMessage, dbMessageToChatMessage, sortMessagesByCreatedAt } from '@/types/chat';
import { dedupeMessages } from '@/utils/messageDedup';
import { isLocalPending } from '@/utils/messageIdentity';
import type { SavedMessageResult } from '@/types/database';
import {
  getMessages as getDbMessages,
  saveMessages as saveDbMessages,
} from '@/services/database';
import type { MessageWithAttachments } from '@/types/database';

export const MESSAGES_PER_PAGE = 50;
export const DELTA_POLL_INTERVAL_MS = 30_000;

export async function loadMessagesFromCache(
  conversationId: number,
  conversationType: 'individual' | 'group',
  limit = MESSAGES_PER_PAGE,
  beforeCreatedAt?: string
): Promise<ChatMessage[]> {
  const dbMessages = await getDbMessages(conversationId, conversationType, limit, 0, beforeCreatedAt);
  return sortMessagesByCreatedAt(dbMessages.map(dbMessageToChatMessage));
}

export function mergeMessagesWithPending(
  apiMessages: ChatMessage[],
  existing: ChatMessage[]
): ChatMessage[] {
  const pending = existing.filter((msg) => isLocalPending(msg));
  return sortMessagesByCreatedAt(dedupeMessages([...apiMessages, ...pending]));
}

export function mergeDeltaMessages(
  existing: ChatMessage[],
  delta: ChatMessage[]
): ChatMessage[] {
  if (delta.length === 0) return existing;
  return sortMessagesByCreatedAt(dedupeMessages([...existing, ...delta]));
}

export function mapApiMessages(raw: unknown[]): ChatMessage[] {
  return sortMessagesByCreatedAt(
    dedupeMessages(raw.map((m) => apiMessageToChatMessage(m as Record<string, unknown>)))
  );
}

export async function persistApiMessages(
  conversationId: number,
  conversationType: 'individual' | 'group',
  messages: ChatMessage[]
): Promise<void> {
  if (messages.length === 0) return;
  await saveDbMessages(
    messages.map((msg) => ({
      server_id: msg.server_id ?? msg.id,
      client_message_id: msg.client_message_id ?? null,
      conversation_id: conversationId,
      conversation_type: conversationType,
      sender_id: msg.sender_id,
      receiver_id: msg.receiver_id,
      group_id: msg.group_id,
      message: msg.message,
      created_at: msg.created_at,
      read_at: msg.read_at,
      edited_at: msg.edited_at,
      reply_to_id: msg.reply_to?.id ?? null,
      sync_status: msg.sync_status ?? 'synced',
      attachments: msg.attachments,
    }))
  );
}

export async function persistOutgoingMessage(
  conversationId: number,
  conversationType: 'individual' | 'group',
  message: {
    client_message_id: string;
    sender_id: number;
    receiver_id?: number;
    group_id?: number;
    message: string | null;
    created_at: string;
    reply_to_id?: number | null;
    attachments?: MessageWithAttachments['attachments'];
  }
): Promise<SavedMessageResult[]> {
  return saveDbMessages([
    {
      conversation_id: conversationId,
      conversation_type: conversationType,
      sender_id: message.sender_id,
      receiver_id: message.receiver_id,
      group_id: message.group_id,
      message: message.message ?? undefined,
      created_at: message.created_at,
      read_at: null,
      edited_at: null,
      reply_to_id: message.reply_to_id ?? null,
      sync_status: 'pending',
      client_message_id: message.client_message_id,
      attachments: message.attachments,
    },
  ]);
}

export function buildOutboxPayload(params: {
  messageText: string | null;
  receiverId?: number;
  groupId?: number;
  replyToId?: number | null;
  attachment?: { uri: string; name: string; type: string } | null;
  voiceRecording?: { uri: string; duration: number } | null;
}): OutboxPayload {
  const payload: OutboxPayload = {
    message: params.messageText,
    receiver_id: params.receiverId,
    group_id: params.groupId,
    reply_to_id: params.replyToId ?? null,
  };
  if (params.attachment) {
    payload.attachments = [{
      uri: params.attachment.uri,
      name: params.attachment.name || 'attachment',
      mime: params.attachment.type || 'application/octet-stream',
    }];
  }
  if (params.voiceRecording) {
    payload.attachments = [{
      uri: params.voiceRecording.uri,
      name: 'voice_message.m4a',
      mime: 'audio/m4a',
    }];
    payload.voice_duration = params.voiceRecording.duration;
    payload.is_voice_message = true;
  }
  return payload;
}

export function applyOutboxSyncToMessages(
  messages: ChatMessage[],
  event: {
    clientMessageId: string;
    localMessageId: number;
    serverId?: number;
    serverCreatedAt?: string;
    status: 'synced' | 'failed' | 'pending';
  }
): ChatMessage[] {
  const target = messages.find(
    (msg) =>
      msg.client_message_id === event.clientMessageId ||
      msg.id === event.localMessageId
  );
  if (!target) return messages;

  if (event.status === 'failed') {
    return messages.map((msg) =>
      msg.client_message_id === event.clientMessageId || msg.id === target.id
        ? { ...msg, sync_status: 'failed' as const }
        : msg
    );
  }

  if (event.status === 'synced' && event.serverId) {
    const withoutLocal = messages.filter(
      (msg) =>
        msg.client_message_id !== event.clientMessageId &&
        msg.id !== target.id &&
        msg.id !== event.serverId
    );
    const updated: ChatMessage = {
      ...target,
      id: event.serverId,
      server_id: event.serverId,
      sync_status: 'synced',
      created_at: event.serverCreatedAt || target.created_at,
    };
    return dedupeMessages([...withoutLocal, updated]);
  }

  return messages;
}
