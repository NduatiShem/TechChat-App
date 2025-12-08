import type { DatabaseMessage } from '@/types/database';
import { conversationsAPI, messagesAPI } from './api';
import {
    deleteMessage,
    getDb,
    saveConversations,
    saveMessages,
    updateSyncState
} from './database';

// Sync lock mechanism to prevent concurrent syncs
let conversationsSyncLock = false;
let conversationsSyncPromise: Promise<{ success: boolean; count: number; error?: string }> | null = null;
let lastConversationsSyncTime = 0;
const CONVERSATIONS_SYNC_DEBOUNCE_MS = 2000; // Wait 2 seconds between syncs

// Message sync locks per conversation
const messageSyncLocks = new Map<string, boolean>();
const messageSyncPromises = new Map<string, Promise<any>>();
const lastMessageSyncTimes = new Map<string, number>();
const MESSAGE_SYNC_DEBOUNCE_MS = 1000; // Wait 1 second between message syncs for same conversation

/**
 * Remove messages that exist locally but were deleted on the server
 * This detects hard-deleted messages (not soft-deleted) that are missing from API response
 */
async function removeDeletedMessages(
  conversationId: number,
  conversationType: 'individual' | 'group',
  serverIdsFromAPI: number[]
): Promise<number> {
  try {
    const database = await getDb();
    if (!database) {
      return 0;
    }
    
    // Get all local messages with server_id for this conversation
    const localMessages = await database.getAllAsync<DatabaseMessage>(
      `SELECT id, server_id FROM messages 
       WHERE conversation_id = ? AND conversation_type = ? AND server_id IS NOT NULL`,
      [conversationId, conversationType]
    );
    
    if (localMessages.length === 0) {
      return 0;
    }
    
    // Create set of server IDs from API for quick lookup
    const apiServerIds = new Set(serverIdsFromAPI);
    
    // Find messages that exist locally but not in API (deleted on server)
    const messagesToDelete = localMessages.filter(msg => 
      msg.server_id && !apiServerIds.has(msg.server_id)
    );
    
    if (messagesToDelete.length === 0) {
      return 0;
    }
    
    let deletedCount = 0;
    for (const msg of messagesToDelete) {
      try {
        await deleteMessage(msg.server_id!, msg.id);
        deletedCount++;
      } catch (error) {
        // Log but continue deleting other messages
        if (__DEV__) {
          console.warn(`[Sync] Error deleting message ${msg.server_id}:`, error);
        }
      }
    }
    
    if (__DEV__ && deletedCount > 0) {
      console.log(`[Sync] Removed ${deletedCount} deleted messages for ${conversationType} ${conversationId}`);
    }
    
    return deletedCount;
  } catch (error) {
    console.error('[Sync] Error removing deleted messages:', error);
    return 0;
  }
}

export async function syncConversationMessages(
  conversationId: number,
  conversationType: 'individual' | 'group',
  currentUserId: number
): Promise<{ success: boolean; newMessagesCount: number; deletedCount?: number; error?: string }> {
  const syncKey = `${conversationType}_${conversationId}`;
  
  // Check if sync is already running for this conversation
  if (messageSyncLocks.get(syncKey) && messageSyncPromises.has(syncKey)) {
    if (__DEV__) {
      console.log(`[Sync] Message sync already in progress for ${syncKey}, waiting...`);
    }
    return messageSyncPromises.get(syncKey)!;
  }

  // Debounce: If sync was called recently for this conversation, wait a bit
  const now = Date.now();
  const lastSyncTime = lastMessageSyncTimes.get(syncKey) || 0;
  const timeSinceLastSync = now - lastSyncTime;
  if (timeSinceLastSync < MESSAGE_SYNC_DEBOUNCE_MS && lastSyncTime > 0) {
    if (__DEV__) {
      console.log(`[Sync] Debouncing message sync for ${syncKey} (${timeSinceLastSync}ms since last sync)`);
    }
    // Wait for the debounce period
    await new Promise(resolve => setTimeout(resolve, MESSAGE_SYNC_DEBOUNCE_MS - timeSinceLastSync));
  }

  // Set lock and create promise
  messageSyncLocks.set(syncKey, true);
  const syncPromise = (async () => {
    try {
      await updateSyncState(conversationId, conversationType, 'syncing');

    let response;
    if (conversationType === 'individual') {
      response = await messagesAPI.getByUser(conversationId, 1, 50);
    } else {
      response = await messagesAPI.getByGroup(conversationId, 1, 50);
    }

    const messagesData = response.data.messages?.data || response.data.messages || [];

    if (messagesData.length === 0) {
      // If API returns 0 messages, don't delete local messages because:
      // 1. Conversation might be empty (no messages ever sent)
      // 2. We're only checking first 50 messages (pagination)
      // 3. API might be temporarily unavailable
      // Deletion detection only works when we have messages to compare against
      await updateSyncState(conversationId, conversationType, 'synced');
      return { success: true, newMessagesCount: 0, deletedCount: 0 };
    }

    const messagesToSave = messagesData.map((msg: any) => ({
      server_id: msg.id,
      conversation_id: conversationId,
      conversation_type: conversationType,
      sender_id: msg.sender_id,
      receiver_id: msg.receiver_id ?? null,
      group_id: msg.group_id ?? null,
      message: msg.message ?? null,
      created_at: msg.created_at,
      read_at: msg.read_at ?? null,
      edited_at: msg.edited_at ?? null,
      reply_to_id: msg.reply_to_id ?? null,
      sync_status: 'synced' as const,
      attachments: msg.attachments?.map((att: any) => ({
        server_id: att.id,
        name: att.name,
        mime: att.mime,
        url: att.url,
        size: att.size,
        type: att.type,
      })) ?? [],
    }));

      await saveMessages(messagesToSave);
      
      // Remove messages that exist locally but were deleted on the server
      const serverIds = messagesToSave.map(msg => msg.server_id!).filter(Boolean);
      const deletedCount = await removeDeletedMessages(conversationId, conversationType, serverIds);
      
      await updateSyncState(conversationId, conversationType, 'synced');

      lastMessageSyncTimes.set(syncKey, Date.now());

      if (__DEV__) {
        console.log(`[Sync] Synced ${messagesToSave.length} messages, removed ${deletedCount} deleted messages for ${conversationType} ${conversationId}`);
      }

      return { success: true, newMessagesCount: messagesToSave.length, deletedCount };
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      console.error(`[Sync] Error syncing messages for ${conversationType} ${conversationId}:`, errorMessage);
      
      await updateSyncState(conversationId, conversationType, 'failed', errorMessage);
      
      return { success: false, newMessagesCount: 0, error: errorMessage };
    } finally {
      // Release lock
      messageSyncLocks.set(syncKey, false);
      messageSyncPromises.delete(syncKey);
    }
  })();

  messageSyncPromises.set(syncKey, syncPromise);
  return syncPromise;
}

export async function syncConversations(): Promise<{ success: boolean; count: number; error?: string }> {
  // Check if sync is already running
  if (conversationsSyncLock && conversationsSyncPromise) {
    if (__DEV__) {
      console.log('[Sync] Conversations sync already in progress, waiting...');
    }
    return conversationsSyncPromise;
  }

  // Debounce: If sync was called recently, wait a bit
  const now = Date.now();
  const timeSinceLastSync = now - lastConversationsSyncTime;
  if (timeSinceLastSync < CONVERSATIONS_SYNC_DEBOUNCE_MS && lastConversationsSyncTime > 0) {
    if (__DEV__) {
      console.log(`[Sync] Debouncing conversations sync (${timeSinceLastSync}ms since last sync)`);
    }
    // Wait for the debounce period
    await new Promise(resolve => setTimeout(resolve, CONVERSATIONS_SYNC_DEBOUNCE_MS - timeSinceLastSync));
  }

  // Set lock and create promise
  conversationsSyncLock = true;
  conversationsSyncPromise = (async () => {
    try {
      const response = await conversationsAPI.getAll();
      let conversationsData = response.data;

    if (typeof conversationsData === 'string') {
      try {
        conversationsData = JSON.parse(conversationsData);
      } catch (parseError) {
        console.error('[Sync] Failed to parse conversations JSON:', parseError);
        return { success: false, count: 0, error: 'Failed to parse response' };
      }
    }

    let conversationsArray: any[] = [];
    if (Array.isArray(conversationsData)) {
      conversationsArray = conversationsData;
    } else if (conversationsData && typeof conversationsData === 'object') {
      const keys = Object.keys(conversationsData);
      const numericKeys = keys.filter(key => !isNaN(Number(key)));
      if (numericKeys.length > 0) {
        conversationsArray = numericKeys.map(key => conversationsData[key]).filter(Boolean);
      } else {
        conversationsArray = [conversationsData];
      }
    }

    const conversationsToSave = conversationsArray.map((conv: any) => ({
      conversation_id: conv.user_id || conv.id || conv.conversation_id,
      conversation_type: conv.is_group ? 'group' : 'individual',
      user_id: conv.is_group ? undefined : (conv.user_id || conv.id),
      group_id: conv.is_group ? (conv.id || conv.group_id) : undefined,
      name: conv.name || 'Unknown',
      email: conv.email,
      avatar_url: conv.avatar_url,
      last_message: conv.last_message,
      last_message_date: conv.last_message_date || conv.updated_at,
      last_message_sender_id: conv.last_message_sender_id,
      last_message_read_at: conv.last_message_read_at,
      unread_count: conv.unread_count ?? 0,
      created_at: conv.created_at,
      updated_at: conv.updated_at || conv.last_message_date || new Date().toISOString(),
    }));

      await saveConversations(conversationsToSave);

      lastConversationsSyncTime = Date.now();

      if (__DEV__) {
        console.log(`[Sync] Synced ${conversationsToSave.length} conversations`);
      }

      return { success: true, count: conversationsToSave.length };
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      console.error('[Sync] Error syncing conversations:', errorMessage);
      return { success: false, count: 0, error: errorMessage };
    } finally {
      // Release lock
      conversationsSyncLock = false;
      conversationsSyncPromise = null;
    }
  })();

  return conversationsSyncPromise;
}

export async function syncOlderMessages(
  conversationId: number,
  conversationType: 'individual' | 'group',
  page: number = 1,
  perPage: number = 50
): Promise<{ success: boolean; messagesCount: number; deletedCount?: number; hasMore: boolean; error?: string }> {
  try {
    let response;
    if (conversationType === 'individual') {
      response = await messagesAPI.getByUser(conversationId, page, perPage);
    } else {
      response = await messagesAPI.getByGroup(conversationId, page, perPage);
    }

    const messagesData = response.data.messages?.data || response.data.messages || [];
    const pagination = response.data.messages || {};
    const hasMore = pagination.current_page < pagination.last_page || messagesData.length >= perPage;

    if (messagesData.length === 0) {
      return { success: true, messagesCount: 0, deletedCount: 0, hasMore: false };
    }

    const messagesToSave = messagesData.map((msg: any) => ({
      server_id: msg.id,
      conversation_id: conversationId,
      conversation_type: conversationType,
      sender_id: msg.sender_id,
      receiver_id: msg.receiver_id ?? null,
      group_id: msg.group_id ?? null,
      message: msg.message ?? null,
      created_at: msg.created_at,
      read_at: msg.read_at ?? null,
      edited_at: msg.edited_at ?? null,
      reply_to_id: msg.reply_to_id ?? null,
      sync_status: 'synced' as const,
      attachments: msg.attachments?.map((att: any) => ({
        server_id: att.id,
        name: att.name,
        mime: att.mime,
        url: att.url,
        size: att.size,
        type: att.type,
      })) ?? [],
    }));

    await saveMessages(messagesToSave);
    
    // Remove messages that exist locally but were deleted on the server
    // Note: For pagination, we only check deletions for the current page's messages
    // Full deletion check should be done in syncConversationMessages (page 1)
    const serverIds = messagesToSave.map(msg => msg.server_id!).filter(Boolean);
    const deletedCount = await removeDeletedMessages(conversationId, conversationType, serverIds);

    if (__DEV__) {
      console.log(`[Sync] Synced ${messagesToSave.length} older messages, removed ${deletedCount} deleted messages for ${conversationType} ${conversationId}`);
    }

    return { success: true, messagesCount: messagesToSave.length, deletedCount, hasMore };
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error';
    console.error(`[Sync] Error syncing older messages for ${conversationType} ${conversationId}:`, errorMessage);
    return { success: false, messagesCount: 0, deletedCount: 0, hasMore: false, error: errorMessage };
  }
}

export async function backgroundSync(activeConversationId?: number, activeConversationType?: 'individual' | 'group'): Promise<void> {
  try {
    await syncConversations();

    if (activeConversationId && activeConversationType) {
      await syncConversationMessages(activeConversationId, activeConversationType, 0);
    }
  } catch (error) {
    console.error('[Sync] Error in background sync:', error);
  }
}



