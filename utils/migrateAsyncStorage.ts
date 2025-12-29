import { saveConversations } from '@/services/database';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CONVERSATIONS_CACHE_KEY = '@techchat_conversations';
const GROUPS_CACHE_KEY = '@techchat_groups';

export async function migrateConversationsFromAsyncStorage(): Promise<number> {
  try {
    const cachedData = await AsyncStorage.getItem(CONVERSATIONS_CACHE_KEY);
    if (!cachedData) {
      return 0;
    }

    const conversations = JSON.parse(cachedData);
    if (!Array.isArray(conversations) || conversations.length === 0) {
      return 0;
    }

    const conversationsToSave = conversations.map((conv: any) => ({
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
      created_at: conv.created_at || new Date().toISOString(),
      updated_at: conv.updated_at || conv.last_message_date || new Date().toISOString(),
    }));

    await saveConversations(conversationsToSave);

    if (__DEV__) {
      console.log(`[Migration] Migrated ${conversationsToSave.length} conversations from AsyncStorage`);
    }

    return conversationsToSave.length;
  } catch (error) {
    console.error('[Migration] Error migrating conversations:', error);
    return 0;
  }
}

export async function migrateGroupsFromAsyncStorage(): Promise<number> {
  try {
    const cachedData = await AsyncStorage.getItem(GROUPS_CACHE_KEY);
    if (!cachedData) {
      return 0;
    }

    const groups = JSON.parse(cachedData);
    if (!Array.isArray(groups) || groups.length === 0) {
      return 0;
    }

    const groupsToSave = groups.map((group: any) => ({
      conversation_id: group.id,
      conversation_type: 'group' as const,
      group_id: group.id,
      name: group.name || 'Unknown Group',
      email: undefined,
      avatar_url: group.avatar_url,
      last_message: group.last_message,
      last_message_date: group.last_message_date || group.updated_at,
      last_message_sender_id: undefined,
      last_message_read_at: undefined,
      unread_count: group.unread_count ?? 0,
      created_at: group.created_at || new Date().toISOString(),
      updated_at: group.updated_at || group.last_message_date || new Date().toISOString(),
    }));

    await saveConversations(groupsToSave);

    if (__DEV__) {
      console.log(`[Migration] Migrated ${groupsToSave.length} groups from AsyncStorage`);
    }

    return groupsToSave.length;
  } catch (error) {
    console.error('[Migration] Error migrating groups:', error);
    return 0;
  }
}

export async function runAsyncStorageMigration(): Promise<{ conversations: number; groups: number }> {
  try {
    const conversationsCount = await migrateConversationsFromAsyncStorage();
    const groupsCount = await migrateGroupsFromAsyncStorage();

    return {
      conversations: conversationsCount,
      groups: groupsCount,
    };
  } catch (error) {
    console.error('[Migration] Error running AsyncStorage migration:', error);
    return { conversations: 0, groups: 0 };
  }
}




