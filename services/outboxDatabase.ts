import type { MessageOutboxRow, OutboxPayload, OutboxStatus } from '@/types/database';
import { getDb, writeQueue, validateDatabase } from './database';

export async function upsertOutboxEntry(params: {
  clientMessageId: string;
  localMessageId: number | null;
  conversationId: number;
  conversationType: 'individual' | 'group';
  payload: OutboxPayload;
}): Promise<void> {
  const database = await getDb();
  if (!database) return;

  const payloadJson = JSON.stringify(params.payload);
  const localMessageId =
    params.localMessageId != null && params.localMessageId > 0
      ? params.localMessageId
      : null;

  await writeQueue.enqueue(async () => {
    const db = await getDb();
    if (!db || !(await validateDatabase(db))) return;

    await db.runAsync(
      `INSERT INTO message_outbox (
        client_message_id, local_message_id, conversation_id, conversation_type,
        payload_json, attempts, status, created_at
      ) VALUES (?, ?, ?, ?, ?, 0, 'pending', datetime('now'))
      ON CONFLICT(client_message_id) DO UPDATE SET
        local_message_id = COALESCE(excluded.local_message_id, message_outbox.local_message_id),
        payload_json = excluded.payload_json,
        status = 'pending',
        attempts = 0,
        last_attempt_at = NULL`,
      [
        params.clientMessageId,
        localMessageId,
        params.conversationId,
        params.conversationType,
        payloadJson,
      ]
    );
  });
}

export async function getPendingOutboxEntries(limit = 20): Promise<MessageOutboxRow[]> {
  const database = await getDb();
  if (!database) return [];

  return writeQueue.enqueue(async () => {
    const db = await getDb();
    if (!db || !(await validateDatabase(db))) return [];

    return db.getAllAsync<MessageOutboxRow>(
      `SELECT * FROM message_outbox
       WHERE status IN ('pending', 'failed')
       ORDER BY created_at ASC
       LIMIT ?`,
      [limit]
    );
  });
}

export async function updateOutboxStatus(
  clientMessageId: string,
  status: OutboxStatus,
  attempts?: number,
  lastAttemptAt?: string
): Promise<void> {
  const database = await getDb();
  if (!database) return;

  await writeQueue.enqueue(async () => {
    const db = await getDb();
    if (!db || !(await validateDatabase(db))) return;

    if (attempts !== undefined && lastAttemptAt !== undefined) {
      await db.runAsync(
        `UPDATE message_outbox SET status = ?, attempts = ?, last_attempt_at = ? WHERE client_message_id = ?`,
        [status, attempts, lastAttemptAt, clientMessageId]
      );
    } else {
      await db.runAsync(
        `UPDATE message_outbox SET status = ? WHERE client_message_id = ?`,
        [status, clientMessageId]
      );
    }
  });
}

export async function updateOutboxLocalMessageId(
  clientMessageId: string,
  localMessageId: number
): Promise<void> {
  const database = await getDb();
  if (!database) return;
  await writeQueue.enqueue(async () => {
    const db = await getDb();
    if (!db || !(await validateDatabase(db))) return;
    await db.runAsync(
      `UPDATE message_outbox SET local_message_id = ? WHERE client_message_id = ?`,
      [localMessageId, clientMessageId]
    );
  });
}

export async function resetOutboxForRetry(clientMessageId: string): Promise<void> {
  const database = await getDb();
  if (!database) return;
  await writeQueue.enqueue(async () => {
    const db = await getDb();
    if (!db || !(await validateDatabase(db))) return;
    await db.runAsync(
      `UPDATE message_outbox SET attempts = 0, last_attempt_at = NULL, status = 'pending' WHERE client_message_id = ?`,
      [clientMessageId]
    );
  });
}

export async function getOutboxByLocalMessageId(
  localMessageId: number
): Promise<MessageOutboxRow | null> {
  const database = await getDb();
  if (!database) return null;

  return writeQueue.enqueue(async () => {
    const db = await getDb();
    if (!db || !(await validateDatabase(db))) return null;
    return db.getFirstAsync<MessageOutboxRow>(
      `SELECT * FROM message_outbox WHERE local_message_id = ?`,
      [localMessageId]
    );
  });
}
