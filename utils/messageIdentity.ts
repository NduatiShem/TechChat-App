export type MessageSyncStatus = 'synced' | 'pending' | 'failed';

export interface IdentifiableMessage {
  id?: number | string;
  server_id?: number;
  client_message_id?: string | null;
  sync_status?: MessageSyncStatus;
}

/** Stable dedup / merge key: server id wins, then client id, then local id */
export function getMessageKey(msg: IdentifiableMessage): string {
  if (msg.server_id != null) {
    return `server:${msg.server_id}`;
  }
  if (msg.client_message_id) {
    return `client:${msg.client_message_id}`;
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
