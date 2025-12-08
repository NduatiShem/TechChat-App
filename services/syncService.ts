import { conversationsAPI, messagesAPI } from './api';
import {
    saveConversations,
    saveMessages,
    updateSyncState
} from './database';

export async function syncConversationMessages(
  conversationId: number,
  conversationType: 'individual' | 'group',
  currentUserId: number
): Promise<{ success: boolean; newMessagesCount: number; error?: string }> {
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
      await updateSyncState(conversationId, conversationType, 'synced');
      return { success: true, newMessagesCount: 0 };
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
    await updateSyncState(conversationId, conversationType, 'synced');

    if (__DEV__) {
      console.log(`[Sync] Synced ${messagesToSave.length} messages for ${conversationType} ${conversationId}`);
    }

    return { success: true, newMessagesCount: messagesToSave.length };
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error';
    console.error(`[Sync] Error syncing messages for ${conversationType} ${conversationId}:`, errorMessage);
    
    await updateSyncState(conversationId, conversationType, 'failed', errorMessage);
    
    return { success: false, newMessagesCount: 0, error: errorMessage };
  }
}

export async function syncConversations(): Promise<{ success: boolean; count: number; error?: string }> {
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

    if (__DEV__) {
      console.log(`[Sync] Synced ${conversationsToSave.length} conversations`);
    }

    return { success: true, count: conversationsToSave.length };
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error';
    console.error('[Sync] Error syncing conversations:', errorMessage);
    return { success: false, count: 0, error: errorMessage };
  }
}

export async function syncOlderMessages(
  conversationId: number,
  conversationType: 'individual' | 'group',
  page: number = 1,
  perPage: number = 50
): Promise<{ success: boolean; messagesCount: number; hasMore: boolean; error?: string }> {
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
      return { success: true, messagesCount: 0, hasMore: false };
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

    if (__DEV__) {
      console.log(`[Sync] Synced ${messagesToSave.length} older messages for ${conversationType} ${conversationId}`);
    }

    return { success: true, messagesCount: messagesToSave.length, hasMore };
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error';
    console.error(`[Sync] Error syncing older messages for ${conversationType} ${conversationId}:`, errorMessage);
    return { success: false, messagesCount: 0, hasMore: false, error: errorMessage };
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


