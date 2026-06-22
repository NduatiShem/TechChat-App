export type MessageSyncStatus = 'synced' | 'pending' | 'failed';

export interface IdentifiableMessage {
  id?: number | string;
  server_id?: number;
  client_message_id?: string | null;
  sync_status?: MessageSyncStatus;
}

/**
 * Stable dedup / merge key.
 *
 * client_message_id MUST take precedence over server_id: it is the only
 * identifier shared by an optimistic message and its server echo (realtime /
 * API). If we keyed by server_id first, the optimistic row (which has no
 * server_id until the outbox reconciles it) and its server copy would get
 * different keys and both survive in the in-memory list — showing the message
 * twice until a full app restart rebuilds state from SQLite (which already
 * upserts by client_message_id). Keying by client_message_id first collapses
 * them immediately. UUIDs are globally unique, so this never collides across
 * distinct messages, including those received from other users.
 */
export function getMessageKey(msg: IdentifiableMessage): string {
  if (msg.client_message_id) {
    return `client:${msg.client_message_id}`;
  }
  if (msg.server_id != null) {
    return `server:${msg.server_id}`;
  }
  if (msg.id != null && msg.id !== 0) {
    return `local:${msg.id}`;
  }
  return `unknown:${Math.random()}`;
}

export function isLocalPending(msg: IdentifiableMessage): boolean {
  if (msg.server_id != null) return false;
  return msg.sync_status === 'pending' || msg.sync_status === 'failed';
}

export function isSyncedMessage(msg: IdentifiableMessage): boolean {
  return msg.sync_status === 'synced' || msg.server_id != null;
}

/** Prefer synced / server-backed row when merging duplicates */
export function pickPreferredMessage<T extends IdentifiableMessage>(a: T, b: T): T {
  const aSynced = isSyncedMessage(a);
  const bSynced = isSyncedMessage(b);
  if (aSynced && !bSynced) return a;
  if (bSynced && !aSynced) return b;
  if (a.server_id != null && b.server_id == null) return a;
  if (b.server_id != null && a.server_id == null) return b;
  return a;
}
