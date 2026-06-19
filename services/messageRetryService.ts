/**
 * Phase 1: Legacy shim — all send/retry traffic goes through the outbox worker.
 */
import type { DatabaseMessage } from '@/types/database';
import { getOutboxByLocalMessageId } from './outboxDatabase';
import { updateMessageStatus } from './database';
import {
  kickOutboxWorker,
  markMessageAsSending,
  unmarkMessageAsSending,
  isMessageBeingSent,
  getMessagesBeingSent,
  processOutboxQueue,
  requeueOutboxMessage,
  startOutboxWorker,
  stopOutboxWorker,
} from './outboxService';

export {
  markMessageAsSending,
  unmarkMessageAsSending,
  isMessageBeingSent,
  getMessagesBeingSent,
  kickOutboxWorker,
};

export function startRetryService(intervalMs = 15000): void {
  startOutboxWorker(intervalMs);
}

export function stopRetryService(): void {
  stopOutboxWorker();
}

export async function retryPendingMessages(): Promise<void> {
  return processOutboxQueue();
}

export async function retryFailedMessage(localMessageId: number): Promise<boolean> {
  try {
    const outbox = await getOutboxByLocalMessageId(localMessageId);
    if (outbox) {
      await updateMessageStatus(localMessageId, undefined, 'pending');
      await requeueOutboxMessage(outbox.client_message_id);
      return true;
    }
    await updateMessageStatus(localMessageId, undefined, 'pending');
    kickOutboxWorker();
    return true;
  } catch (error) {
    console.error(`[MessageRetry] Failed to retry message ${localMessageId}:`, error);
    return false;
  }
}

// Unused by app after Phase 1; kept so any dynamic import still resolves
export type { DatabaseMessage };
