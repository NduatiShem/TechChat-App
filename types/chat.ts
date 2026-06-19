import type { MessageWithAttachments } from '@/types/database';

export interface ChatMessage {
  id: number;
  server_id?: number;
  client_message_id?: string | null;
  message: string;
  sender_id: number;
  receiver_id?: number;
  group_id?: number;
  created_at: string;
  read_at?: string | null;
  edited_at?: string | null;
  sync_status?: 'synced' | 'pending' | 'failed';
  attachments?: {
    id: number;
    name: string;
    mime: string;
    url: string;
    path?: string;
    uri?: string;
    size?: number;
    type?: string;
    isImage?: boolean;
  }[];
  voice_message?: {
    url: string;
    duration: number;
  };
  sender?: {
    id: number;
    name: string;
    avatar_url?: string;
  };
  reply_to?: {
    id: number;
    message: string;
    sender: {
      id: number;
      name: string;
    };
    attachments?: {
      id: number;
      name: string;
      mime: string;
      url: string;
    }[];
    created_at: string;
  };
}

export function dbMessageToChatMessage(msg: MessageWithAttachments): ChatMessage {
  return {
    id: msg.server_id ?? msg.id,
    server_id: msg.server_id,
    client_message_id: msg.client_message_id,
    message: msg.message || '',
    sender_id: msg.sender_id,
    receiver_id: msg.receiver_id,
    group_id: msg.group_id,
    created_at: msg.created_at,
    read_at: msg.read_at,
    edited_at: msg.edited_at,
    sync_status: msg.sync_status,
    attachments: msg.attachments?.map((att) => ({
      id: att.server_id ?? att.id,
      name: att.name,
      mime: att.mime,
      url: att.url,
      size: att.size,
      type: att.type,
    })),
    reply_to: msg.reply_to,
    sender: msg.sender,
  };
}

export function sortMessagesByCreatedAt<T extends { created_at: string }>(messages: T[]): T[] {
  return [...messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

export function apiMessageToChatMessage(msg: Record<string, unknown>): ChatMessage {
  const m = msg as ChatMessage;
  const rawSender = msg.sender as ChatMessage['sender'] | undefined;
  const serverId = Number(msg.id ?? m.server_id ?? 0);

  return {
    ...m,
    id: serverId || Number(m.id ?? 0),
    server_id: serverId > 0 ? serverId : m.server_id,
    sender_id: Number(msg.sender_id ?? m.sender_id ?? 0),
    receiver_id:
      msg.receiver_id != null && msg.receiver_id !== ''
        ? Number(msg.receiver_id)
        : m.receiver_id,
    client_message_id: (msg.client_message_id as string | null | undefined) ?? m.client_message_id,
    sync_status: (msg.sync_status as ChatMessage['sync_status']) ?? 'synced',
    sender: rawSender
      ? {
          ...rawSender,
          id: Number(rawSender.id ?? msg.sender_id ?? 0),
        }
      : m.sender,
  };
}
