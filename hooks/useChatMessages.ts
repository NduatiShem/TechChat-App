import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import type { ChatMessage } from '@/types/chat';
import { applyOutboxSyncToMessages } from '@/services/chatMessageService';
import { subscribeOutboxSync } from '@/services/outboxService';
import { dedupeMessages } from '@/utils/messageDedup';

export { dedupeMessages as deduplicateMessages } from '@/utils/messageDedup';
export {
  loadMessagesFromCache,
  mergeMessagesWithPending,
  mergeDeltaMessages,
  mapApiMessages,
  persistApiMessages,
  persistOutgoingMessage,
  buildOutboxPayload,
  MESSAGES_PER_PAGE,
  DELTA_POLL_INTERVAL_MS,
} from '@/services/chatMessageService';

/**
 * Subscribe to outbox sync events and merge into chat message state.
 */
export function useOutboxSync<T extends ChatMessage>(
  setMessages: Dispatch<SetStateAction<T[]>>
): void {
  useEffect(() => {
    return subscribeOutboxSync((event) => {
      setMessages((prev) => applyOutboxSyncToMessages(prev, event) as T[]);
    });
  }, [setMessages]);
}

export function useStableDedupe() {
  return useCallback((messages: ChatMessage[]) => dedupeMessages(messages), []);
}
