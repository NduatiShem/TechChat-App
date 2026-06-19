// Database type definitions for SQLite

export interface DatabaseMessage {
  id: number;
  conversation_id: number;
  conversation_type: 'individual' | 'group';
  sender_id: number;
  receiver_id?: number;
  group_id?: number;
  message: string;
  created_at: string;
  read_at?: string | null;
  edited_at?: string | null;
  reply_to_id?: number | null;
  sync_status: 'synced' | 'pending' | 'failed';
  server_id?: number;
  client_message_id?: string | null;
  updated_at: string;
}

export type OutboxStatus = 'pending' | 'sending' | 'synced' | 'failed';

export interface OutboxPayload {
  message?: string | null;
  receiver_id?: number;
  group_id?: number;
  reply_to_id?: number | null;
  voice_duration?: number;
  is_voice_message?: boolean;
  attachments?: Array<{ uri: string; name: string; mime: string }>;
}

export interface MessageOutboxRow {
  client_message_id: string;
  local_message_id: number | null;
  conversation_id: number;
  conversation_type: 'individual' | 'group';
  payload_json: string;
  attempts: number;
  last_attempt_at: string | null;
  status: OutboxStatus;
  created_at: string;
}

export interface DatabaseConversation {
  id: number;
  conversation_id: number;
  conversation_type: 'individual' | 'group';
  user_id?: number;
  group_id?: number;
  name: string;
  email?: string;
  avatar_url?: string;
  last_message?: string;
  last_message_date?: string;
  last_message_sender_id?: number;
  last_message_read_at?: string | null;
  unread_count: number;
  created_at: string;
  updated_at: string;
  sync_status: 'synced' | 'pending' | 'failed';
}

export interface DatabaseAttachment {
  id: number;
  message_id: number;
  server_id?: number;
  name: string;
  mime: string;
  url: string;
  local_path?: string;
  size?: number;
  type?: string;
  sync_status: 'synced' | 'pending' | 'failed';
}

export interface SyncState {
  conversation_id: number;
  conversation_type: 'individual' | 'group';
  last_sync_timestamp: string;
  sync_status: 'synced' | 'syncing' | 'failed';
  last_error?: string;
}

export interface DatabaseGroup {
  id: number;
  name: string;
  description?: string | null;
  owner_id?: number | null;
  avatar_url?: string | null;
  member_count?: number;
  last_message?: string | null;
  last_message_date?: string | null;
  unread_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface SavedMessageResult {
  localMessageId: number;
  clientMessageId: string | null;
  serverId: number | null;
}

export interface MessageWithAttachments extends DatabaseMessage {
  attachments?: DatabaseAttachment[];
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
    attachments?: DatabaseAttachment[];
    created_at: string;
  };
}








