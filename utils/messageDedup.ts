import { getMessageKey, pickPreferredMessage, type IdentifiableMessage } from './messageIdentity';

export type DedupableMessage = IdentifiableMessage;

/**
 * O(n) deduplication keyed by server_id ?? client_message_id ?? local id.
 * Prefers synced / server-backed messages over pending optimistic rows.
 */
export function dedupeMessages<T extends IdentifiableMessage>(messages: T[]): T[] {
  const byKey = new Map<string, T>();

  for (const msg of messages) {
    if (!msg) continue;
    const key = getMessageKey(msg);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, msg);
      continue;
    }
    byKey.set(key, pickPreferredMessage(existing, msg) as T);
  }

  return Array.from(byKey.values());
}
